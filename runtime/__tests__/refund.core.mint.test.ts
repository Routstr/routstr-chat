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
import type { ApiKeyEntry } from "@routstr/sdk/wallet";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import { emptyDevice, fakeKeys } from "@/features/payments/__tests__/fakes";
import type { Purse } from "@/features/payments/ports";
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
 *  device made. */
async function account(others: ApiKeyEntry[] = []) {
  const received: number[] = [];
  const purse: Purse = {
    balances: async () => ({ [kit.env.mintUrl]: 0 }),
    activeMint: () => kit.env.mintUrl,
    send: async () => {
      throw new Error("these tests never pay");
    },
    receive: async (token) => {
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
    otherDevices: { keys: () => others, drop: async () => {} },
  });
  /** A key this account holds; just used, so only the button refunds it. */
  const hold = (key: string) => {
    storage.setApiKey(kit.coreUrl, key);
    storage.touchApiKeyLastUsed(kit.coreUrl);
  };
  return { chat, storage, hold, received };
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
