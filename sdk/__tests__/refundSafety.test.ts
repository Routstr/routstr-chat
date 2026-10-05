import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDriver } from "@routstr/sdk/storage";
import type { WalletAdapter } from "@routstr/sdk/wallet";
import { createPaymentStore, getPaymentStore } from "../paymentStore";
import { bindPaymentWallet } from "../paymentRequest";
import { refundKeys, refundStorage } from "../refundCredit";

function wallet(receive: WalletAdapter["receiveToken"]) {
  return {
    getBalances: vi.fn(async () => ({})),
    getMintUnits: () => ({}),
    getActiveMintUrl: () => "https://mint.example",
    sendToken: vi.fn(async () => "fixture-token"),
    receiveToken: vi.fn(receive),
  } satisfies WalletAdapter;
}

// Automatic refunds skip keys used in the last five minutes.
function lastUsedLongAgo(payments: ReturnType<typeof createPaymentStore>) {
  payments.store.setState({
    apiKeys: payments.store
      .getState()
      .apiKeys.map((k) => ({ ...k, lastUsed: Date.now() - 10 * 60_000 })),
  });
}

describe("refund safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps each account's credit in its own store", () => {
    expect(getPaymentStore("a")).toBe(getPaymentStore("a"));
    expect(getPaymentStore("a")).not.toBe(getPaymentStore("b"));
    expect(getPaymentStore("a")).not.toBe(getPaymentStore("a", true));
  });

  it("keeps a held refund when the account switches during a refund", async () => {
    const driver = createMemoryDriver();
    const payments = createPaymentStore(driver);
    await payments.hydrate;
    await payments.hold("held-refund-fixture");
    const source = wallet(async () => ({ success: true, amount: 1, unit: "sat" }));
    let calls = 0;
    const bound = bindPaymentWallet(
      source,
      () => calls++ < 1,
      new AbortController().signal,
      false,
      payments.hold
    );

    await refundStorage(bound, payments.storage, true);

    const reloaded = createPaymentStore(driver);
    await reloaded.hydrate;
    expect(source.receiveToken).not.toHaveBeenCalled();
    expect(reloaded.storage.getCachedReceiveTokens()).toHaveLength(1);
  });

  it("leaves credit under 10 sats for the next chat unless the user refunds", async () => {
    const msats: Record<string, number> = {
      "https://small.example/": 7_500,
      "https://large.example/": 120_000,
    };
    const refunded: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const base = String(url).replace(/v1\/wallet\/.*$/, "");
        if (String(url).endsWith("v1/wallet/refund")) {
          refunded.push(base);
          msats[base] = 0;
          return new Response(JSON.stringify({ token: `refund-${base}`, sats: "1" }));
        }
        return new Response(JSON.stringify({ balance: msats[base], reserved: 0 }));
      })
    );
    const payments = createPaymentStore(createMemoryDriver());
    await payments.hydrate;
    payments.storage.setApiKey("https://small.example/", "sk-small");
    payments.storage.setApiKey("https://large.example/", "sk-large");
    const source = wallet(async () => ({ success: true, amount: 1, unit: "sat" }));

    // Just used: an automatic refund waits, a late top-up may still be coming.
    await refundStorage(source, payments.storage, false);
    expect(refunded).toEqual([]);

    lastUsedLongAgo(payments);
    await refundStorage(source, payments.storage, false);
    expect(refunded).toEqual(["https://large.example/"]);
    expect(payments.storage.getApiKey("https://small.example/")).toMatchObject({
      key: "sk-small",
      balance: 7.5,
    });

    await refundStorage(source, payments.storage, true);
    expect(refunded).toEqual(["https://large.example/", "https://small.example/"]);
    expect(payments.storage.getAllApiKeys()).toEqual([]);
  });

  it("replays a payout the wallet failed to receive on the next automatic refund", async () => {
    // Like routstr-core: an emptied key that was paid out replays its token.
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
    const payments = createPaymentStore(createMemoryDriver());
    await payments.hydrate;
    payments.storage.setApiKey("https://provider.example/", "sk-provider");
    lastUsedLongAgo(payments);
    let mintUp = false;
    const source = wallet(async () =>
      mintUp
        ? { success: true, amount: 120, unit: "sat" }
        : { success: false, amount: 0, unit: "sat", message: "mint unreachable" }
    );

    await refundStorage(source, payments.storage, false);
    expect(payments.storage.getApiKey("https://provider.example/")).not.toBeNull();

    mintUp = true;
    await refundStorage(source, payments.storage, false);
    expect(source.receiveToken).toHaveBeenLastCalledWith("payout-fixture");
    expect(payments.storage.getAllApiKeys()).toEqual([]);
  });

  it("clears a key the provider no longer knows on an automatic refund", async () => {
    const notFound = JSON.stringify({
      detail: {
        error: { message: "Key not found", type: "invalid_request_error", code: "key_not_found" },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(notFound, { status: 401 })));
    const payments = createPaymentStore(createMemoryDriver());
    await payments.hydrate;
    payments.storage.setApiKey("https://provider.example/", "sk-forgotten");
    lastUsedLongAgo(payments);

    await refundStorage(wallet(async () => ({ success: true, amount: 0, unit: "sat" })), payments.storage, false);

    expect(payments.storage.getAllApiKeys()).toEqual([]);
  });

  it("counts another device's key as done when the provider reports it empty", async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(JSON.stringify({ balance: 0, reserved: 0 }))
    );
    vi.stubGlobal("fetch", fetch);
    const payments = createPaymentStore(createMemoryDriver());
    await payments.hydrate;

    const [result] = await refundKeys(wallet(async () => ({ success: true, amount: 0, unit: "sat" })), payments.storage, [
      { baseUrl: "https://provider.example/", key: "sk-gone-device", balance: 0, lastUsed: null },
    ]);

    expect(result.success).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("v1/wallet/refund"))).toBe(false);
  });

  it("keeps another device's key when its refund could not be received", async () => {
    // The key holds 120 sats until the provider pays them out, then reads 0.
    let paidOut = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).endsWith("v1/wallet/refund")) {
          return new Response(
            JSON.stringify({ balance: paidOut ? 0 : 120_000, reserved: 0 })
          );
        }
        paidOut = true;
        return new Response(
          JSON.stringify({ token: "paid-out-fixture", sats: "120" })
        );
      })
    );
    const payments = createPaymentStore(createMemoryDriver());
    await payments.hydrate;
    const source = wallet(async () => ({
      success: false,
      amount: 0,
      unit: "sat",
      message: "Failed to fetch",
    }));

    const [result] = await refundKeys(source, payments.storage, [
      { baseUrl: "https://provider.example/", key: "sk-other-device", balance: 120, lastUsed: null },
    ]);

    expect(source.receiveToken).toHaveBeenCalledWith("paid-out-fixture");
    expect(result.success).toBe(false);
  });
});
