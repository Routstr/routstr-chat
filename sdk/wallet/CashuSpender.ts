/**
 * CashuSpender - Core spending logic for Cashu tokens
 *
 * Handles:
 * - Mint selection with sufficient balance
 * - Provider mint compatibility checks
 * - Retry logic with alternate mints
 * - Critical section management (busy state)
 *
 * Extracted from hooks/useCashuWithXYZ.ts
 */

import type { WalletAdapter, StorageAdapter } from "./interfaces";
import type { SpendResult } from "../core/types";
import { InsufficientBalanceError } from "../core/errors";
import { BalanceManager } from "./BalanceManager";
import { auditLogger } from "./AuditLogger";
import { getBalanceInSats, isNetworkErrorMessage } from "./tokenUtils";
import { getDecodedToken } from "@cashu/cashu-ts";

/**
 * Options for spending cashu tokens
 */
export interface SpendOptions {
  /** The mint URL to send from (can be overridden if insufficient balance) */
  mintUrl: string;

  /** The amount to spend in sats */
  amount: number;

  /** The provider base URL (for token storage and provider mint checks) */
  baseUrl: string;

  /** Whether to reuse an existing token if available */
  reuseToken?: boolean;

  /** Optional P2PK public key */
  p2pkPubkey?: string;

  /** Array of mint URLs to exclude (for retry logic) */
  excludeMints?: string[];

  /** Current retry count (for internal recursion) */
  retryCount?: number;

  /** Specific provider baseUrls to refund (if not provided, refunds all except current) */
  refundBaseUrls?: string[];
}

type DebugLevel = "DEBUG" | "WARN" | "ERROR";

/**
 * CashuSpender manages the spending of Cashu tokens
 */
export class CashuSpender {
  private _isBusy = false;
  private debugLevel: DebugLevel = "WARN";

  constructor(
    private walletAdapter: WalletAdapter,
    private storageAdapter: StorageAdapter,
    private _providerRegistry?: unknown,
    private balanceManager?: BalanceManager
  ) {}

  async receiveToken(token: string): Promise<{
    success: boolean;
    amount: number;
    unit: "sat" | "msat";
    message?: string;
  }> {
    try {
      const result = await this.walletAdapter.receiveToken(token);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Failed to fetch mint")) {
        const cachedTokens = this.storageAdapter.getCachedReceiveTokens();
        const existingIndex = cachedTokens.findIndex((t) => t.token === token);
        if (existingIndex === -1) {
          const { amount, unit } = this._decodeTokenAmount(token);
          this.storageAdapter.setCachedReceiveTokens([
            ...cachedTokens,
            {
              token,
              amount,
              unit,
              createdAt: Date.now(),
            },
          ]);
        }
      }

      const { amount, unit } = this._decodeTokenAmount(token);
      return { success: false, amount, unit, message: errorMessage };
    }
  }

  private _decodeTokenAmount(token: string): {
    amount: number;
    unit: "sat" | "msat";
  } {
    try {
      const decoded = getDecodedToken(token);
      const amount = decoded.proofs.reduce(
        (acc, proof) => acc + proof.amount,
        0
      );
      const unit = (decoded.unit as "sat" | "msat") || "sat";
      return { amount, unit };
    } catch {
      return { amount: 0, unit: "sat" };
    }
  }

  private async _getBalanceState(): Promise<{
    totalBalance: number;
    providerBalances: Record<string, number>;
    mintBalances: Record<string, number>;
  }> {
    if (this.balanceManager) {
      return this.balanceManager.getBalanceState();
    }

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

  private async _logTransaction(
    action: "spend" | "topup" | "refund" | "receive" | "balance_check",
    options?: {
      amount?: number;
      mintUrl?: string;
      baseUrl?: string;
      status?: "success" | "failed";
      details?: string;
    }
  ): Promise<void> {
    const balanceState = await this._getBalanceState();
    await auditLogger.logBalanceSnapshot(action, balanceState, options);
  }

  /**
   * Check if the spender is currently in a critical operation
   */
  get isBusy(): boolean {
    return this._isBusy;
  }

  getDebugLevel(): DebugLevel {
    return this.debugLevel;
  }

  setDebugLevel(level: DebugLevel): void {
    this.debugLevel = level;
  }

  private _log(level: "DEBUG" | "WARN" | "ERROR", ...args: unknown[]): void {
    const levelPriority: Record<DebugLevel, number> = {
      DEBUG: 0,
      WARN: 1,
      ERROR: 2,
    };

    if (levelPriority[level] >= levelPriority[this.debugLevel]) {
      switch (level) {
        case "DEBUG":
          console.log(...args);
          break;
        case "WARN":
          console.warn(...args);
          break;
        case "ERROR":
          console.error(...args);
          break;
      }
    }
  }

  /**
   * Spend Cashu tokens with automatic mint selection and retry logic
   * Throws errors on failure instead of returning failed SpendResult
   */
  async spend(options: SpendOptions): Promise<SpendResult> {
    const {
      mintUrl,
      amount,
      baseUrl,
      reuseToken = false,
      p2pkPubkey,
      excludeMints = [],
      retryCount = 0,
    } = options;

    this._isBusy = true;

    try {
      const result = await this._spendInternal({
        mintUrl,
        amount,
        baseUrl,
        reuseToken,
        p2pkPubkey,
        excludeMints,
        retryCount,
      });

      if (result.status === "failed" || !result.token) {
        const errorMsg =
          result.error || `Insufficient balance. Need ${amount} sats.`;

        if (this._isNetworkError(errorMsg)) {
          throw new Error(
            `Your mint ${mintUrl} is unreachable or is blocking your IP. Please try again later or switch mints.`
          );
        }

        if (result.errorDetails) {
          throw new InsufficientBalanceError(
            result.errorDetails.required,
            result.errorDetails.available,
            result.errorDetails.maxMintBalance,
            result.errorDetails.maxMintUrl
          );
        }

        throw new Error(errorMsg);
      }

      return result;
    } finally {
      this._isBusy = false;
    }
  }

  /**
   * Check if error message indicates a network error
   */
  private _isNetworkError(message: string): boolean {
    return (
      isNetworkErrorMessage(message) ||
      (message.includes("Your mint") && message.includes("unreachable"))
    );
  }

  /**
   * Internal spending logic
   */
  private async _spendInternal(options: SpendOptions): Promise<SpendResult> {
    let {
      mintUrl,
      amount,
      baseUrl,
      reuseToken,
      p2pkPubkey,
      excludeMints,
      retryCount,
    } = options;

    this._log(
      "DEBUG",
      `[CashuSpender] _spendInternal: amount=${amount}, mintUrl=${mintUrl}, baseUrl=${baseUrl}, reuseToken=${reuseToken}`
    );

    // Validate amount
    let adjustedAmount = Math.ceil(amount);
    if (!adjustedAmount || isNaN(adjustedAmount)) {
      this._log(
        "ERROR",
        `[CashuSpender] _spendInternal: Invalid amount: ${amount}`
      );
      return {
        token: null,
        status: "failed",
        balance: 0,
        error: "Please enter a valid amount",
      };
    }

    // Try to get existing token for reuse
    if (reuseToken && baseUrl) {
      this._log(
        "DEBUG",
        `[CashuSpender] _spendInternal: Attempting to reuse token for ${baseUrl}`
      );
      const existingResult = await this._tryReuseToken(
        baseUrl,
        adjustedAmount,
        mintUrl
      );
      if (existingResult) {
        this._log(
          "DEBUG",
          `[CashuSpender] _spendInternal: Successfully reused token, balance: ${existingResult.balance}`
        );
        return existingResult;
      }
      this._log(
        "DEBUG",
        `[CashuSpender] _spendInternal: Could not reuse token, will create new token`
      );
    }

    // Get current balance state
    const balanceState = await this._getBalanceState();
    const totalAvailableBalance = balanceState.totalBalance;

    this._log(
      "DEBUG",
      `[CashuSpender] _spendInternal: totalAvailableBalance=${totalAvailableBalance}, adjustedAmount=${adjustedAmount}`
    );

    // Check total balance
    if (totalAvailableBalance < adjustedAmount) {
      this._log(
        "ERROR",
        `[CashuSpender] _spendInternal: Insufficient balance, have=${totalAvailableBalance}, need=${adjustedAmount}`
      );
      return this._createInsufficientBalanceError(
        adjustedAmount,
        balanceState.mintBalances,
        totalAvailableBalance
      );
    }

    let token: string | null = null;
    let selectedMintUrl: string | undefined;
    let spentAmount = adjustedAmount;

    if (this.balanceManager) {
      const tokenResult = await this.balanceManager.createProviderToken({
        mintUrl,
        baseUrl,
        amount: adjustedAmount,
        p2pkPubkey,
        excludeMints,
        retryCount,
      });

      if (!tokenResult.success || !tokenResult.token) {
        if ((tokenResult.error || "").includes("Insufficient balance")) {
          return this._createInsufficientBalanceError(
            adjustedAmount,
            balanceState.mintBalances,
            totalAvailableBalance
          );
        }

        return {
          token: null,
          status: "failed",
          balance: 0,
          error: tokenResult.error || "Failed to create token",
        };
      }

      token = tokenResult.token;
      selectedMintUrl = tokenResult.selectedMintUrl;
      spentAmount = tokenResult.amountSpent || adjustedAmount;
    } else {
      try {
        token = await this.walletAdapter.sendToken(
          mintUrl,
          adjustedAmount,
          p2pkPubkey
        );
        selectedMintUrl = mintUrl;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          token: null,
          status: "failed",
          balance: 0,
          error: `Error generating token: ${errorMsg}`,
        };
      }
    }

    // Store token and return
    if (token) {
      this._log(
        "DEBUG",
        `[CashuSpender] _spendInternal: Successfully spent ${spentAmount}, returning token with balance=${spentAmount}`
      );
    }

    this._logTransaction("spend", {
      amount: spentAmount,
      mintUrl: selectedMintUrl || mintUrl,
      baseUrl,
      status: "success",
    });

    this._log(
      "DEBUG",
      `[CashuSpender] _spendInternal: Successfully spent ${spentAmount}, returning token with balance=${spentAmount}`
    );

    const units = this.walletAdapter.getMintUnits();

    return {
      token,
      status: "success",
      balance: spentAmount,
      unit:
        (selectedMintUrl ? units[selectedMintUrl] : units[mintUrl]) || "sat",
    };
  }

  /**
   * Try to reuse an existing API key
   */
  private async _tryReuseToken(
    baseUrl: string,
    amount: number,
    mintUrl: string
  ): Promise<SpendResult | null> {
    const apiKeyEntry = this.storageAdapter.getApiKey(baseUrl);
    if (!apiKeyEntry) return null;

    // Get pending distribution to check balance
    const apiKeyDistribution = this.storageAdapter.getApiKeyDistribution();
    const balanceForBaseUrl =
      apiKeyDistribution.find((b) => b.baseUrl === baseUrl)?.amount || 0;

    this._log("DEBUG", "Reusing API key", balanceForBaseUrl, amount);

    if (balanceForBaseUrl > amount) {
      const units = this.walletAdapter.getMintUnits();
      const unit = units[mintUrl] || "sat";
      return {
        token: apiKeyEntry.key,
        status: "success",
        balance: balanceForBaseUrl,
        unit,
      };
    }

    // API key exists but insufficient balance - attempt topup
    if (this.balanceManager) {
      const topUpAmount = Math.ceil(amount * 1.2 - balanceForBaseUrl);
      const topUpResult = await this.balanceManager.topUp({
        mintUrl,
        baseUrl,
        amount: topUpAmount,
        token: apiKeyEntry.key,
      });
      this._log("DEBUG", "TOPUP ", topUpResult);

      if (topUpResult.success && topUpResult.toppedUpAmount) {
        const newBalance = balanceForBaseUrl + topUpResult.toppedUpAmount;
        const units = this.walletAdapter.getMintUnits();
        const unit = units[mintUrl] || "sat";

        this._logTransaction("topup", {
          amount: topUpResult.toppedUpAmount,
          mintUrl,
          baseUrl,
          status: "success",
        });

        return {
          token: apiKeyEntry.key,
          status: "success",
          balance: newBalance,
          unit,
        };
      }

      const providerBalance = await this._getProviderTokenBalance(
        baseUrl,
        apiKeyEntry.key
      );
      this._log("DEBUG", providerBalance);
      if (providerBalance <= 0) {
        this.storageAdapter.removeApiKey(baseUrl);
      }
    }

    return null;
  }

  /**
   * Refund all xcashu tokens from storage by calling the provider's refund endpoint.
   * The xcashu token acts as an API key to claim the refund, and the response contains
   * the actual refunded Cashu token which is then received into the wallet.
   * @param mintUrl - The mint URL for receiving tokens
   * @param excludeBaseUrls - Base URLs to exclude from refund (optional)
   * @returns Results for each xcashu token refund attempt
   */
  async refundXcashuTokens(
    mintUrl: string,
    excludeBaseUrls?: string[]
  ): Promise<
    { baseUrl: string; token: string; success: boolean; error?: string }[]
  > {
    const results: {
      baseUrl: string;
      token: string;
      success: boolean;
      error?: string;
    }[] = [];
    const xcashuTokens = this.storageAdapter.getXcashuTokens();
    const excludedUrls = new Set(excludeBaseUrls || []);

    for (const [baseUrl, tokens] of Object.entries(xcashuTokens)) {
      if (excludedUrls.has(baseUrl)) continue;

      for (const xcashuToken of tokens) {
        try {
          // XCashu tokens need to be sent to the provider's refund endpoint
          // The xcashu token acts as an API key, and the response contains the actual refunded token
          if (!this.balanceManager) {
            throw new Error("BalanceManager not available for xcashu refund");
          }

          // Call the refund endpoint using the xcashu token as the API key
          const fetchResult = await this.balanceManager.fetchRefundToken(
            baseUrl,
            xcashuToken.token,
            true
          );

          if (!fetchResult.success || !fetchResult.token) {
            throw new Error(
              fetchResult.error || "Failed to fetch refund token from provider"
            );
          }

          // Receive the refunded Cashu token into the wallet
          const receiveResult = await this.receiveToken(fetchResult.token);

          if (receiveResult.success) {
            // Remove successfully refunded token from storage
            this.storageAdapter.removeXcashuToken(baseUrl, xcashuToken.token);
            results.push({
              baseUrl,
              token: xcashuToken.token,
              success: true,
            });
            this._log(
              "DEBUG",
              `[CashuSpender] refundXcashuTokens: Successfully refunded xcashu token for ${baseUrl}, amount=${receiveResult.amount}`
            );
          } else {
            // Refund failed - increment tryCount
            const currentTryCount = xcashuToken.tryCount ?? 0;
            const newTryCount = currentTryCount + 1;
            this.storageAdapter.updateXcashuTokenTryCount(
              xcashuToken.token,
              newTryCount
            );
            results.push({
              baseUrl,
              token: xcashuToken.token,
              success: false,
              error: receiveResult.message ?? "Refund failed",
            });
            this._log(
              "DEBUG",
              `[CashuSpender] refundXcashuTokens: Failed to receive refund token for ${baseUrl}, incremented tryCount to ${newTryCount}: ${receiveResult.message}`
            );
          }
        } catch (error) {
          // Exception occurred - increment tryCount
          const currentTryCount = xcashuToken.tryCount ?? 0;
          const newTryCount = currentTryCount + 1;
          this.storageAdapter.updateXcashuTokenTryCount(
            xcashuToken.token,
            newTryCount
          );
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.push({
            baseUrl,
            token: xcashuToken.token,
            success: false,
            error: errorMessage,
          });
          this._log(
            "ERROR",
            `[CashuSpender] refundXcashuTokens: Exception during refund for ${baseUrl}: ${errorMessage}, incremented tryCount to ${newTryCount}`
          );
        }
      }
    }

    return results;
  }

  /**
   * Refund specific providers without retrying spend
   */
  async refundProviders(
    mintUrl: string,
    forceRefund?: boolean
  ): Promise<{ baseUrl: string; success: boolean }[]> {
    const results: { baseUrl: string; success: boolean }[] = [];

    const apiKeyDistribution = this.storageAdapter.getApiKeyDistribution();

    // Refresh balances from providers before refunding
    for (const apiKeyEntry of apiKeyDistribution) {
      const apiKeyEntryFull = this.storageAdapter.getApiKey(
        apiKeyEntry.baseUrl
      );
      if (apiKeyEntryFull && this.balanceManager) {
        try {
          const balanceResult = await this.balanceManager.getTokenBalance(
            apiKeyEntryFull.key,
            apiKeyEntry.baseUrl
          );

          if (balanceResult.isInvalidApiKey) {
            // Key is invalid/expired on the provider side — clean it up
            this.storageAdapter.removeApiKey(apiKeyEntry.baseUrl);
            results.push({
              baseUrl: apiKeyEntry.baseUrl,
              success: true,
            });
            continue;
          }

          if (balanceResult.amount >= 0) {
            const balanceSat = balanceResult.unit === "msat"
              ? Math.floor(balanceResult.amount / 1000)
              : balanceResult.amount;
            this.storageAdapter.updateApiKeyBalance(
              apiKeyEntry.baseUrl,
              balanceSat
            );
          }
        } catch {
          // Balance check failed — proceed with stale local balance
        }

        // Re-read the entry after balance refresh (may have been removed above)
        const refreshedEntry = this.storageAdapter.getApiKey(
          apiKeyEntry.baseUrl
        );
        if (!refreshedEntry) continue;

        const refundResult = await this.balanceManager.refundApiKey({
          mintUrl,
          baseUrl: apiKeyEntry.baseUrl,
          apiKey: refreshedEntry.key,
          forceRefund,
        });

        if (refundResult.success) {
          this.storageAdapter.removeApiKey(apiKeyEntry.baseUrl);
        } else {
          const currentEntry = this.storageAdapter.getApiKey(
            apiKeyEntry.baseUrl
          );
          if (currentEntry) {
            this.storageAdapter.updateApiKeyBalance(
              apiKeyEntry.baseUrl,
              currentEntry.balance
            ); // update lastUsed so we only try to refund every 5 mins.
          }
        }

        results.push({
          baseUrl: apiKeyEntry.baseUrl,
          success: refundResult.success,
        });
      } else {
        results.push({
          baseUrl: apiKeyEntry.baseUrl,
          success: false,
        });
      }
    }

    return results;
  }

  /**
   * Create an insufficient balance error result
   */
  private _createInsufficientBalanceError(
    required: number,
    normalizedBalances: Record<string, number>,
    availableBalance?: number
  ): SpendResult {
    let maxBalance = 0;
    let maxMintUrl = "";

    for (const mintUrl in normalizedBalances) {
      const balanceInSats = normalizedBalances[mintUrl];

      if (balanceInSats > maxBalance) {
        maxBalance = balanceInSats;
        maxMintUrl = mintUrl;
      }
    }

    const error = new InsufficientBalanceError(
      required,
      availableBalance ?? maxBalance,
      maxBalance,
      maxMintUrl
    );

    return {
      token: null,
      status: "failed",
      balance: 0,
      error: error.message,
      errorDetails: {
        required,
        available: availableBalance ?? maxBalance,
        maxMintBalance: maxBalance,
        maxMintUrl,
      },
    };
  }

  private async _getProviderTokenBalance(
    baseUrl: string,
    token: string
  ): Promise<number> {
    try {
      const response = await fetch(`${baseUrl}v1/wallet/info`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.balance / 1000;
      }
    } catch {
      return 0;
    }
    return 0;
  }
}
