import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDriver } from "@routstr/sdk/storage";
import {
  CashuSpender,
  type ApiKeyEntry,
  type StorageAdapter,
} from "@routstr/sdk/wallet";
import type { Sdk } from "../ports";
import { refundCredit } from "../refund";
import { sdkWallet } from "../request";
import {
  fakeKeys,
  fakeLock,
  fakePurse,
  fakeSdk,
  tabKeys,
  tokenOf,
  noAdopt,
} from "./fakes";

const SMALL = "https://small.example/";
const LARGE = "https://large.example/";

/** A provider's balance and refund endpoints, like routstr-core's. */
function provider(msats: Record<string, number>) {
  const refunded: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const base = String(url).replace(/v1\/(wallet|balance)\/.*$/, "");
      if (String(url).endsWith("v1/wallet/refund")) {
        refunded.push(base);
        msats[base] = 0;
        return new Response(
          JSON.stringify({ token: `refund-${base}`, sats: "1" })
        );
      }
      return new Response(
        JSON.stringify({ balance: msats[base], reserved: 0 })
      );
    })
  );
  return refunded;
}

/** main's old shared store, one per device */
async function device() {
  const old = fakeKeys();
  await old.keys.ready();
  return { storage: old.keys.storage(), lock: fakeLock() };
}

/** One account on the device. */
async function setup(shared?: Awaited<ReturnType<typeof device>>) {
  const credit = fakeKeys();
  await credit.keys.ready();
  const old = shared ?? (await device());
  const wallet = fakePurse();
  const others: ApiKeyEntry[] = [];
  const deps = {
    keys: credit.keys,
    purse: wallet.purse,
    sdk: fakeSdk(),
    oldCredit: {
      load: vi.fn(async () => old.storage),
      lock: () => old.lock.lock(),
    },
    otherDevices: {
      keys: () => others,
      drop: vi.fn(async (_keys: string[]) => {}),
    },
    adopt: noAdopt,
    live: () => true,
  };
  return {
    deps,
    credit,
    wallet,
    others,
    direct: credit.keys.storage(),
    legacy: old.storage,
    old,
  };
}

// Automatic refunds skip keys used in the last five minutes
function lastUsed(credit: ReturnType<typeof fakeKeys>, at: number) {
  const { store } = credit.stores.direct;
  store.setState({
    apiKeys: store.getState().apiKeys.map((key) => ({ ...key, lastUsed: at })),
  });
}

describe("refundCredit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves credit under 10 sats for the next chat unless the person asks", async () => {
    const refunded = provider({ [SMALL]: 7_500, [LARGE]: 120_000 });
    const { deps, direct, credit } = await setup();
    direct.setApiKey(SMALL, "sk-small");
    direct.setApiKey(LARGE, "sk-large");
    // just used: a late top-up may still be landing
    lastUsed(credit, Date.now());

    await refundCredit(deps, false);
    expect(refunded).toEqual([]);

    lastUsed(credit, Date.now() - 10 * 60_000);
    await refundCredit(deps, false);
    expect(refunded).toEqual([LARGE]);
    expect(direct.getApiKey(SMALL)).toMatchObject({
      key: "sk-small",
      balance: 7.5,
    });

    await refundCredit(deps, true);
    expect(refunded).toEqual([LARGE, SMALL]);
    expect(direct.getAllApiKeys()).toEqual([]);
  });

  it("replays a payout the wallet failed to receive on the next automatic refund", async () => {
    // Like routstr-core: an emptied key that was paid out replays its token
    let msats = 120_000;
    let paid: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).endsWith("v1/wallet/refund")) {
          return new Response(JSON.stringify({ balance: msats, reserved: 0 }));
        }
        if (msats > 0) {
          paid = "payout-fixture";
          msats = 0;
        }
        return new Response(JSON.stringify({ token: paid, sats: "120" }));
      })
    );
    const { deps, direct, credit, wallet } = await setup();
    direct.setApiKey(LARGE, "sk-large");
    lastUsed(credit, 0);
    wallet.purse.take.mockRejectedValueOnce(new Error("mint unreachable"));

    await refundCredit(deps, false);
    expect(direct.getApiKey(LARGE)).not.toBeNull();

    await refundCredit(deps, false);
    expect(wallet.received).toEqual(["payout-fixture"]);
    expect(direct.getAllApiKeys()).toEqual([]);
  });

  it("keeps the last known balance when the provider cannot say, and still asks for a refund", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(String(url));
        return new Response("busy", { status: 503 });
      })
    );
    const { deps, credit, direct } = await setup();
    direct.setApiKey(LARGE, "sk-large");
    direct.updateApiKeyBalance(LARGE, 50, 0);
    lastUsed(credit, 0);

    await refundCredit(deps, false);

    expect(direct.getApiKey(LARGE)?.balance).toBe(50);
    expect(asked.some((u) => u.endsWith("v1/wallet/refund"))).toBe(true);
  });

  it("clears a key the provider no longer knows", async () => {
    const notFound = JSON.stringify({
      detail: {
        error: {
          message: "Key not found",
          type: "invalid_request_error",
          code: "key_not_found",
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(notFound, { status: 401 }))
    );
    const { deps, direct, credit } = await setup();
    direct.setApiKey(LARGE, "sk-forgotten");
    lastUsed(credit, 0);

    await refundCredit(deps, false);

    expect(direct.getAllApiKeys()).toEqual([]);
  });

  it("sweeps main's old shared credit in full", async () => {
    const refunded = provider({ [SMALL]: 7_500 });
    const { deps, legacy } = await setup();
    legacy.setApiKey(SMALL, "sk-old");

    await refundCredit(deps, false);

    expect(refunded).toEqual([SMALL]);
    expect(legacy.getAllApiKeys()).toEqual([]);
  });

  it("lets one account at a time sweep the old shared credit", async () => {
    const refunded = provider({ [SMALL]: 120_000 });
    const shared = await device();
    shared.storage.setApiKey(SMALL, "sk-old");
    const alice = await setup(shared);
    const bob = await setup(shared);

    await Promise.all([
      refundCredit(alice.deps, false),
      refundCredit(bob.deps, false),
    ]);

    expect(refunded).toEqual([SMALL]);
    expect([...alice.wallet.received, ...bob.wallet.received]).toEqual([
      `refund-${SMALL}`,
    ]);
    expect(shared.lock.held).toBe(0);
  });

  it("does not take the device-wide lock when the old store is empty", async () => {
    provider({ [LARGE]: 120_000 });
    const { deps, direct, old } = await setup();
    direct.setApiKey(LARGE, "sk-large");

    await refundCredit(deps, true);

    expect(old.lock.lock).not.toHaveBeenCalled();
  });

  it("recovers a lost device's keys on the Refund button only", async () => {
    const refunded = provider({ [LARGE]: 120_000, [SMALL]: 120_000 });
    const { deps, others, wallet, direct, credit } = await setup();
    others.push({
      baseUrl: LARGE,
      key: "sk-lost-device",
      balance: 120,
      lastUsed: null,
    });
    // this device's own key, so the automatic refund really runs
    direct.setApiKey(SMALL, "sk-mine");
    lastUsed(credit, 0);

    await refundCredit(deps, false);
    expect(refunded).toEqual([SMALL]);
    expect(deps.otherDevices.drop).not.toHaveBeenCalled();

    await refundCredit(deps, true);
    expect(refunded).toEqual([SMALL, LARGE]);
    expect(wallet.received).toContain(`refund-${LARGE}`);
    expect(deps.otherDevices.drop).toHaveBeenCalledWith(["sk-lost-device"]);
  });

  it("leaves another device's key used in the last five minutes: that device may still be paying with it", async () => {
    const refunded = provider({ [LARGE]: 120_000 });
    const { deps, others } = await setup();
    others.push({
      baseUrl: LARGE,
      key: "sk-busy-device",
      balance: 120,
      lastUsed: Date.now() - 60_000,
    });

    await refundCredit(deps, true);

    expect(refunded).toEqual([]);
    expect(deps.otherDevices.drop).not.toHaveBeenCalled();
  });

  it("still asks the provider about a lost device's key that reads empty", async () => {
    // an emptied key may hold a payout the wallet missed: the provider pays it again
    const refunded = provider({ [LARGE]: 0 });
    const { deps, others, wallet } = await setup();
    others.push({
      baseUrl: LARGE,
      key: "sk-gone-device",
      balance: 0,
      lastUsed: null,
    });

    await refundCredit(deps, true);

    expect(refunded).toEqual([LARGE]);
    expect(wallet.received).toEqual([`refund-${LARGE}`]);
    expect(deps.otherDevices.drop).toHaveBeenCalledWith(["sk-gone-device"]);
  });

  it("shows this device's key empty after a payout the wallet could not take in", async () => {
    provider({ [LARGE]: 120_000 });
    const { deps, direct, wallet } = await setup();
    direct.setApiKey(LARGE, "sk-mine");
    direct.updateApiKeyBalance(LARGE, 120);
    wallet.purse.take.mockRejectedValueOnce(new Error("Failed to fetch"));

    const results = await refundCredit(deps, true);

    expect(results).toContainEqual({ baseUrl: LARGE, success: false });
    // kept, so a refund later is paid out again, and empty, as the provider says
    expect(direct.getAllApiKeys()).toMatchObject([
      { key: "sk-mine", balance: 0 },
    ]);
  });

  it("keeps a lost device's key when its payout could not be received", async () => {
    provider({ [LARGE]: 120_000 });
    const { deps, others, wallet } = await setup();
    others.push({
      baseUrl: LARGE,
      key: "sk-lost-device",
      balance: 120,
      lastUsed: null,
    });
    wallet.purse.take.mockRejectedValueOnce(new Error("Failed to fetch"));

    const results = await refundCredit(deps, true);

    expect(results).toContainEqual({ baseUrl: LARGE, success: false });
    expect(deps.otherDevices.drop).not.toHaveBeenCalled();
  });

  it("keeps this device's key at a provider when a lost device's key there is refunded", async () => {
    // this device's key is busy at the provider, so its refund is refused
    const refunded: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        if (!String(url).endsWith("v1/wallet/refund")) {
          return new Response(
            JSON.stringify({ balance: 120_000, reserved: 0 })
          );
        }
        if (auth.includes("sk-mine")) {
          return new Response(
            JSON.stringify({
              detail: "Cannot refund key. There are ongoing requests",
            }),
            { status: 400 }
          );
        }
        refunded.push(auth);
        return new Response(
          JSON.stringify({ token: `refund-${LARGE}`, sats: "120" })
        );
      })
    );
    const { deps, direct, others } = await setup();
    direct.setApiKey(LARGE, "sk-mine");
    others.push({
      baseUrl: LARGE,
      key: "sk-lost-device",
      balance: 120,
      lastUsed: null,
    });

    await refundCredit(deps, true);

    expect(refunded).toEqual(["Bearer sk-lost-device"]);
    expect(direct.getApiKey(LARGE)?.key).toBe("sk-mine");
  });

  it("forgets refunded keys only after the payment lock is free, and a failure there loses nothing", async () => {
    provider({ [LARGE]: 120_000 });
    const { deps, others, credit } = await setup();
    others.push({
      baseUrl: LARGE,
      key: "sk-lost-device",
      balance: 120,
      lastUsed: null,
    });
    let heldWhileDropping = -1;
    deps.otherDevices.drop.mockImplementationOnce(async () => {
      heldWhileDropping = credit.held;
      throw new Error("relay down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const results = await refundCredit(deps, true);

    expect(heldWhileDropping).toBe(0);
    expect(results).toContainEqual({ baseUrl: LARGE, success: true });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "Could not forget refunded keys yet",
        expect.any(Error)
      )
    );
  });

  it("writes the old store's sweep to disk before letting go of the device-wide lock", async () => {
    provider({ [SMALL]: 120_000 });
    const { deps, legacy, old } = await setup();
    legacy.setApiKey(SMALL, "sk-old");
    let heldAtFlush = -1;
    const flush = legacy.flush!.bind(legacy);
    legacy.flush = async () => {
      heldAtFlush = old.lock.held;
      await flush();
    };

    await refundCredit(deps, false);

    expect(heldAtFlush).toBe(1);
  });

  it("does not wait for the key backup to publish", async () => {
    provider({ [LARGE]: 120_000 });
    const { deps, others } = await setup();
    others.push({
      baseUrl: LARGE,
      key: "sk-lost-device",
      balance: 120,
      lastUsed: null,
    });
    deps.otherDevices.drop.mockImplementationOnce(() => new Promise(() => {}));

    await expect(refundCredit(deps, true)).resolves.toContainEqual({
      baseUrl: LARGE,
      success: true,
    });
  });

  it("sweeps what is on disk once it holds the device-wide lock, not an earlier copy", async () => {
    const refunded = provider({ [SMALL]: 120_000 });
    const { deps } = await setup();
    // read before the lock: still lists a key another tab has since swept
    const stale = (await device()).storage;
    stale.setApiKey(SMALL, "sk-old");
    deps.oldCredit.load.mockResolvedValueOnce(stale);

    await refundCredit(deps, false);

    expect(refunded).toEqual([]);
  });

  it("waits for a running reply before touching credit", async () => {
    const refunded = provider({ [LARGE]: 120_000 });
    const { deps, direct, credit } = await setup();
    direct.setApiKey(LARGE, "sk-large");
    const release = await credit.keys.lock();

    const refund = refundCredit(deps, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refunded).toEqual([]);

    release();
    await refund;
    expect(refunded).toEqual([LARGE]);
    expect(credit.held).toBe(0);
  });

  it("asks no provider and takes no lock when every key was just used", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { deps, direct, credit } = await setup();
    direct.setApiKey(LARGE, "sk-large");
    lastUsed(credit, Date.now());
    await credit.keys.lock();

    await expect(refundCredit(deps, false)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never asks a provider about a key just used, even when other credit is refunded", async () => {
    provider({ [SMALL]: 120_000, [LARGE]: 120_000 });
    const { deps, direct, credit } = await setup();
    direct.setApiKey(SMALL, "sk-old-enough");
    direct.setApiKey(LARGE, "sk-just-used");
    credit.stores.direct.store.setState({
      apiKeys: direct.getAllApiKeys().map((key) => ({
        ...key,
        lastUsed: key.key === "sk-just-used" ? Date.now() : 0,
      })),
    });

    await refundCredit(deps, false);

    const asked = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) =>
        new Headers((init as RequestInit | undefined)?.headers).get(
          "authorization"
        )
      );
    expect(asked).toContain("Bearer sk-old-enough");
    expect(asked).not.toContain("Bearer sk-just-used");
  });

  it("does not queue behind a reply when there is nothing to refund", async () => {
    provider({});
    const { deps, credit } = await setup();
    await credit.keys.lock();

    await expect(refundCredit(deps, false)).resolves.toEqual([]);
  });

  it("brings the money back into the account that paid", async () => {
    provider({ [LARGE]: 120_000 });
    const { deps, direct, wallet } = await setup();
    direct.setApiKey(LARGE, "sk-large");

    await refundCredit(deps, true);

    expect(wallet.received).toEqual([`refund-${LARGE}`]);
  });

  it("keeps another tab's held token when the SDK's refund retry parks one after the sweep", async () => {
    provider({});
    const disk = createMemoryDriver();
    const locks = fakeLock();
    const [here, there] = [tabKeys(disk, locks), tabKeys(disk, locks)];
    await Promise.all([here.ready(), there.ready()]);
    const sdk = fakeSdk();
    // the sweep's own client, which runs the X-Cashu refunds and their retry
    let swept: StorageAdapter | undefined;
    const deps = {
      ...(await setup()).deps,
      keys: here,
      sdk: {
        ...sdk,
        client: (wallet, storage) => sdk.client(wallet, (swept ??= storage)),
      } satisfies Sdk,
    };
    await refundCredit(deps, true);
    const wallet = sdkWallet(fakePurse().purse, () => true, false);

    // the other tab holds a refund its mint would not take yet
    const release = await there.lock();
    await there.reload();
    new CashuSpender(wallet, there.storage()).cacheReceiveToken(tokenOf(11));
    await there.flush();
    release();
    // two minutes on, this sweep's retry gives up on a token and holds it
    new CashuSpender(wallet, swept!).cacheReceiveToken(tokenOf(22));
    await swept!.flush?.();

    await there.reload();
    const held = there.storage().getCachedReceiveTokens();
    expect(held.map((t) => t.token).sort()).toEqual(
      [tokenOf(11), tokenOf(22)].sort()
    );
    expect(locks.held).toBe(0);
  });
});

describe("refundCredit: a payout the mint calls spent", () => {
  afterEach(() => vi.unstubAllGlobals());

  // the provider pays a key out again, and the mint says that payout is spent
  async function replayed() {
    provider({ [LARGE]: 0 });
    const account = await setup();
    account.others.push({
      baseUrl: LARGE,
      key: "sk-lost-device",
      balance: 0,
      lastUsed: null,
    });
    account.wallet.purse.take.mockRejectedValue(
      Object.assign(new Error("Token already spent"), { code: 11001 })
    );
    return account;
  }

  it("is done when the provider says the token was spent: this wallet already took it", async () => {
    const { deps } = await replayed();
    const adopt = vi.fn(async () => 0);

    const results = await refundCredit({ ...deps, adopt }, true);

    expect(adopt).toHaveBeenCalledWith(`refund-${LARGE}`, LARGE);
    expect(results).toContainEqual({ baseUrl: LARGE, success: true });
    expect(deps.otherDevices.drop).toHaveBeenCalledWith(["sk-lost-device"]);
  });

  it("is done for this device's own key on the Refund button too", async () => {
    provider({ [LARGE]: 0 });
    const { deps, direct, wallet } = await setup();
    direct.setApiKey(LARGE, "sk-mine");
    wallet.purse.take.mockRejectedValue(
      Object.assign(new Error("Token already spent"), { code: 11001 })
    );
    const adopt = vi.fn(async () => 0);

    const results = await refundCredit({ ...deps, adopt }, true);

    expect(adopt).toHaveBeenCalledWith(`refund-${LARGE}`, LARGE);
    expect(results).toContainEqual({ baseUrl: LARGE, success: true });
    expect(direct.getAllApiKeys()).toEqual([]);
  });

  it("keeps the key when the provider does not say", async () => {
    const { deps } = await replayed();

    const results = await refundCredit(deps, true);

    expect(results).toContainEqual({ baseUrl: LARGE, success: false });
    expect(deps.otherDevices.drop).not.toHaveBeenCalled();
  });

  it("asks only about a payout: a spent token outside one does not reach the provider", async () => {
    const { deps, wallet } = await setup();
    const adopt = vi.fn(async () => 0);
    wallet.purse.take.mockRejectedValue(
      Object.assign(new Error("Token already spent"), { code: 11001 })
    );

    const result = await sdkWallet(
      wallet.purse,
      () => true,
      false
    ).receiveToken(tokenOf(5));
    await refundCredit({ ...deps, adopt }, true);

    expect(result.success).toBe(false);
    expect(adopt).not.toHaveBeenCalled();
  });
});
