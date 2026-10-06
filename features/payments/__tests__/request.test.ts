import { describe, expect, it, vi } from "vitest";
import type { Sdk } from "../ports";
import { createPay, sdkWallet } from "../request";
import { fakeKeys, fakePurse, fakeSdk, MINT, tokenOf } from "./fakes";

type RequestArgs = Parameters<Sdk["request"]>;

const callbacks = () => ({
  onStreamingUpdate: vi.fn(),
  onThinkingUpdate: vi.fn(),
  onMessageAppend: vi.fn(),
  onPaymentProcessing: vi.fn(),
  onRequestId: vi.fn(),
});
const request = { messages: [{ role: "user", content: "hi" }], model: { id: "m" } };
const NODE = { url: "https://node.example/", apiKey: "node-key" };

/** An SDK call the test finishes by hand. */
function heldFetch() {
  const calls: Array<{ args: RequestArgs; finish(): void; fail(e: Error): void }> = [];
  const request = vi.fn(
    (...args: RequestArgs) =>
      new Promise<void>((finish, fail) => calls.push({ args, finish, fail }))
  );
  return { request, calls };
}

async function setup(spending: { mode: "apikeys" | "xcashu"; node?: typeof NODE } = { mode: "apikeys" }) {
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("sdkWallet", () => {
  it("stops spending once the request may no longer spend", async () => {
    const { purse } = fakePurse();
    let allowed = true;
    const wallet = sdkWallet(purse, () => allowed, false);
    await wallet.getBalances();

    allowed = false;

    await expect(wallet.sendToken(MINT, 7)).rejects.toMatchObject({ name: "AbortError" });
    await expect(wallet.getBalances()).rejects.toMatchObject({ name: "AbortError" });
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

    await sdkWallet(purse, () => true, false).sendToken(MINT, 7, undefined, handoff);

    expect(purse.send).toHaveBeenCalledWith(MINT, 7, handoff);
    expect(handoff).toHaveBeenCalledWith(tokenOf(7));
  });

  it("lets the SDK read every balance as sats, whatever unit the mint keeps", async () => {
    const { purse } = fakePurse(5_000);
    const client = fakeSdk().client(sdkWallet(purse, () => true, false), fakeKeys().keys.storage());

    const state = await client.getBalanceManager().getBalanceState();

    expect(state.mintBalances).toEqual({ [MINT]: 5_000 });
  });

  it("tells the SDK a refund did not land, so it keeps the token", async () => {
    const { purse } = fakePurse();
    purse.receive.mockRejectedValueOnce(new Error("mint unreachable"));

    const result = await sdkWallet(purse, () => true, false).receiveToken(tokenOf(5));

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
    expect(a.fetch.calls[0].args[0]).toMatchObject({ mode: "apikeys", modelId: "m" });

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

    await expect(late.sendToken(MINT, 7)).rejects.toMatchObject({ name: "AbortError" });
    await late.receiveToken(tokenOf(3));
    expect(wallet.sent).toEqual([]);
    expect(wallet.received).toEqual([tokenOf(3)]);
  });

  it("stops spending after Stop", async () => {
    const { pay, fetch, wallet } = await setup();
    const controller = new AbortController();
    void pay(request, callbacks(), controller.signal);
    await tick();
    const sdkPays = fetch.calls[0].args[0].walletAdapter!;

    controller.abort();

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({ name: "AbortError" });
    expect(wallet.sent).toEqual([]);
  });

  it("forces a pinned provider only when the SDK reads the warm cache", async () => {
    const cold = await setup();
    void cold.pay({ ...request, model: { id: "m", provider: "https://p.example/" } }, callbacks(), new AbortController().signal);
    await tick();
    expect(cold.fetch.calls[0].args[0].forcedProvider).toBeUndefined();

    const warm = await setup();
    const managers = { modelManager: {} as never, providerManager: {} as never };
    warm.sdk.warm.mockReturnValue(managers as never);
    void warm.pay({ ...request, model: { id: "m", provider: "https://p.example/" } }, callbacks(), new AbortController().signal);
    await tick();
    expect(warm.fetch.calls[0].args[0]).toMatchObject({
      forcedProvider: "https://p.example/",
      ...managers,
    });
  });
});

describe("createPay in node mode", () => {
  it("routes only to the node, with the node's key, and never spends the wallet", async () => {
    const { pay, fetch, credit, sdk, wallet } = await setup({ mode: "xcashu", node: NODE });
    credit.stores.node.storage.setApiKey("https://other.example/", "other-key");

    void pay(request, callbacks(), new AbortController().signal);
    await tick();
    const [options] = fetch.calls[0].args;

    expect(sdk.ensureNode).toHaveBeenCalledWith(NODE.url);
    expect(options).toMatchObject({ forcedProvider: NODE.url, mode: "apikeys" });
    expect(options.storageAdapter!.getApiKey(NODE.url)?.key).toBe("node-key");
    expect(() => options.storageAdapter!.getApiKey("https://other.example/")).toThrow("only your node");
    expect(options.storageAdapter!.getAllApiKeys().map((k) => k.key)).toEqual(["node-key"]);
    expect(credit.keys.flush).toHaveBeenCalledWith("node");
    await expect(options.walletAdapter!.sendToken(MINT, 7)).rejects.toThrow("refusing to pay");
    expect(wallet.sent).toEqual([]);
  });

  it("stops spending when the node changes mid-request", async () => {
    const { pay, fetch, current } = await setup({ mode: "apikeys" });
    void pay(request, callbacks(), new AbortController().signal);
    await tick();
    const sdkPays = fetch.calls[0].args[0].walletAdapter!;

    current.spending = { mode: "apikeys", node: NODE };

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never routes a node request after node mode was turned off while it waited", async () => {
    const { pay, fetch, credit, sdk, current } = await setup({ mode: "apikeys", node: NODE });
    const release = await credit.keys.lock();
    const paying = pay(request, callbacks(), new AbortController().signal);

    current.spending = { mode: "apikeys" };
    release();

    await expect(paying).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.ensureNode).not.toHaveBeenCalled();
    expect(fetch.calls).toHaveLength(0);
  });

  it("never routes a node request after node mode was turned off while the node's models loaded", async () => {
    const { pay, fetch, sdk, current } = await setup({ mode: "apikeys", node: NODE });
    sdk.ensureNode.mockImplementationOnce(async () => {
      current.spending = { mode: "apikeys" };
    });

    await expect(pay(request, callbacks(), new AbortController().signal)).rejects.toMatchObject({
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
