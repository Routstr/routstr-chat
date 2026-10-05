import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDriver } from "@routstr/sdk/storage";
import type { WalletAdapter } from "@routstr/sdk/wallet";
import { createPaymentStore } from "../paymentStore";
import { bindPaymentWallet, bindProviderStorage } from "../paymentRequest";

const base = "https://provider.example/";

describe("account payment storage", () => {
  it("keeps accounts separate and restores the original account's credit after reload", async () => {
    const diskA = createMemoryDriver();
    const a = createPaymentStore(diskA);
    const b = createPaymentStore(createMemoryDriver());
    await Promise.all([a.hydrate, b.hydrate]);
    a.storage.setApiKey(base, "account-a-fixture");
    a.storage.updateApiKeyBalance(base, 12);
    await a.storage.flush?.();
    expect(b.storage.getApiKey(base)).toBeNull();
    const reloaded = createPaymentStore(diskA);
    await reloaded.hydrate;
    expect(reloaded.storage.getApiKey(base)).toMatchObject({
      key: "account-a-fixture",
      balance: 12,
    });
  });

  it("reloads another tab's newer balance instead of restoring an older maximum", async () => {
    const driver = createMemoryDriver();
    const a = createPaymentStore(driver);
    await a.hydrate;
    a.storage.setApiKey(base, "fixture");
    a.storage.updateApiKeyBalance(base, 20);
    await a.storage.flush?.();
    const b = createPaymentStore(driver);
    await b.hydrate;
    b.storage.updateApiKeyBalance(base, 5);
    await b.storage.flush?.();
    await a.reload();
    expect(a.storage.getApiKey(base)?.balance).toBe(5);
  });

  it("keeps a held refund token once, after a reload", async () => {
    const driver = createMemoryDriver();
    const payments = createPaymentStore(driver);
    await payments.hydrate;
    await payments.hold("not-a-real-token");
    await payments.hold("not-a-real-token");
    const reloaded = createPaymentStore(driver);
    await reloaded.hydrate;
    expect(
      reloaded.storage.getCachedReceiveTokens().map((entry) => entry.token)
    ).toEqual(["not-a-real-token"]);
  });

  it("does not route or move credit to a provider the user did not choose", async () => {
    const payments = createPaymentStore(createMemoryDriver());
    await payments.hydrate;
    payments.storage.setApiKey(base, "chosen");
    payments.storage.setApiKey("https://other.example/", "other");
    const bound = bindProviderStorage(payments.storage, base);
    expect(bound.getAllApiKeys().map((key) => key.key)).toEqual(["chosen"]);
    expect(() => bound.getApiKey("https://other.example/")).toThrow(
      "Choose a provider"
    );
  });
});

describe("payment owner", () => {
  const hold = vi.fn(async () => ({ amount: 1, unit: "sat" as const, added: true }));
  beforeEach(() => hold.mockClear());

  function wallet() {
    return {
      getBalances: vi.fn(async () => ({ mint: 10 })),
      getMintUnits: () => ({ mint: "sat" as const }),
      getActiveMintUrl: () => "mint",
      sendToken: vi.fn(async () => "fixture-token"),
      receiveToken: vi.fn(async () => ({
        success: true,
        amount: 1,
        unit: "sat" as const,
      })),
    } satisfies WalletAdapter;
  }

  it("stops a top-up after the account changes during a wait", async () => {
    const source = wallet();
    let current = true;
    const bound = bindPaymentWallet(
      source,
      () => current,
      new AbortController().signal,
      false,
      hold
    );
    await bound.getBalances();
    current = false;
    await expect(bound.sendToken("mint", 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    // A late refund is held for the payer, not credited to the active account.
    await expect(bound.receiveToken("fixture")).resolves.toMatchObject({
      success: true,
    });
    expect(hold).toHaveBeenCalledWith("fixture");
    expect(source.sendToken).not.toHaveBeenCalled();
    expect(source.receiveToken).not.toHaveBeenCalled();
  });

  it("never funds remote-node requests from the local wallet", async () => {
    const source = wallet();
    const bound = bindPaymentWallet(
      source,
      () => true,
      new AbortController().signal,
      true,
      hold
    );
    await expect(bound.sendToken("mint", 7)).rejects.toThrow("refusing to pay");
    expect(source.sendToken).not.toHaveBeenCalled();
  });

  it("stops funding after Stop is pressed", async () => {
    const source = wallet();
    const controller = new AbortController();
    const bound = bindPaymentWallet(
      source,
      () => true,
      controller.signal,
      false,
      hold
    );
    controller.abort();
    await expect(bound.sendToken("mint", 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(source.sendToken).not.toHaveBeenCalled();
    // The refund for the stopped reply still reaches the same wallet.
    await bound.receiveToken("fixture");
    expect(source.receiveToken).toHaveBeenCalledWith("fixture");
    expect(hold).not.toHaveBeenCalled();
  });
});
