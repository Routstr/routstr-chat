import { describe, expect, it, vi } from "vitest";
import { RoutstrClient } from "../client/RoutstrClient";
import type {
  ProviderRegistry,
  StorageAdapter,
  WalletAdapter,
} from "../wallet/interfaces";

const createWallet = (
  overrides?: Partial<WalletAdapter>
): WalletAdapter => ({
  getBalances: async () => ({}),
  getMintUnits: () => ({}),
  getActiveMintUrl: () => null,
  sendToken: async () => "token",
  receiveToken: async () => ({ success: true, amount: 0, unit: "sat" }),
  ...overrides,
});

const createStorage = (
  overrides?: Partial<StorageAdapter>
): StorageAdapter => ({
  saveProviderInfo: () => {},
  getProviderInfo: () => null,
  getApiKey: () => null,
  setApiKey: () => {},
  updateApiKeyBalance: () => {},
  removeApiKey: () => {},
  getAllApiKeys: () => [],
  getApiKeyDistribution: () => [],
  getChildKey: () => null,
  setChildKey: () => {},
  updateChildKeyBalance: () => {},
  removeChildKey: () => {},
  getAllChildKeys: () => [],
  getCachedReceiveTokens: () => [],
  setCachedReceiveTokens: () => {},
  getXcashuTokens: () => ({}),
  getXcashuTokensForBaseUrl: () => [],
  addXcashuToken: () => {},
  removeXcashuToken: () => {},
  clearXcashuTokensForBaseUrl: () => {},
  updateXcashuTokenTryCount: () => {},
  ...overrides,
});

const createRegistry = (
  overrides?: Partial<ProviderRegistry>
): ProviderRegistry => ({
  getModelsForProvider: () => [],
  getDisabledProviders: () => [],
  getProviderMints: () => [],
  getProviderInfo: async () => null,
  getAllProvidersModels: () => ({}),
  ...overrides,
});

describe("RoutstrClient provider balance handling", () => {
  it("carries the topped-up provider balance into the retried response", async () => {
    const client = new RoutstrClient(
      createWallet(),
      createStorage(),
      createRegistry(),
      "min",
      "apikeys"
    );
    const getTokenBalance = vi
      .fn()
      .mockResolvedValue({ amount: 100, unit: "sat" });
    const topUp = vi.fn().mockResolvedValue({
      success: true,
      toppedUpAmount: 180,
      message: "ok",
    });
    const retriedResponse = new Response("ok", { status: 200 });
    const makeRequest = vi.fn().mockResolvedValue(retriedResponse);

    (client as any).balanceManager = {
      getTokenBalance,
      topUp,
    };
    (client as any)._makeRequest = makeRequest;

    const response = await (client as any)._handleErrorResponse(
      {
        path: "/v1/chat/completions",
        method: "POST",
        body: { stream: false },
        baseUrl: "https://provider.example.com",
        mintUrl: "https://mint.example.com",
        token: "provider-token",
        requiredSats: 250,
        headers: { Authorization: "Bearer provider-token" },
        baseHeaders: { "Content-Type": "application/json" },
      },
      "provider-token",
      402,
      undefined,
      undefined,
      "Insufficient balance",
      0
    );

    expect(response).toBe(retriedResponse);
    expect(topUp).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://provider.example.com",
        mintUrl: "https://mint.example.com",
        token: "provider-token",
        amount: 180,
      })
    );
    expect(makeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ retryCount: 1 })
    );
    expect((retriedResponse as any).initialTokenBalanceOverride).toBe(280);
  });

  it("uses the topped-up starting balance and forces immediate provider refunds", async () => {
    const updateApiKeyBalance = vi.fn();
    const trackResponseUsage = vi.fn().mockResolvedValue(undefined);
    const refundXcashuTokens = vi.fn().mockResolvedValue([]);
    const refundProviders = vi.fn().mockResolvedValue([]);
    const client = new RoutstrClient(
      createWallet(),
      createStorage({
        getApiKey: () => null,
        updateApiKeyBalance,
      }),
      createRegistry(),
      "min",
      "apikeys"
    );
    const response = new Response("ok", { status: 200 });

    (response as any).initialTokenBalanceOverride = 300;
    (client as any).balanceManager = {
      getTokenBalance: vi
        .fn()
        .mockResolvedValue({ amount: 260, unit: "sat", apiKey: undefined }),
    };
    (client as any).cashuSpender = {
      refundXcashuTokens,
      refundProviders,
    };
    (client as any)._trackResponseUsage = trackResponseUsage;

    const satsSpent = await (client as any)._handlePostResponseBalanceUpdate({
      token: "provider-token",
      baseUrl: "https://provider.example.com",
      mintUrl: "https://mint.example.com",
      initialTokenBalance: 40,
      response,
      modelId: "gpt-5.4",
    });

    expect(satsSpent).toBe(40);
    expect(updateApiKeyBalance).toHaveBeenCalledWith(
      "https://provider.example.com",
      260
    );
    expect(trackResponseUsage).toHaveBeenCalledWith(
      expect.objectContaining({ satsSpent: 40 })
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(refundXcashuTokens).toHaveBeenCalledWith(
      "https://mint.example.com"
    );
    expect(refundProviders).toHaveBeenCalledWith(
      "https://mint.example.com",
      true
    );
  });
});
