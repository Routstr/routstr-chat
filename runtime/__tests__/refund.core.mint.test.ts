/**
 * The Refund button against each core a node may run: core main (bare
 * `detail` strings), #805 (refund refusals with codes) and #779
 * (`key_not_found` for an unknown key on every route). Run it once per core
 * with KIT_CORE_DIR. Keys are made at core directly and the wallet only
 * receives, so no wallet book is needed; each refund is redeemed at the mint,
 * so it is real money.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BalanceManager,
  type ApiKeyEntry,
  type StorageAdapter,
  type WalletAdapter,
} from "@routstr/sdk/wallet";
import { ExportedKeys } from "@/features/keys/exported";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import {
  emptyDevice,
  fakeKeys,
  noAdopt,
} from "@/features/payments/__tests__/fakes";
import type { Adopt, Purse } from "@/features/payments/ports";
import { getKit } from "@/tests/kit";
import { createAccountChat } from "../chat";
import { createRouting } from "../routing";

const kit = getKit();

beforeEach(() => kit.upstream.reset());
afterEach(() => vi.restoreAllMocks());

/** A key at core worth `sats`, made by paying it a token. */
async function newKey(sats: number): Promise<string> {
  const res = await fetch(`${kit.coreUrl}v1/wallet/info`, {
    headers: { Authorization: `Bearer ${await kit.mintToken(sats)}` },
  });
  if (!res.ok) throw new Error(`core made no key: ${res.status}`);
  return (await res.json()).api_key;
}

/** Core says there is nothing to refund only for a key spent to zero. */
function spendAll(key: string) {
  const db = path.join(kit.env.dir, "core", "core.db");
  const hashed = key.slice(3).replace(/[^0-9a-f]/g, "");
  execFileSync("sqlite3", [
    db,
    `UPDATE api_keys SET balance=0 WHERE hashed_key='${hashed}'`,
  ]);
}

/** An account whose wallet only takes refunds in. `others` are keys a lost
 *  device made; forgetting them succeeds unless `relayDown` is set. */
async function account(others: ApiKeyEntry[] = [], adopt: Adopt = noAdopt) {
  const received: number[] = [];
  const state = { mintDown: false, relayDown: false };
  const purse: Purse = {
    balances: async () => ({ [kit.env.mintUrl]: 0 }),
    activeMint: () => kit.env.mintUrl,
    send: async () => {
      throw new Error("these tests never pay");
    },
    take: async (token) => {
      if (state.mintDown) throw new Error("Failed to fetch");
      const sats = await kit.redeem(token);
      received.push(sats);
      return { sats, pending: false };
    },
    redeem: async (token) => {
      if (state.mintDown) {
        throw Object.assign(new Error("Failed to fetch"), {
          reason: "unreachable",
        });
      }
      const sats = await kit.redeem(token);
      received.push(sats);
      return sats;
    },
  };
  const credit = fakeKeys();
  await credit.keys.ready();
  const storage = credit.keys.storage();
  const { payments } = createRouting({
    node: () => undefined,
    extraProviders: [kit.coreUrl],
  });
  const chat = createAccountChat({
    owner: "alice",
    storage: memoryStorage(),
    history: new FakeHistory(),
    attachments: passThroughAttachments(),
    keys: credit.keys,
    purse,
    sdk: payments,
    spending: () => ({ mode: "apikeys" }),
    oldCredit: emptyDevice().oldCredit,
    adopt,
    otherDevices: {
      keys: () => others,
      drop: async (keys) => {
        if (state.relayDown) throw new Error("relay down");
        keys.forEach((k) =>
          others.splice(
            others.findIndex((o) => o.key === k),
            1
          )
        );
      },
    },
  });
  /** A key this account holds; just used, so only the button refunds it. */
  const hold = (key: string) => {
    storage.setApiKey(kit.coreUrl, key);
    storage.touchApiKeyLastUsed(kit.coreUrl);
  };
  return { chat, storage, hold, received, state };
}

describe("the Refund button against this node's core", () => {
  it("drops a key core has nothing left to refund on", async () => {
    const { chat, storage, hold, received } = await account();
    const key = await newKey(20);
    spendAll(key);
    hold(key);

    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: true },
    ]);
    expect(storage.getAllApiKeys()).toEqual([]);
    expect(received).toEqual([]);
  });

  it("settles a payout already taken when Refund is pressed again, with no failure shown", async () => {
    const exported = new ExportedKeys(
      "alice",
      memoryStorage(),
      new BalanceManager({} as WalletAdapter, {} as StorageAdapter),
      {
        get: async () => undefined,
        put: async () => {},
        delete: async () => {},
      }
    );
    const { chat, storage, hold, received } = await account(
      [],
      (token, baseUrl) => exported.adopt(token, baseUrl)
    );
    const key = await newKey(40);
    hold(key);
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: true },
    ]);
    expect(received).toEqual([40]);

    // the key is back, as if forgetting it never reached the disk: core
    // replays the payout this wallet already took, and the mint refuses it
    hold(key);
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: true },
    ]);

    expect(received).toEqual([40]);
    expect(storage.getAllApiKeys()).toEqual([]);
    expect(exported.list()).toEqual([]);
  });

  it("shows a key empty after a payout the wallet could not take in", async () => {
    const { chat, storage, hold, received, state } = await account();
    const key = await newKey(40);
    hold(key);
    storage.updateApiKeyBalance(kit.coreUrl, 40);

    state.mintDown = true;
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: false },
    ]);

    expect(received).toEqual([]);
    expect(storage.getAllApiKeys()).toMatchObject([{ key, balance: 0 }]);
    expect(chat.held.get()).toBe(0);
  });

  it("keeps a key a reply elsewhere is still using, and refunds it after", async () => {
    const { chat, storage, hold, received } = await account();
    const key = await newKey(60);
    hold(key);
    // another device, or a tab of the old app, answering on the same key
    const elsewhere = fetch(`${kit.coreUrl}v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kit-cheap",
        messages: [{ role: "user", content: "[kit:slow=6000] hi" }],
      }),
    });
    await vi.waitFor(async () =>
      expect(await kit.upstream.requests()).toHaveLength(1)
    );

    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: false },
    ]);
    expect(storage.getApiKey(kit.coreUrl)?.key).toBe(key);

    await (await elsewhere).text();
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: true },
    ]);
    expect(storage.getAllApiKeys()).toEqual([]);
    expect(received).toHaveLength(1);
    expect(received[0]).toBeGreaterThan(0);
  }, 30_000);

  it("brings back a lost device's credit on the next press when the wallet missed it", async () => {
    const key = await newKey(60);
    const others: ApiKeyEntry[] = [
      { baseUrl: kit.coreUrl, key, balance: 60, lastUsed: null },
    ];
    const { chat, received, state } = await account(others);

    state.mintDown = true;
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: false },
    ]);
    state.mintDown = false;
    // core has paid the key out to zero by now, and pays the same out again
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: true },
    ]);

    expect(received).toHaveLength(1);
    expect(received[0]).toBeGreaterThan(50);
    await vi.waitFor(() => expect(others).toHaveLength(0));
  }, 30_000);

  it("never takes a lost device's credit twice when forgetting it failed", async () => {
    const key = await newKey(40);
    const others: ApiKeyEntry[] = [
      { baseUrl: kit.coreUrl, key, balance: 40, lastUsed: null },
    ];
    // the account's exported keys, which ask core about a spent payout
    const exported = new ExportedKeys(
      "alice",
      memoryStorage(),
      new BalanceManager({} as WalletAdapter, {} as StorageAdapter),
      {
        get: async () => undefined,
        put: async () => {},
        delete: async () => {},
      }
    );
    const { chat, received, state } = await account(others, (token, baseUrl) =>
      exported.adopt(token, baseUrl)
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    state.relayDown = true;
    await chat.refund();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    state.relayDown = false;
    // core replays the payout this wallet already took: the mint refuses it,
    // core says the token is spent, and the key is done
    expect(await chat.refund()).toEqual([
      { baseUrl: kit.coreUrl, success: true },
    ]);

    expect(received).toHaveLength(1);
    await vi.waitFor(() => expect(others).toHaveLength(0));
    expect(exported.list()).toEqual([]);
  }, 30_000);

  it("forgets a lost device's key the node does not know, without a refund call", async () => {
    const lost: ApiKeyEntry = {
      baseUrl: kit.coreUrl,
      key: `sk-${"ab".repeat(32)}`,
      balance: 5,
      lastUsed: null,
    };
    // #779 answers key_not_found on every route; older cores only on refunds
    const probe = await fetch(`${kit.coreUrl}v1/wallet/info`, {
      headers: { Authorization: `Bearer ${lost.key}` },
    });
    const knowsMissingKeys = (await probe.text()).includes('"key_not_found"');
    const { chat } = await account([lost]);
    const asked = vi.spyOn(globalThis, "fetch");

    const results = await chat.refund();

    const refundCalls = asked.mock.calls.filter(([url]) =>
      String(url).endsWith("v1/wallet/refund")
    );
    if (knowsMissingKeys) {
      expect(results).toEqual([{ baseUrl: kit.coreUrl, success: true }]);
      expect(refundCalls).toEqual([]);
    } else {
      // kept in the backup and asked again next time; no money involved
      expect(results).toEqual([{ baseUrl: kit.coreUrl, success: false }]);
    }
  });
});
