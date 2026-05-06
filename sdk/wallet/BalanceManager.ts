/**
 * BalanceManager - Handles refunding and topping up tokens from providers
 *
 * Handles:
 * - Fetching refund tokens from provider API
 * - Receiving/storing refunded tokens
 * - Topping up API key balances with cashu tokens
 * - Error handling for various refund/topup failure modes
 *
 * Extracted from utils/cashuUtils.ts
 */

import type {
  WalletAdapter,
  StorageAdapter,
  ProviderRegistry,
} from "./interfaces";
import type { RefundResult, TopUpResult } from "../core/types";
import { InsufficientBalanceError } from "../core/errors";
import { CashuSpender } from "./CashuSpender";
import {
  getBalanceInSats,
  isNetworkErrorMessage,
  selectMintWithBalance,
} from "./tokenUtils";

/**
 * Options for refunding API key balance
 */
export interface RefundApiKeyOptions {
  /** The mint URL (for NIP-60 wallet operations) */
  mintUrl: string;

  /** The provider base URL */
  baseUrl: string;

  /** The API key to use for authentication */
  apiKey: string;

  /** If true, forces refund even if the API key was used recently */
  forceRefund?: boolean;
}

/**
 * Options for topping up API key balance
 */
export interface TopUpOptions {
  /** The mint URL to spend from */
  mintUrl: string;

  /** The provider base URL */
  baseUrl: string;

  /** Amount to top up in sats */
  amount: number;

  /** Optional specific API key to top up (if not provided, uses stored token) */
  token?: string;
}

export interface CreateProviderTokenOptions {
  mintUrl: string;
  baseUrl: string;
  amount: number;
  p2pkPubkey?: string;
  excludeMints?: string[];
  retryCount?: number;
}

export interface ProviderTokenResult {
  success: boolean;
  token?: string;
  error?: string;
  selectedMintUrl?: string;
  amountSpent?: number;
}

export interface BalanceState {
  totalBalance: number;
  providerBalances: Record<string, number>;
  mintBalances: Record<string, number>;
}

/**
 * BalanceManager handles token refunds and topups from providers
 */
export class BalanceManager {
  private cashuSpender: CashuSpender;
  /** In-memory guard for per-provider wallet mutations (topup / refund) */
  private providerWalletOps: Map<
    string,
    { type: "topup" | "refund"; startTime: number; endTime?: number }
  > = new Map();
  /** Cooldown (ms) between opposite operations on the same provider */
  private static readonly PROVIDER_WALLET_COOLDOWN_MS = 10_000;

  constructor(
    private walletAdapter: WalletAdapter,
    private storageAdapter: StorageAdapter,
    private providerRegistry?: ProviderRegistry,
    cashuSpender?: CashuSpender
  ) {
    if (cashuSpender) {
      this.cashuSpender = cashuSpender;
    } else {
      this.cashuSpender = new CashuSpender(
        walletAdapter,
        storageAdapter,
        providerRegistry,
        this
      );
    }
  }

  /**
   * Check whether a wallet operation (topup/refund) may run for a provider.
   * Returns the reason when blocked.
   */
  private _canRunProviderWalletOperation(
    baseUrl: string,
    type: "topup" | "refund"
  ): { allowed: boolean; reason?: string } {
    const existing = this.providerWalletOps.get(baseUrl);
    if (!existing) {
      return { allowed: true };
    }
    if (existing.type === type) {
      return { allowed: true };
    }
    // Opposite type in progress or recently completed
    if (!existing.endTime) {
      return {
        allowed: false,
        reason: `Provider wallet operation locked; ${existing.type} in progress`,
      };
    }
    const elapsed = Date.now() - existing.endTime;
    if (elapsed < BalanceManager.PROVIDER_WALLET_COOLDOWN_MS) {
      return {
        allowed: false,
        reason: `Provider wallet operation locked; recent ${existing.type} completed ${Math.round(elapsed / 1000)}s ago`,
      };
    }
    // Cooldown expired — clean up stale entry
    this.providerWalletOps.delete(baseUrl);
    return { allowed: true };
  }

  private _beginProviderWalletOperation(
    baseUrl: string,
    type: "topup" | "refund"
  ): void {
    this.providerWalletOps.set(baseUrl, { type, startTime: Date.now() });
  }

  private _endProviderWalletOperation(
    baseUrl: string,
    type: "topup" | "refund"
  ): void {
    const existing = this.providerWalletOps.get(baseUrl);
    if (existing && existing.type === type) {
      existing.endTime = Date.now();
    }
  }

  async getBalanceState(): Promise<BalanceState> {
    const mintBalances = await this.walletAdapter.getBalances();
    const units = this.walletAdapter.getMintUnits();

    let totalMintBalance = 0;
    const normalizedMintBalances: Record<string, number> = {};
    for (const url in mintBalances) {
      const balance = mintBalances[url];
      const unit = units[url];
      const balanceInSats = getBalanceInSats(balance, unit);
      normalizedMintBalances[url] = balanceInSats;
      totalMintBalance += balanceInSats;
    }

    const providerBalances: Record<string, number> = {};
    let totalProviderBalance = 0;

    const apiKeys = this.storageAdapter.getAllApiKeys();
    for (const apiKey of apiKeys) {
      if (!providerBalances[apiKey.baseUrl]) {
        providerBalances[apiKey.baseUrl] = 0;
      }
      providerBalances[apiKey.baseUrl] += apiKey.balance;
      totalProviderBalance += apiKey.balance;
    }

    return {
      totalBalance: totalMintBalance + totalProviderBalance,
      providerBalances,
      mintBalances: normalizedMintBalances,
    };
  }

  /**
   * Refund API key balance - convert remaining API key balance to cashu token
   * @param options - Refund options including forceRefund flag
   * @returns Refund result
   */
  async refundApiKey(options: RefundApiKeyOptions): Promise<RefundResult> {
    const { mintUrl, baseUrl, apiKey, forceRefund } = options;

    const guard = this._canRunProviderWalletOperation(baseUrl, "refund");
    if (!guard.allowed) {
      console.log(`[BalanceManager] Skipping refund for ${baseUrl} - ${guard.reason}`);
      return { success: false, message: guard.reason };
    }

    this._beginProviderWalletOperation(baseUrl, "refund");

    try {
      return await this._refundApiKeyImpl({ mintUrl, baseUrl, apiKey, forceRefund });
    } finally {
      this._endProviderWalletOperation(baseUrl, "refund");
    }
  }

  private async _refundApiKeyImpl(options: RefundApiKeyOptions): Promise<RefundResult> {
    const { mintUrl, baseUrl, apiKey, forceRefund } = options;

    if (!apiKey) {
      return { success: false, message: "No API key to refund" };
    }

    // If forceRefund is not true, skip refund if the API key was used in the last 5 minutes
    if (!forceRefund) {
      const apiKeyEntry = this.storageAdapter.getApiKey(baseUrl);
      if (apiKeyEntry?.lastUsed) {
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (apiKeyEntry.lastUsed > fiveMinutesAgo) {
          console.log(
            `[BalanceManager] Skipping refund for ${baseUrl} - used ${Math.round((Date.now() - apiKeyEntry.lastUsed) / 1000)}s ago`
          );
          return {
            success: false,
            message: "API key was used recently, skipping refund",
          };
        }
      }
    }

    let fetchResult:
      | { success: boolean; token?: string; requestId?: string; error?: string }
      | undefined;

    try {
      fetchResult = await this.fetchRefundToken(baseUrl, apiKey);

      if (!fetchResult.success) {
        return {
          success: false,
          message: fetchResult.error || "API key refund failed",
          requestId: fetchResult.requestId,
        };
      }

      if (!fetchResult.token) {
        return {
          success: false,
          message: "No token received from API key refund",
          requestId: fetchResult.requestId,
        };
      }

      if (fetchResult.error === "No balance to refund") {
        this.storageAdapter.removeApiKey(baseUrl);
        return { success: true, message: "No balance to refund, key cleaned up" };
      }

      const receiveResult = await this.cashuSpender.receiveToken(
        fetchResult.token
      );
      const totalAmountMsat =
        receiveResult.unit === "msat"
          ? receiveResult.amount
          : receiveResult.amount * 1000;

      if (receiveResult.success) {
        this.storageAdapter.removeApiKey(baseUrl);
      }

      return {
        success: receiveResult.success,
        refundedAmount: totalAmountMsat,
        message: receiveResult.message,
        requestId: fetchResult.requestId,
      };
    } catch (error) {
      console.error("[BalanceManager] API key refund error", error);
      return this._handleRefundError(error, mintUrl, fetchResult?.requestId);
    }
  }

  /**
   * Fetch refund token from provider API using API key (or xcashu token) authentication
   */
  async fetchRefundToken(
    baseUrl: string,
    apiKeyOrToken: string,
    xCashu: boolean = false
  ): Promise<{
    success: boolean;
    token?: string;
    requestId?: string;
    error?: string;
  }> {
    if (!baseUrl) {
      return {
        success: false,
        error: "No base URL configured",
      };
    }

    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = `${normalizedBaseUrl}v1/wallet/refund`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 60000);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (xCashu) {
        headers["X-Cashu"] = apiKeyOrToken;
      } else {
        headers["Authorization"] = `Bearer ${apiKeyOrToken}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const requestId =
        response.headers.get("x-routstr-request-id") || undefined;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          requestId,
          error: `API key refund failed: ${
            errorData?.detail || response.statusText
          }`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        token: data.token,
        requestId,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      console.error("[BalanceManager.fetchRefundToken] Fetch error", error);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return {
            success: false,
            error: "Request timed out after 1 minute",
          };
        }
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: false,
        error: "Unknown error occurred during API key refund request",
      };
    }
  }

  /**
   * Top up API key balance with a cashu token
   */
  async topUp(options: TopUpOptions): Promise<TopUpResult> {
    const { mintUrl, baseUrl, amount, token: providedToken } = options;

    const guard = this._canRunProviderWalletOperation(baseUrl, "topup");
    if (!guard.allowed) {
      console.log(`[BalanceManager] Skipping topup for ${baseUrl} - ${guard.reason}`);
      return { success: false, message: guard.reason };
    }

    this._beginProviderWalletOperation(baseUrl, "topup");

    try {
      return await this._topUpImpl({ mintUrl, baseUrl, amount, token: providedToken });
    } finally {
      this._endProviderWalletOperation(baseUrl, "topup");
    }
  }

  private async _topUpImpl(options: TopUpOptions): Promise<TopUpResult> {
    const { mintUrl, baseUrl, amount, token: providedToken } = options;

    if (!amount || amount <= 0) {
      return { success: false, message: "Invalid top up amount" };
    }

    const apiKeyEntry = providedToken
      ? null // providedToken is now the apiKey for apikeys mode
      : this.storageAdapter.getApiKey(baseUrl);
    const apiKey = providedToken || apiKeyEntry?.key;

    if (!apiKey) {
      return { success: false, message: "No API key available for top up" };
    }

    let cashuToken: string | null = null;
    let requestId: string | undefined;

    try {
      const tokenResult = await this.createProviderToken({
        mintUrl,
        baseUrl,
        amount,
      });

      if (!tokenResult.success || !tokenResult.token) {
        return {
          success: false,
          message: tokenResult.error || "Unable to create top up token",
        };
      }

      cashuToken = tokenResult.token;

      const topUpResult = await this._postTopUp(baseUrl, apiKey, cashuToken);
      requestId = topUpResult.requestId;
      console.log(topUpResult);

      if (!topUpResult.success) {
        await this._recoverFailedTopUp(cashuToken);
        return {
          success: false,
          message: topUpResult.error || "Top up failed",
          requestId,
          recoveredToken: true,
        };
      }

      return {
        success: true,
        toppedUpAmount: amount,
        requestId,
      };
    } catch (error) {
      console.log(
        "DEBUG",
        `[TopuPU] topup: Topup result for ${baseUrl}: error=${error}`
      );
      if (cashuToken) {
        await this._recoverFailedTopUp(cashuToken);
      }

      return this._handleTopUpError(error, mintUrl, requestId);
    }
  }

  async createProviderToken(
    options: CreateProviderTokenOptions
  ): Promise<ProviderTokenResult> {
    const {
      mintUrl,
      baseUrl,
      amount,
      retryCount = 0,
      excludeMints = [],
      p2pkPubkey,
    } = options;

    const adjustedAmount = Math.ceil(amount);
    console.log(
      `[BalanceManager.createProviderToken] Starting: baseUrl=${baseUrl}, mintUrl=${mintUrl}, amount=${amount}, adjustedAmount=${adjustedAmount}, retryCount=${retryCount}`
    );
    if (!adjustedAmount || isNaN(adjustedAmount)) {
      console.error(
        `[BalanceManager.createProviderToken] FAILURE: Invalid amount - amount=${amount}, adjustedAmount=${adjustedAmount}`
      );
      return { success: false, error: "Invalid top up amount" };
    }

    const balanceState = await this.getBalanceState();
    const balances = await this.walletAdapter.getBalances();
    const units = this.walletAdapter.getMintUnits();

    const totalMintBalance = Object.values(balanceState.mintBalances).reduce(
      (sum, value) => sum + value,
      0
    );
    const targetProviderBalance = balanceState.providerBalances[baseUrl] || 0;
    const refundableProviderBalance = Object.entries(
      balanceState.providerBalances
    )
      .filter(([providerBaseUrl]) => providerBaseUrl !== baseUrl)
      .reduce((sum, [, value]) => sum + value, 0);

    if (
      totalMintBalance + targetProviderBalance < adjustedAmount &&
      totalMintBalance + targetProviderBalance + refundableProviderBalance >=
        adjustedAmount &&
      retryCount < 2
    ) {
      await this._refundOtherProvidersForTopUp(baseUrl, mintUrl, retryCount);
      return this.createProviderToken({
        ...options,
        retryCount: retryCount + 1,
      });
    }

    if (totalMintBalance + targetProviderBalance < adjustedAmount) {
      const error = new InsufficientBalanceError(
        adjustedAmount,
        totalMintBalance + targetProviderBalance,
        totalMintBalance,
        Object.entries(balanceState.mintBalances).reduce(
          (max, [url, balance]) =>
            balance > max.balance ? { url, balance } : max,
          { url: "", balance: 0 }
        ).url
      );
      console.error(
        `[BalanceManager.createProviderToken] FAILURE: Insufficient balance - required=${adjustedAmount}, available=${totalMintBalance + targetProviderBalance}, totalMintBalance=${totalMintBalance}, targetProviderBalance=${targetProviderBalance}, refundableProviderBalance=${refundableProviderBalance}`
      );
      return { success: false, error: error.message };
    }

    const providerMints =
      baseUrl && this.providerRegistry
        ? this.providerRegistry.getProviderMints(baseUrl)
        : [];

    let requiredAmount = adjustedAmount;
    const supportedMintsOnly = providerMints.length > 0;

    let candidates = this._selectCandidateMints({
      balances,
      units,
      amount: requiredAmount,
      preferredMintUrl: mintUrl,
      excludeMints,
      allowedMints: supportedMintsOnly ? providerMints : undefined,
    });

    if (candidates.length === 0 && supportedMintsOnly) {
      requiredAmount += 2;
      candidates = this._selectCandidateMints({
        balances,
        units,
        amount: requiredAmount,
        preferredMintUrl: mintUrl,
        excludeMints,
      });
    }

    if (candidates.length === 0) {
      let maxBalance = 0;
      let maxMintUrl = "";
      for (const mintUrl in balances) {
        const balance = balances[mintUrl];
        const unit = units[mintUrl];
        const balanceInSats = getBalanceInSats(balance, unit);
        if (balanceInSats > maxBalance) {
          maxBalance = balanceInSats;
          maxMintUrl = mintUrl;
        }
      }

      console.error(
        `[BalanceManager.createProviderToken] FAILURE: No candidate mints found - requiredAmount=${requiredAmount}, totalMintBalance=${totalMintBalance}, maxBalance=${maxBalance}, maxMintUrl=${maxMintUrl}, providerMints=${JSON.stringify(providerMints)}`
      );
      const error = new InsufficientBalanceError(
        adjustedAmount,
        totalMintBalance,
        maxBalance,
        maxMintUrl
      );

      return { success: false, error: error.message };
    }

    let lastError: string | undefined;
    for (const candidateMint of candidates) {
      try {
        console.log(
          `[BalanceManager.createProviderToken] Attempting mint: ${candidateMint}, amount: ${requiredAmount}`
        );
        const token = await this.walletAdapter.sendToken(
          candidateMint,
          requiredAmount,
          p2pkPubkey
        );
        console.log(
          `[BalanceManager.createProviderToken] SUCCESS: Token created from mint ${candidateMint}, all mint balances: ${JSON.stringify(Object.fromEntries(Object.entries(balances).map(([mint, balance]) => [mint, getBalanceInSats(balance, units[mint])])))}`
        );
        return {
          success: true,
          token,
          selectedMintUrl: candidateMint,
          amountSpent: requiredAmount,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[BalanceManager.createProviderToken] FAILURE: Mint ${candidateMint} failed with error: ${errorMsg}`
        );
        if (error instanceof Error) {
          lastError = errorMsg;

          if (isNetworkErrorMessage(error.message)) {
            console.warn(
              `[BalanceManager.createProviderToken] Network error from ${candidateMint}, trying next mint...`
            );
            continue;
          }
        }

        return {
          success: false,
          error: lastError || "Failed to create top up token",
        };
      }
    }

    console.error(
      `[BalanceManager.createProviderToken] FAILURE: All candidate mints exhausted - lastError=${lastError}, candidates=${JSON.stringify(candidates)}`
    );
    return {
      success: false,
      error:
        lastError || "All candidate mints failed while creating top up token",
    };
  }

  private _selectCandidateMints(options: {
    balances: Record<string, number>;
    units: Record<string, "sat" | "msat">;
    amount: number;
    preferredMintUrl: string;
    excludeMints: string[];
    allowedMints?: string[];
  }): string[] {
    const {
      balances,
      units,
      amount,
      preferredMintUrl,
      excludeMints,
      allowedMints,
    } = options;

    const candidates: string[] = [];

    const { selectedMintUrl: firstMint } = selectMintWithBalance(
      balances,
      units,
      amount,
      excludeMints
    );

    if (
      firstMint &&
      (!allowedMints ||
        allowedMints.length === 0 ||
        allowedMints.includes(firstMint))
    ) {
      candidates.push(firstMint);
    }

    const canUseMint = (mint: string): boolean => {
      if (excludeMints.includes(mint)) return false;
      if (
        allowedMints &&
        allowedMints.length > 0 &&
        !allowedMints.includes(mint)
      ) {
        return false;
      }
      const rawBalance = balances[mint] || 0;
      const unit = units[mint];
      const balanceInSats = getBalanceInSats(rawBalance, unit);
      return balanceInSats >= amount;
    };

    if (
      preferredMintUrl &&
      canUseMint(preferredMintUrl) &&
      !candidates.includes(preferredMintUrl)
    ) {
      candidates.push(preferredMintUrl);
    }

    for (const mint in balances) {
      if (mint === preferredMintUrl || candidates.includes(mint)) continue;
      if (canUseMint(mint)) {
        candidates.push(mint);
      }
    }

    return candidates;
  }

  private async _refundOtherProvidersForTopUp(
    baseUrl: string,
    mintUrl: string,
    retryCount: number
  ): Promise<void> {
    const apiKeyDistribution = this.storageAdapter.getApiKeyDistribution();

    // If retryCount >= 2, force refund even if API keys were used recently
    const forceRefund = retryCount >= 2;

    const apiKeysToRefund = apiKeyDistribution.filter(
      (apiKey) => apiKey.baseUrl !== baseUrl && apiKey.amount > 0
    );

    const apiKeyRefundResults = await Promise.allSettled(
      apiKeysToRefund.map(async (apiKeyEntry) => {
        const fullApiKeyEntry = this.storageAdapter.getApiKey(
          apiKeyEntry.baseUrl
        );
        if (!fullApiKeyEntry) {
          return { baseUrl: apiKeyEntry.baseUrl, success: false };
        }

        const result = await this.refundApiKey({
          mintUrl,
          baseUrl: apiKeyEntry.baseUrl,
          apiKey: fullApiKeyEntry.key,
          forceRefund,
        });

        return { baseUrl: apiKeyEntry.baseUrl, success: result.success };
      })
    );

    for (const result of apiKeyRefundResults) {
      if (result.status === "fulfilled" && result.value.success) {
        this.storageAdapter.updateApiKeyBalance(result.value.baseUrl, 0);
      }
    }
  }

  /**
   * Post topup request to provider API
   */
  private async _postTopUp(
    baseUrl: string,
    storedToken: string,
    cashuToken: string
  ): Promise<{
    success: boolean;
    requestId?: string;
    error?: string;
  }> {
    if (!baseUrl) {
      return {
        success: false,
        error: "No base URL configured",
      };
    }

    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = `${normalizedBaseUrl}v1/wallet/topup?cashu_token=${encodeURIComponent(
      cashuToken
    )}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 60000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${storedToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const requestId =
        response.headers.get("x-routstr-request-id") || undefined;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          requestId,
          error:
            errorData?.detail || `Top up failed with status ${response.status}`,
        };
      }

      return { success: true, requestId };
    } catch (error) {
      clearTimeout(timeoutId);
      console.error("[BalanceManager._postTopUp] Fetch error", error);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return {
            success: false,
            error: "Request timed out after 1 minute",
          };
        }
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: false,
        error: "Unknown error occurred during top up request",
      };
    }
  }

  /**
   * Attempt to receive token back after failed top up
   */
  private async _recoverFailedTopUp(cashuToken: string): Promise<void> {
    try {
      await this.cashuSpender.receiveToken(cashuToken);
    } catch (error) {
      console.error(
        "[BalanceManager._recoverFailedTopUp] Failed to recover token",
        error
      );
    }
  }

  /**
   * Handle refund errors with specific error types
   */
  private _handleRefundError(
    error: unknown,
    mintUrl: string,
    requestId?: string
  ): RefundResult {
    if (error instanceof Error) {
      // Network errors
      if (isNetworkErrorMessage(error.message)) {
        return {
          success: false,
          message: `Failed to connect to the mint: ${mintUrl}`,
          requestId,
        };
      }

      // Wallet not found error
      if (error.message.includes("Wallet not found")) {
        return {
          success: false,
          message: `Wallet couldn't be loaded. Please save this refunded cashu token manually.`,
          requestId,
        };
      }

      return {
        success: false,
        message: error.message,
        requestId,
      };
    }

    return {
      success: false,
      message: "Refund failed",
      requestId,
    };
  }

  /**
   * Get token balance from provider
   */
  async getTokenBalance(
    token: string,
    baseUrl: string
  ): Promise<{
    amount: number;
    reserved: number;
    unit: "sat" | "msat";
    apiKey: string;
    isInvalidApiKey?: boolean;
  }> {
    try {
      const response = await fetch(`${baseUrl}v1/wallet/info`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          amount: data.balance,
          reserved: data.reserved ?? 0,
          unit: "msat",
          apiKey: data.api_key,
        };
      } else {
        console.log(response.status);
        const data = await response.json();
        console.log("FAILED ", data);

        // Check for invalid/expired API key error (proofs already spent)
        const isInvalidApiKey =
          response.status === 401 &&
          data?.detail?.error?.code === "invalid_api_key" &&
          data?.detail?.error?.message?.includes("proofs already spent");

        return {
          amount: -1,
          reserved: data.reserved ?? 0,
          unit: "msat",
          apiKey: data.api_key,
          isInvalidApiKey,
        };
      }
    } catch (error) {
      console.error("ERRORR IN RESTPONSE", error);
      // Fall through to default
    }

    return { amount: -1, reserved: 0, unit: "sat", apiKey: "" };
  }

  /**
   * Handle topup errors with specific error types
   */
  private _handleTopUpError(
    error: unknown,
    mintUrl: string,
    requestId?: string
  ): TopUpResult {
    if (error instanceof Error) {
      if (isNetworkErrorMessage(error.message)) {
        return {
          success: false,
          message: `Failed to connect to the mint: ${mintUrl}`,
          requestId,
        };
      }

      if (error.message.includes("Wallet not found")) {
        return {
          success: false,
          message:
            "Wallet couldn't be loaded. The cashu token was recovered locally.",
          requestId,
        };
      }

      return {
        success: false,
        message: error.message,
        requestId,
      };
    }

    return {
      success: false,
      message: "Top up failed",
      requestId,
    };
  }
}
