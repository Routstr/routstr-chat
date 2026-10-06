import { describe, expect, it, vi } from "vitest";
import { createMemoryDriver, type StorageDriver } from "@routstr/sdk/storage";
import { BalanceManager } from "@routstr/sdk/wallet";
import type { Purse, Sdk } from "../ports";
import { createPay, sdkWallet } from "../request";
import {
  fakeKeys,
  fakeLock,
  fakePurse,
  fakeSdk,
  MINT,
  tabKeys,
  tokenOf,
} from "./fakes";

type RequestArgs = Parameters<Sdk["request"]>;

const callbacks = () => ({
  onStreamingUpdate: vi.fn(),
  onThinkingUpdate: vi.fn(),
  onMessageAppend: vi.fn(),
  onPaymentProcessing: vi.fn(),
  onRequestId: vi.fn(),
});
const request = {
  messages: [{ role: "user", content: "hi" }],
  model: { id: "m" },
};
const NODE = { url: "https://node.example/", apiKey: "node-key" };
const P1 = "https://one.example/";
const P2 = "https://two.example/";

/** An SDK call the test finishes by hand. */
function heldFetch() {
  const calls: Array<{
    args: RequestArgs;
    finish(): void;
    fail(e: Error): void;
  }> = [];
  const request = vi.fn(
    (...args: RequestArgs) =>
      new Promise<void>((finish, fail) => calls.push({ args, finish, fail }))
  );
  return { request, calls };
}

async function setup(
  spending: { mode: "apikeys" | "xcashu"; node?: typeof NODE } = {
    mode: "apikeys",
  }
) {
  const credit = fakeKeys();
  await credit.keys.ready();
  const wallet = fakePurse();
  const fetch = heldFetch();
  const sdk = fakeSdk(fetch.request);
  const current = { spending };
  const pay = createPay({
    keys: credit.keys,
    purse: wallet.purse,
    sdk,
    spending: () => current.spending,
    live: () => true,
  });
  return {
    pay,
    credit,
    wallet,
    fetch,
    sdk,
    current,
  };
}

/** One request paid in this tab, with a key at P1; another tab shares the
 *  disk and the lock. The SDK keeps the request's storage. */
async function paidInOneOfTwoTabs(disk: StorageDriver = createMemoryDriver()) {
  const locks = fakeLock();
  const [here, there] = [tabKeys(disk, locks), tabKeys(disk, locks)];
  await Promise.all([here.ready(), there.ready()]);
  here.storage().setApiKey(P1, "k1");
  await here.flush();
  const { request: fetchAI, calls } = heldFetch();
  const pay = createPay({
    keys: here,
    purse: fakePurse().purse,
    sdk: fakeSdk(fetchAI),
    spending: () => ({ mode: "apikeys" }),
    live: () => true,
  });
  const paying = pay(request, callbacks(), new AbortController().signal);
  await tick();
  const storage = calls[0].args[0].storageAdapter!;
  calls[0].finish();
  await paying;
  return { storage, there, locks };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A purse like the wallet book's: a send holds the account's wallet lock
 *  across the mint swap and the SDK's handoff. The first swap waits for the
 *  test. */
function lockingPurse(walletLock: ReturnType<typeof fakeLock>) {
  let answer!: () => void;
  const firstSwap = new Promise<void>((resolve) => (answer = resolve));
  let first = true;
  const purse: Purse = {
    balances: async () => ({ [MINT]: 100 }),
    activeMint: () => MINT,
    send: async (_mint, sats, handoff) => {
      const unlock = await walletLock.lock();
      try {
        if (first) {
          first = false;
          await firstSwap;
        }
        const token = tokenOf(sats);
        await handoff?.(token);
        return token;
      } finally {
        unlock();
      }
    },
    receive: async () => 1,
  };
  return { purse, answerSwap: () => answer() };
}

/** A disk that refuses one write when told, as a full or busy IndexedDB can. */
function flakyDisk() {
  const disk = createMemoryDriver();
  let refuse = false;
  return {
    ...disk,
    setItem: async (key: string, value: unknown) => {
      if (refuse) {
        refuse = false;
        throw new Error("The disk refused the write");
      }
      return disk.setItem(key, value);
    },
    refuseNext: () => (refuse = true),
  };
}

describe("sdkWallet", () => {
  it("stops spending once the request may no longer spend", async () => {
    const { purse } = fakePurse();
    let allowed = true;
    const wallet = sdkWallet(purse, () => allowed, false);
    await wallet.getBalances();

    allowed = false;

    await expect(wallet.sendToken(MINT, 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(wallet.getBalances()).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(purse.send).not.toHaveBeenCalled();
  });

  it("still takes a refund into the account that paid", async () => {
    const { purse, received } = fakePurse();
    const wallet = sdkWallet(purse, () => false, false);

    const result = await wallet.receiveToken(tokenOf(5));

    expect(result).toMatchObject({ success: true });
    expect(received).toEqual([tokenOf(5)]);
  });

  it("never pays from the wallet while a node pays", async () => {
    const { purse } = fakePurse();
    const wallet = sdkWallet(purse, () => true, true);

    await expect(wallet.sendToken(MINT, 7)).rejects.toThrow("refusing to pay");
    expect(purse.send).not.toHaveBeenCalled();
  });

  it("hands the SDK's store step to the wallet, so the token is never unowned", async () => {
    const { purse } = fakePurse();
    const handoff = vi.fn(async () => {});

    await sdkWallet(purse, () => true, false).sendToken(
      MINT,
      7,
      undefined,
      handoff
    );

    expect(purse.send).toHaveBeenCalledWith(MINT, 7, handoff);
    expect(handoff).toHaveBeenCalledWith(tokenOf(7));
  });

  it("lets the SDK read every balance as sats, whatever unit the mint keeps", async () => {
    const { purse } = fakePurse(5_000);
    const client = fakeSdk().client(
      sdkWallet(purse, () => true, false),
      fakeKeys().keys.storage()
    );

    const state = await client.getBalanceManager().getBalanceState();

    expect(state.mintBalances).toEqual({ [MINT]: 5_000 });
  });

  it("counts a payout the wallet already took as received", async () => {
    const { purse } = fakePurse();
    purse.receive.mockRejectedValueOnce(
      Object.assign(new Error("proofs already spent"), { code: 11001 })
    );

    const result = await sdkWallet(purse, () => true, false).receiveToken(
      tokenOf(5)
    );

    expect(result).toEqual({ success: true, amount: 0, unit: "sat" });
  });

  it("tells the SDK a refund did not land, so it keeps the token", async () => {
    const { purse } = fakePurse();
    purse.receive.mockRejectedValueOnce(new Error("mint unreachable"));

    const result = await sdkWallet(purse, () => true, false).receiveToken(
      tokenOf(5)
    );

    expect(result).toEqual({
      success: false,
      amount: 0,
      unit: "sat",
      message: "mint unreachable",
    });
  });
});

describe("createPay", () => {
  it("pays with API keys by default and X-Cashu when chosen", async () => {
    const a = await setup();
    void a.pay(request, callbacks(), new AbortController().signal);
    await tick();
    expect(a.fetch.calls[0].args[0]).toMatchObject({
      mode: "apikeys",
      modelId: "m",
    });

    const b = await setup({ mode: "xcashu" });
    void b.pay(request, callbacks(), new AbortController().signal);
    await tick();
    expect(b.fetch.calls[0].args[0]).toMatchObject({ mode: "xcashu" });
  });

  it("holds the account's payment lock until the payment is settled", async () => {
    const { pay, credit, fetch } = await setup();

    const first = pay(request, callbacks(), new AbortController().signal);
    const second = pay(request, callbacks(), new AbortController().signal);
    await tick();
    expect(fetch.calls).toHaveLength(1);
    expect(credit.held).toBe(1);

    fetch.calls[0].finish();
    await first;
    await tick();
    expect(fetch.calls).toHaveLength(2);
    expect(credit.keys.flush).toHaveBeenCalledWith("direct");

    fetch.calls[1].finish();
    await second;
    expect(credit.held).toBe(0);
  });

  it("reads what other tabs wrote before paying", async () => {
    const { pay, credit, fetch } = await setup();

    void pay(request, callbacks(), new AbortController().signal);
    await tick();

    expect(credit.keys.reload).toHaveBeenCalledWith("direct");
    expect(credit.keys.reload.mock.invocationCallOrder[0]).toBeLessThan(
      fetch.request.mock.invocationCallOrder[0]
    );
  });

  it("never reaches the provider when stopped while waiting for the lock", async () => {
    const { pay, credit, fetch } = await setup();
    const running = pay(request, callbacks(), new AbortController().signal);
    const controller = new AbortController();
    const waiting = pay(request, callbacks(), controller.signal);
    await tick();

    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    fetch.calls[0].finish();
    await running;

    expect(fetch.calls).toHaveLength(1);
    expect(credit.held).toBe(0);
  });

  it("never reaches the provider when stopped while reading other tabs' writes", async () => {
    const { pay, credit, fetch } = await setup();
    const controller = new AbortController();
    credit.keys.reload.mockImplementationOnce(async () => controller.abort());

    await pay(request, callbacks(), controller.signal);

    expect(fetch.calls).toHaveLength(0);
    expect(credit.held).toBe(0);
  });

  it("releases the lock when the credit cannot be written", async () => {
    const { pay, credit, fetch } = await setup();
    credit.keys.flush.mockRejectedValueOnce(new Error("disk full"));
    const paying = pay(request, callbacks(), new AbortController().signal);
    await tick();

    fetch.calls[0].finish();

    await expect(paying).rejects.toThrow("disk full");
    expect(credit.held).toBe(0);
  });

  it("releases the lock when the SDK throws", async () => {
    const { pay, credit, fetch } = await setup();
    const paying = pay(request, callbacks(), new AbortController().signal);
    await tick();

    fetch.calls[0].fail(new Error("boom"));

    await expect(paying).rejects.toThrow("boom");
    expect(credit.held).toBe(0);
  });

  it("refuses a background top-up that outlives the payment lock", async () => {
    const { pay, fetch, wallet } = await setup();
    const paying = pay(request, callbacks(), new AbortController().signal);
    await tick();
    const late = fetch.calls[0].args[0].walletAdapter!;

    fetch.calls[0].finish();
    await paying;

    await expect(late.sendToken(MINT, 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    await late.receiveToken(tokenOf(3));
    expect(wallet.sent).toEqual([]);
    expect(wallet.received).toEqual([tokenOf(3)]);
  });

  it("keeps a key another tab made when the SDK writes after the payment settled", async () => {
    const { storage, there, locks } = await paidInOneOfTwoTabs();

    // the other tab makes a key while this tab's margin top-up is out
    const release = await there.lock();
    await there.reload();
    there.storage().setApiKey(P2, "k2");
    await there.flush();
    release();
    // the top-up lands: the SDK records the key's new balance
    storage.updateApiKeyBalance(P1, 150);
    await storage.flush?.();

    await there.reload();
    expect(there.storage().getApiKey(P1)?.balance).toBe(150);
    expect(there.storage().getApiKey(P2)?.key).toBe("k2");
    expect(locks.held).toBe(0);
  });

  it("makes a late write only once the other tab is done with the credit", async () => {
    const { storage, there } = await paidInOneOfTwoTabs();

    const release = await there.lock();
    await there.reload();
    storage.updateApiKeyBalance(P1, 150);
    await tick();
    there.storage().setApiKey(P2, "k2");
    await there.flush();
    release();
    await storage.flush?.();

    await there.reload();
    expect(there.storage().getApiKey(P1)?.balance).toBe(150);
    expect(there.storage().getApiKey(P2)?.key).toBe("k2");
  });

  it("writes a late change again when the disk refused it once", async () => {
    const disk = flakyDisk();
    const { storage, there } = await paidInOneOfTwoTabs(disk);

    disk.refuseNext();
    storage.updateApiKeyBalance(P1, 150);

    await vi.waitFor(async () => {
      await there.reload();
      expect(there.storage().getApiKey(P1)?.balance).toBe(150);
    });
  });

  it("finishes a spend under way before letting go of the lock, so its handoff never waits on it", async () => {
    const keyLock = fakeLock();
    const walletLock = fakeLock();
    const keys = tabKeys(createMemoryDriver(), keyLock);
    await keys.ready();
    const { purse, answerSwap } = lockingPurse(walletLock);
    let topUpOut!: () => void;
    const out = new Promise<void>((resolve) => (topUpOut = resolve));
    let first = true;
    const sdk = fakeSdk(async ({ walletAdapter, storageAdapter }) => {
      const wallet = walletAdapter!;
      const storage = storageAdapter!;
      if (first) {
        first = false;
        // the SDK's margin top-up, which it does not wait for
        void new BalanceManager(wallet, storage)
          .createProviderToken({ mintUrl: MINT, baseUrl: P1, amount: 5 })
          .catch(() => {});
        await tick();
        return topUpOut();
      }
      await wallet.sendToken(MINT, 7, undefined, async (token) => {
        storage.addXcashuToken(P2, token);
        await storage.flush?.();
      });
    });
    const pay = createPay({
      keys,
      purse,
      sdk,
      spending: () => ({ mode: "apikeys" }),
      live: () => true,
    });
    const answered = pay(request, callbacks(), new AbortController().signal);
    await out;
    const next = pay(request, callbacks(), new AbortController().signal);
    await tick();
    answerSwap();

    await Promise.all([answered, next]);
    expect([keyLock.held, walletLock.held]).toEqual([0, 0]);
    expect(keys.storage().getXcashuTokensForBaseUrl(P1)).toHaveLength(1);
  });

  it("stops spending after Stop", async () => {
    const { pay, fetch, wallet } = await setup();
    const controller = new AbortController();
    void pay(request, callbacks(), controller.signal);
    await tick();
    const sdkPays = fetch.calls[0].args[0].walletAdapter!;

    controller.abort();

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(wallet.sent).toEqual([]);
  });

  it("forces a pinned provider only when the SDK reads the warm cache", async () => {
    const cold = await setup();
    void cold.pay(
      { ...request, model: { id: "m", provider: "https://p.example/" } },
      callbacks(),
      new AbortController().signal
    );
    await tick();
    expect(cold.fetch.calls[0].args[0].forcedProvider).toBeUndefined();

    const warm = await setup();
    const managers = {
      modelManager: {} as never,
      providerManager: {} as never,
    };
    warm.sdk.warm.mockReturnValue(managers as never);
    void warm.pay(
      { ...request, model: { id: "m", provider: "https://p.example/" } },
      callbacks(),
      new AbortController().signal
    );
    await tick();
    expect(warm.fetch.calls[0].args[0]).toMatchObject({
      forcedProvider: "https://p.example/",
      ...managers,
    });
  });
});

describe("createPay in node mode", () => {
  it("routes only to the node, with the node's key, and never spends the wallet", async () => {
    const { pay, fetch, credit, sdk, wallet } = await setup({
      mode: "xcashu",
      node: NODE,
    });
    void pay(request, callbacks(), new AbortController().signal);
    await tick();
    const [options] = fetch.calls[0].args;

    expect(sdk.ensureNode).toHaveBeenCalledWith(NODE.url);
    expect(options).toMatchObject({
      forcedProvider: NODE.url,
      mode: "apikeys",
    });
    expect(options.storageAdapter!.getApiKey(NODE.url)?.key).toBe("node-key");
    expect(credit.keys.flush).toHaveBeenCalledWith("node");
    await expect(options.walletAdapter!.sendToken(MINT, 7)).rejects.toThrow(
      "refusing to pay"
    );
    expect(wallet.sent).toEqual([]);
  });

  it("pays with the node's new key after it was connected again", async () => {
    const { pay, fetch, credit } = await setup({ mode: "apikeys", node: NODE });
    credit.stores.node.storage.setApiKey(NODE.url, "old-node-key");

    void pay(request, callbacks(), new AbortController().signal);
    await tick();

    const [options] = fetch.calls[0].args;
    expect(options.storageAdapter!.getApiKey(NODE.url)?.key).toBe("node-key");
  });

  it("stops spending when the node changes mid-request", async () => {
    const { pay, fetch, current } = await setup({ mode: "apikeys" });
    void pay(request, callbacks(), new AbortController().signal);
    await tick();
    const sdkPays = fetch.calls[0].args[0].walletAdapter!;

    current.spending = { mode: "apikeys", node: NODE };

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("never routes a node request after node mode was turned off while it waited", async () => {
    const { pay, fetch, credit, sdk, current } = await setup({
      mode: "apikeys",
      node: NODE,
    });
    const release = await credit.keys.lock();
    const paying = pay(request, callbacks(), new AbortController().signal);

    current.spending = { mode: "apikeys" };
    release();

    await expect(paying).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.ensureNode).not.toHaveBeenCalled();
    expect(fetch.calls).toHaveLength(0);
  });

  it("never routes a node request after node mode was turned off while the node's models loaded", async () => {
    const { pay, fetch, sdk, current } = await setup({
      mode: "apikeys",
      node: NODE,
    });
    sdk.ensureNode.mockImplementationOnce(async () => {
      current.spending = { mode: "apikeys" };
    });

    await expect(
      pay(request, callbacks(), new AbortController().signal)
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch.calls).toHaveLength(0);
  });

  it("words the SDK's failures for someone the node pays for", async () => {
    const { pay, fetch } = await setup({ mode: "apikeys", node: NODE });
    const cb = callbacks();
    void pay(request, cb, new AbortController().signal);
    await tick();

    fetch.calls[0].args[1].onMessageAppend({
      role: "system",
      content: "Uncaught Error: Insufficient balance",
    });

    expect(cb.onMessageAppend).toHaveBeenCalledWith({
      role: "system",
      content: expect.stringContaining("The node is out of credit"),
    });
  });
});
