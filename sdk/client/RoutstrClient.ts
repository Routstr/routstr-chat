/**
 * RoutstrClient - Main API client for Routstr
 *
 * Orchestrates:
 * - Token spending via CashuSpender
 * - API requests with authentication
 * - Streaming response processing
 * - Provider failover via ProviderManager
 * - Error handling and refunds
 *
 * Extracted from utils/apiUtils.ts
 */

import type { Message, TransactionHistory } from "../core/types";
import type { Model } from "../core/types";
import type {
  WalletAdapter,
  StorageAdapter,
  ProviderRegistry,
  StreamingCallbacks,
} from "../wallet/interfaces";
import type { UsageTrackingDriver } from "../storage/usageTracking";
import type { SdkStore } from "../storage/store";
import { CashuSpender } from "../wallet/CashuSpender";
import { BalanceManager } from "../wallet/BalanceManager";
import { StreamProcessor } from "./StreamProcessor";
import { ProviderManager } from "./ProviderManager";
import type { StreamingResult } from "../core/types";
import {
  ProviderError,
  FailoverError,
  InsufficientBalanceError,
} from "../core/errors";
import { isNetworkErrorMessage } from "../wallet/tokenUtils";
import { getDefaultSdkStore, getDefaultUsageTrackingDriver } from "../storage";
import {
  extractResponseId,
  extractUsageFromResponseBody,
  type UsageTrackingData,
} from "./usage";
import { inspectSSEWebStream } from "./sse";

/**
 * Options for fetching AI response
 */
export interface FetchOptions {
  messageHistory: Message[];
  selectedModel: Model;
  baseUrl: string;
  mintUrl: string;
  balance: number;
  transactionHistory: TransactionHistory[];
  maxTokens?: number;
  headers?: Record<string, string>;
}

/**
 * RoutstrClient is the main SDK entry point
 */
export type AlertLevel = "max" | "min";
export type RoutstrClientMode = "xcashu" | "apikeys";
export type DebugLevel = "DEBUG" | "WARN" | "ERROR";

const TOPUP_MARGIN = 1.2;

export interface RouteRequestParams {
  path: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl: string;
  mintUrl: string;
  modelId?: string;
  clientApiKey?: string;
}

export interface RoutstrClientConfig {
  usageTrackingDriver?: UsageTrackingDriver;
  sdkStore?: SdkStore;
  /** Optional: shared ProviderManager instance for consistent failure tracking across requests */
  providerManager?: ProviderManager;
}

export class RoutstrClient {
  private cashuSpender: CashuSpender;
  private balanceManager: BalanceManager;
  private streamProcessor: StreamProcessor;
  private providerManager: ProviderManager;
  private alertLevel: AlertLevel;
  private mode: RoutstrClientMode;
  private debugLevel: DebugLevel = "WARN";
  private usageTrackingDriver?: UsageTrackingDriver;
  private sdkStore?: SdkStore;

  constructor(
    private walletAdapter: WalletAdapter,
    private storageAdapter: StorageAdapter,
    private providerRegistry: ProviderRegistry,
    alertLevel: AlertLevel,
    mode: RoutstrClientMode = "xcashu",
    options: RoutstrClientConfig = {}
  ) {
    this.balanceManager = new BalanceManager(
      walletAdapter,
      storageAdapter,
      providerRegistry
    );
    this.cashuSpender = new CashuSpender(
      walletAdapter,
      storageAdapter,
      providerRegistry,
      this.balanceManager
    );
    this.streamProcessor = new StreamProcessor();
    this.alertLevel = alertLevel;
    this.mode = mode;
    this.usageTrackingDriver = options.usageTrackingDriver;
    this.sdkStore = options.sdkStore;
    // Use provided ProviderManager or create a new one
    this.providerManager =
      options.providerManager ??
      new ProviderManager(providerRegistry, this.sdkStore);
  }

  /**
   * Get the current client mode
   */
  getMode(): RoutstrClientMode {
    return this.mode;
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
   * Get the CashuSpender instance
   */
  getCashuSpender(): CashuSpender {
    return this.cashuSpender;
  }

  /**
   * Get the BalanceManager instance
   */
  getBalanceManager(): BalanceManager {
    return this.balanceManager;
  }

  /**
   * Get the ProviderManager instance
   */
  getProviderManager(): ProviderManager {
    return this.providerManager;
  }

  /**
   * Check if the client is currently busy (in critical section)
   */
  get isBusy(): boolean {
    return this.cashuSpender.isBusy;
  }

  /**
   * Route an API request to the upstream provider
   *
   * This is a simpler alternative to fetchAIResponse that just proxies
   * the request upstream without the streaming callback machinery.
   * Useful for daemon-style routing where you just need to forward
   * requests and get responses back.
   */
  async routeRequest(params: RouteRequestParams): Promise<Response> {
    const prepared = await this._prepareRoutedRequest(params);
    const contentType =
      prepared.response.headers.get("content-type") || "";
    const isSSE = contentType.includes("text/event-stream");

    // For SSE, defer accounting until the inspector (tee'd branch) has seen
    // usage — which only happens as the client consumes the stream. We expose
    // the finalization as `(response).finalize` so callers that want to block
    // on accounting (e.g. a proxy after it finished piping) can `await` it.
    // Non-SSE responses can be finalized inline since the body is fully
    // available (the clone-and-read path inside `_trackResponseUsage` handles
    // JSON bodies without consuming the client-facing copy).
    const runFinalize = async (): Promise<number> => {
      const { capturedUsage, capturedResponseId } = await prepared.usagePromise;
      const usage = capturedUsage ?? prepared.capturedUsage;
      const requestId = capturedResponseId ?? prepared.capturedResponseId;
      const satsSpent = await this._handlePostResponseBalanceUpdate({
        token: prepared.tokenUsed,
        baseUrl: prepared.baseUrlUsed,
        mintUrl: params.mintUrl,
        initialTokenBalance: prepared.tokenBalanceInSats,
        response: prepared.response,
        modelId: prepared.modelId,
        usage,
        requestId,
        clientApiKey: prepared.clientApiKey,
      });
      (prepared.response as any).satsSpent = satsSpent;
      (prepared.response as any).usage = usage;
      (prepared.response as any).requestId = requestId;
      return satsSpent;
    };

    if (isSSE) {
      // Expose a finalize() that the caller can await after it's done piping
      // the stream to its client. Also fire-and-forget so accounting still
      // happens even if the caller ignores it.
      const finalizePromise = runFinalize().catch((error) => {
        this._log("ERROR", "[RoutstrClient] SSE finalize failed:", error);
        return 0;
      });
      (prepared.response as any).finalize = () => finalizePromise;
      return prepared.response;
    }

    await runFinalize();
    return prepared.response;
  }

  private async _prepareRoutedRequest(params: RouteRequestParams): Promise<{
    response: Response;
    tokenUsed: string;
    baseUrlUsed: string;
    tokenBalanceInSats: number;
    modelId?: string;
    capturedUsage?: UsageTrackingData;
    capturedResponseId?: string;
    clientApiKey?: string;
    usagePromise: Promise<{
      capturedUsage?: UsageTrackingData;
      capturedResponseId?: string;
    }>;
  }> {
    const {
      path: requestPath,
      method,
      body,
      headers = {},
      baseUrl,
      mintUrl,
      modelId,
      clientApiKey: providedClientApiKey,
    } = params;

    // Extract clientApiKey from incoming headers then discard them — they must
    // not be forwarded upstream (the client's Authorization Bearer key would
    // overwrite the Cashu/API-key auth we attach ourselves).
    const clientApiKey =
      providedClientApiKey ?? this._extractClientApiKey(headers);

    await this._checkBalance();

    let requiredSats = 1;
    let selectedModel: Model | undefined;
    if (modelId) {
      const providerModel = await this.providerManager.getModelForProvider(
        baseUrl,
        modelId
      );
      selectedModel = providerModel ?? undefined;
      if (selectedModel) {
        const requestMessages = Array.isArray(
          (body as { messages?: unknown })?.messages
        )
          ? ((body as { messages?: unknown }).messages as any[])
          : [];
        const requestMaxTokens =
          typeof (body as { max_tokens?: unknown })?.max_tokens === "number"
            ? ((body as { max_tokens?: unknown }).max_tokens as number)
            : undefined;

        this._log(
          "DEBUG",
          "[RoutstrClient] generic request pricing input",
          {
            modelId: selectedModel.id,
            messageCount: requestMessages.length,
            maxTokens: requestMaxTokens,
          }
        );

        requiredSats = this.providerManager.getRequiredSatsForModel(
          selectedModel,
          requestMessages,
          requestMaxTokens
        );
      }
    }

    const { token, tokenBalance, tokenBalanceUnit } = await this._spendToken({
      mintUrl,
      amount: requiredSats,
      baseUrl,
    });

    let requestBody = body;
    if (body && typeof body === "object") {
      const bodyObj = body as Record<string, unknown>;
      if (!bodyObj.stream) {
        requestBody = { ...bodyObj, stream: false };
      }
    }

    // Build clean outgoing headers — do NOT pass the incoming client headers here
    const baseHeaders = this._buildBaseHeaders();
    const requestHeaders = this._withAuthHeader(baseHeaders, token);

    const response = await this._makeRequest({
      path: requestPath,
      method,
      body: method === "GET" ? undefined : requestBody,
      baseUrl,
      mintUrl,
      token,
      requiredSats,
      headers: requestHeaders,
      baseHeaders,
      selectedModel,
    });

    const tokenBalanceInSats =
      tokenBalanceUnit === "msat" ? tokenBalance / 1000 : tokenBalance;
    const baseUrlUsed = (response as any).baseUrl || baseUrl;
    const tokenUsed = (response as any).token || token;

    const contentType = response.headers.get("content-type") || "";
    let processedResponse = response;
    let capturedUsage: UsageTrackingData | undefined;
    let capturedResponseId: string | undefined;
    let usagePromise: Promise<{
      capturedUsage?: UsageTrackingData;
      capturedResponseId?: string;
    }> = Promise.resolve({});

    if (contentType.includes("text/event-stream") && response.body) {
      // Tee the upstream Web stream: one branch goes untouched to the client,
      // the other is consumed by an inspector that extracts usage / responseId.
      const [clientStream, inspectStream] = response.body.tee();

      processedResponse = new Response(clientStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      (processedResponse as any).baseUrl = (response as any).baseUrl;
      (processedResponse as any).token = (response as any).token;

      usagePromise = inspectSSEWebStream(
        inspectStream,
        (usage) => {
          capturedUsage = usage;
          (processedResponse as any).usage = usage;
        },
        (responseId) => {
          capturedResponseId = responseId;
          (processedResponse as any).requestId = responseId;
        }
      );

      (processedResponse as any).usagePromise = usagePromise;
    }

    return {
      response: processedResponse,
      tokenUsed,
      baseUrlUsed,
      tokenBalanceInSats,
      modelId,
      capturedUsage,
      capturedResponseId,
      clientApiKey,
      usagePromise,
    };
  }

  /**
   * Extract clientApiKey from Authorization Bearer token if present
   */
  private _extractClientApiKey(
    headers: Record<string, string>
  ): string | undefined {
    const authHeader = headers["Authorization"] || headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      const extractedKey = authHeader.slice(7);
      return extractedKey;
    }
    return undefined;
  }

  /**
   * Fetch AI response with streaming
   */
  async fetchAIResponse(
    options: FetchOptions,
    callbacks: StreamingCallbacks
  ): Promise<void> {
    const {
      messageHistory,
      selectedModel,
      baseUrl,
      mintUrl,
      balance,
      transactionHistory,
      maxTokens,
      headers,
    } = options;

    // Convert messages for API
    const apiMessages = await this._convertMessages(messageHistory);

    // Calculate required amount
    const requiredSats = this.providerManager.getRequiredSatsForModel(
      selectedModel,
      apiMessages,
      maxTokens
    );

    try {
      // Check balance first
      await this._checkBalance();

      // Spend tokens
      callbacks.onPaymentProcessing?.(true);

      const spendResult = await this._spendToken({
        mintUrl,
        amount: requiredSats,
        baseUrl,
      });

      let token = spendResult.token;
      let tokenBalance = spendResult.tokenBalance;
      let tokenBalanceUnit = spendResult.tokenBalanceUnit;

      const tokenBalanceInSats =
        tokenBalanceUnit === "msat" ? tokenBalance / 1000 : tokenBalance;

      callbacks.onTokenCreated?.(this._getPendingCashuTokenAmount());

      const baseHeaders = this._buildBaseHeaders(headers);
      const requestHeaders = this._withAuthHeader(baseHeaders, token);

      // Get provider info for version compatibility
      const providerInfo = await this.providerRegistry.getProviderInfo(baseUrl);
      const providerVersion = providerInfo?.version ?? "";

      // Handle v0.1.x providers (only send leaf ID)
      let modelIdForRequest = selectedModel.id;
      if (/^0\.1\./.test(providerVersion)) {
        const newModel = await this.providerManager.getModelForProvider(
          baseUrl,
          selectedModel.id
        );
        modelIdForRequest = newModel?.id ?? selectedModel.id;
      }

      const body: any = {
        model: modelIdForRequest,
        messages: apiMessages,
        stream: true,
      };

      if (maxTokens !== undefined) {
        body.max_tokens = maxTokens;
      }

      // Only add tools for OpenAI models
      if (selectedModel?.name?.startsWith("OpenAI:")) {
        body.tools = [{ type: "web_search" }];
      }

      // Make API request
      const response = await this._makeRequest({
        path: "/v1/chat/completions",
        method: "POST",
        body,
        selectedModel,
        baseUrl,
        mintUrl,
        token,
        requiredSats,
        maxTokens,
        headers: requestHeaders,
        baseHeaders,
      });

      if (!response.body) {
        throw new Error("Response body is not available");
      }

      // Process streaming response
      if (response.status === 200) {
        const baseUrlUsed = (response as any).baseUrl || baseUrl;

        const streamingResult = await this.streamProcessor.process(
          response,
          {
            onContent: callbacks.onStreamingUpdate,
            onThinking: callbacks.onThinkingUpdate,
          },
          selectedModel.id
        );

        // Handle finish reason
        if (streamingResult.finish_reason === "content_filter") {
          callbacks.onMessageAppend({
            role: "assistant",
            content: "Your request was denied due to content filtering.",
          });
        } else if (
          streamingResult.content ||
          (streamingResult.images && streamingResult.images.length > 0)
        ) {
          // Create assistant message
          const message = await this._createAssistantMessage(streamingResult);
          callbacks.onMessageAppend(message);
        } else {
          // No content received
          callbacks.onMessageAppend({
            role: "system",
            content: "The provider did not respond to this request.",
          });
        }

        // Clear streaming
        callbacks.onStreamingUpdate("");
        callbacks.onThinkingUpdate("");

        // Handle post-response refund (skip for xcashu mode - refund is in response)
        const isApikeysEstimate = this.mode === "apikeys";
        let satsSpent = await this._handlePostResponseBalanceUpdate({
          token,
          baseUrl: baseUrlUsed,
          mintUrl,
          initialTokenBalance: tokenBalanceInSats,
          fallbackSatsSpent: isApikeysEstimate
            ? this._getEstimatedCosts(selectedModel, streamingResult)
            : undefined,
          response,
          modelId: selectedModel.id,
          usage: streamingResult.usage
            ? {
                promptTokens: Number(streamingResult.usage.prompt_tokens ?? 0),
                completionTokens: Number(
                  streamingResult.usage.completion_tokens ?? 0
                ),
                totalTokens: Number(streamingResult.usage.total_tokens ?? 0),
                cost: Number(streamingResult.usage.cost ?? 0),
                satsCost: Number(streamingResult.usage.sats_cost ?? 0),
              }
            : undefined,
          requestId: streamingResult.responseId,
        });
        const estimatedCosts = this._getEstimatedCosts(
          selectedModel,
          streamingResult
        );
        const onLastMessageSatsUpdate = callbacks.onLastMessageSatsUpdate as
          | ((satsSpent: number, estimatedCosts: number) => void)
          | undefined;
        onLastMessageSatsUpdate?.(satsSpent, estimatedCosts);
      } else {
        throw new Error(`${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this._handleError(error, callbacks);
    } finally {
      callbacks.onPaymentProcessing?.(false);
    }
  }

  /**
   * Make the API request with failover support
   */
  private async _makeRequest(params: {
    path: string;
    method: string;
    body?: unknown;
    selectedModel?: Model;
    baseUrl: string;
    mintUrl: string;
    token: string;
    requiredSats: number;
    maxTokens?: number;
    headers: Record<string, string>;
    baseHeaders: Record<string, string>;
    retryCount?: number;
  }): Promise<Response> {
    const { path, method, body, baseUrl, token, headers } = params;

    try {
      const url = `${baseUrl.replace(/\/$/, "")}${path}`;
      if (this.mode === "xcashu") this._log("DEBUG", "HEADERS,", headers);
      const response = await fetch(url, {
        method,
        headers,
        body:
          body === undefined || method === "GET"
            ? undefined
            : JSON.stringify(body),
      });
      if (this.mode === "xcashu") this._log("DEBUG", "response,", response);

      (response as any).baseUrl = baseUrl;
      (response as any).token = token;

      if (!response.ok) {
        const requestId =
          response.headers.get("x-routstr-request-id") || undefined;
        let bodyText: string | undefined;
        try {
          bodyText = await response.text();
        } catch (e) {
          bodyText = undefined;
        }
        return await this._handleErrorResponse(
          params,
          token,
          response.status,
          requestId,
          this.mode === "xcashu"
            ? (response.headers.get("x-cashu") ?? undefined)
            : undefined,
          bodyText,
          params.retryCount ?? 0
        );
      }

      return response;
    } catch (error: any) {
      // Handle network errors with failover
      if (isNetworkErrorMessage(error?.message || "")) {
        return await this._handleErrorResponse(
          params,
          token,
          -1, // just for Network Error to skip all statuses
          undefined,
          undefined,
          undefined,
          params.retryCount ?? 0
        );
        // return await this._handleNetworkError(error, params);
      }
      throw error;
    }
  }

  /**
   * Handle error responses with failover
   */
  private async _handleErrorResponse(
    params: {
      path: string;
      method: string;
      body?: unknown;
      selectedModel?: Model;
      baseUrl: string;
      mintUrl: string;
      token: string;
      requiredSats: number;
      maxTokens?: number;
      headers: Record<string, string>;
      baseHeaders: Record<string, string>;
    },
    token: string,
    status: number,
    requestId?: string,
    xCashuRefundToken?: string,
    responseBody?: string,
    retryCount: number = 0
  ): Promise<Response> {
    const MAX_RETRIES_PER_PROVIDER = 2;
    const { path, method, body, selectedModel, baseUrl, mintUrl } = params;
    let tryNextProvider: boolean = false;

    const errorMessage = responseBody;

    this._log(
      "DEBUG",
      `[RoutstrClient] _handleErrorResponse: status=${status}, baseUrl=${baseUrl}, mode=${this.mode}, token preview=${token}, requestId=${requestId}, errorMessage=${errorMessage}`
    );

    this._log(
      "DEBUG",
      `[RoutstrClient] _handleErrorResponse: Attempting to receive/restore token for ${baseUrl}`
    );
    if (params.token.startsWith("cashu")) {
      const receiveResult = await this.cashuSpender.receiveToken(
        params.token
      );
      if (receiveResult.success) {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Token restored successfully, amount=${receiveResult.amount}`
        );
        tryNextProvider = true;
      } else {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Failed to receive token: ${receiveResult.message}`
        );
      }
    }

    if (this.mode === "xcashu") {
      if (xCashuRefundToken) {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Attempting to receive xcashu refund token, preview=${xCashuRefundToken.substring(0, 20)}...`
        );
        const receiveResult =
          await this.cashuSpender.receiveToken(xCashuRefundToken);
        if (receiveResult.success) {
          this._log(
            "DEBUG",
            `[RoutstrClient] _handleErrorResponse: xcashu refund received, amount=${receiveResult.amount}`
          );
          tryNextProvider = true;
        } else {
          this._log(
            "ERROR",
            `[xcashu] Failed to receive refund token: ${receiveResult.message}`
          );
          throw new ProviderError(
            baseUrl,
            status,
            "[xcashu] Failed to receive refund token",
            requestId
          );
        }
      } else {
        if (!tryNextProvider)
          throw new ProviderError(
            baseUrl,
            status,
            "[xcashu] Failed to receive refund token",
            requestId
          );
      }
    }

    if (status === 402 && !tryNextProvider && this.mode === "apikeys") {
      this.storageAdapter.getApiKey(baseUrl);

      let topupAmount = params.requiredSats;

      try {
        const currentBalanceInfo = await this.balanceManager.getTokenBalance(
          params.token,
          baseUrl
        );
        const currentBalance =
          currentBalanceInfo.unit === "msat"
            ? currentBalanceInfo.amount / 1000
            : currentBalanceInfo.amount;
        const reservedBalance =
          currentBalanceInfo.unit === "msat"
            ? (currentBalanceInfo.reserved ?? 0) / 1000
            : (currentBalanceInfo.reserved ?? 0);

        const shortfall = Math.max(0, params.requiredSats - currentBalance + reservedBalance);
        topupAmount = shortfall > (0.21 * params.requiredSats) ? shortfall : (0.21 * params.requiredSats);

        this._log(
          "DEBUG",
          `The shortfall is: ${shortfall}. requiredSats: ${params.requiredSats}. Current Balance: ${currentBalance}. Reserved Balance: ${reservedBalance}. Available Balance: ${currentBalance - reservedBalance}`
        );
      } catch (e) {
        this._log(
          "WARN",
          "Could not get current token balance for topup calculation:",
          e
        );
      }

      const topupResult = await this.balanceManager.topUp({
        mintUrl,
        baseUrl,
        amount: topupAmount * TOPUP_MARGIN,
        token: params.token,
      });
      this._log(
        "DEBUG",
        `[RoutstrClient] _handleErrorResponse: Topup result for ${baseUrl}: success=${topupResult.success}, message=${topupResult.message}`
      );

      if (!topupResult.success) {
        const message = topupResult.message || "";
        if (message.includes("Insufficient balance")) {
          const needMatch = message.match(/need (\d+)/);
          const haveMatch = message.match(/have (\d+)/);
          const required = needMatch
            ? parseInt(needMatch[1], 10)
            : params.requiredSats;
          const available = haveMatch ? parseInt(haveMatch[1], 10) : 0;
          this._log(
            "DEBUG",
            `[RoutstrClient] _handleErrorResponse: Insufficient balance, need=${required}, have=${available}`
          );
          throw new InsufficientBalanceError(
            required,
            available,
            0,
            "",
            message
          );
        } else {
          this._log(
            "DEBUG",
            `[RoutstrClient] _handleErrorResponse: Topup failed with non-insufficient-balance error, will try next provider`
          );
          tryNextProvider = true;
        }
      } else {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Topup successful, will retry with new token`
        );
      }
      if (!tryNextProvider) {
        if (retryCount < MAX_RETRIES_PER_PROVIDER) {
          this._log(
            "DEBUG",
            `[RoutstrClient] _handleErrorResponse: Retrying 402 (attempt ${retryCount + 1}/${MAX_RETRIES_PER_PROVIDER})`
          );
          return this._makeRequest({
            ...params,
            token: params.token,
            headers: this._withAuthHeader(params.baseHeaders, params.token),
            retryCount: retryCount + 1,
          });
        } else {
          this._log(
            "DEBUG",
            `[RoutstrClient] _handleErrorResponse: 402 retry limit reached (${retryCount}/${MAX_RETRIES_PER_PROVIDER}), failing over to next provider`
          );
          tryNextProvider = true;
        }
      }
    }

    const isInsufficientBalance413 =
      status === 413 && responseBody?.includes("Insufficient balance");

    if (
      isInsufficientBalance413 &&
      !tryNextProvider &&
      this.mode === "apikeys"
    ) {
      let retryToken = params.token;

      try {
        const latestBalanceInfo = await this.balanceManager.getTokenBalance(
          params.token,
          baseUrl
        );

        // Handle invalid/expired API key - delete and fail over
        if (latestBalanceInfo.isInvalidApiKey) {
          this._log(
            "DEBUG",
            `[RoutstrClient] _handleErrorResponse: Invalid API key (proofs already spent), removing for ${baseUrl}`
          );
          this.storageAdapter.removeApiKey(baseUrl);
          tryNextProvider = true;
        } else {
          const latestTokenBalance =
            latestBalanceInfo.unit === "msat"
              ? latestBalanceInfo.amount / 1000
              : latestBalanceInfo.amount;

          if (latestBalanceInfo.apiKey) {
            const storedApiKeyEntry = this.storageAdapter.getApiKey(baseUrl);
            if (storedApiKeyEntry?.key !== latestBalanceInfo.apiKey) {
              if (storedApiKeyEntry) {
                this.storageAdapter.removeApiKey(baseUrl);
              }
              this.storageAdapter.setApiKey(baseUrl, latestBalanceInfo.apiKey);
            }
            retryToken = latestBalanceInfo.apiKey;
          }

          if (latestTokenBalance >= 0) {
            this.storageAdapter.updateApiKeyBalance(
              baseUrl,
              latestTokenBalance
            );
          }
        }
      } catch (error) {
        this._log(
          "WARN",
          `[RoutstrClient] _handleErrorResponse: Failed to refresh API key after 413 insufficient balance for ${baseUrl}`,
          error
        );
      }

      if (retryCount < MAX_RETRIES_PER_PROVIDER) {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Retrying 413 (attempt ${retryCount + 1}/${MAX_RETRIES_PER_PROVIDER})`
        );
        return this._makeRequest({
          ...params,
          token: retryToken,
          headers: this._withAuthHeader(params.baseHeaders, retryToken),
          retryCount: retryCount + 1,
        });
      } else {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: 413 retry limit reached (${retryCount}/${MAX_RETRIES_PER_PROVIDER}), failing over to next provider`
        );
        tryNextProvider = true;
      }
    }

    if (status === 401 && this.mode === "apikeys") {
      this._log(
        "DEBUG",
        `[RoutstrClient] _handleErrorResponse: Checking balance for ${baseUrl}, key preview=${token}`
      );
      const latestBalanceInfo = await this.balanceManager.getTokenBalance(
        token,
        baseUrl
      );
      if (latestBalanceInfo.isInvalidApiKey) {
        this.storageAdapter.removeApiKey(baseUrl);
        tryNextProvider = true;
      }
    }

    if (
      (status === 401 ||
        status === 403 ||
        status === 413 ||
        status === 400 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status === 521) &&
      !tryNextProvider
    ) {
      this._log(
        "DEBUG",
        `[RoutstrClient] _handleErrorResponse: Status ${status} (auth/server error), attempting refund for ${baseUrl}, mode=${this.mode}`
      );
      if (this.mode === "apikeys") {
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Attempting API key refund for ${baseUrl}, key preview=${token}`
        );
        const latestBalanceInfo = await this.balanceManager.getTokenBalance(
          token,
          baseUrl
        );
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: Initial API key balance: ${latestBalanceInfo.amount}`
        );
        const refundResult = await this.balanceManager.refundApiKey({
          mintUrl,
          baseUrl,
          apiKey: token,
          forceRefund: true,
        });
        this._log(
          "DEBUG",
          `[RoutstrClient] _handleErrorResponse: API key refund result: success=${refundResult.success}, message=${refundResult.message}`
        );
        if (!refundResult.success && latestBalanceInfo.amount > 0) {
          throw new ProviderError(
            baseUrl,
            status,
            refundResult.message ?? "Unknown error"
          );
        }
      }
    }

    this.providerManager.markFailed(baseUrl);
    this._log(
      "DEBUG",
      `[RoutstrClient] _handleErrorResponse: Marked provider ${baseUrl} as failed`
    );

    if (!selectedModel) {
      throw new ProviderError(
        baseUrl,
        status,
        "Funny, no selected model. HMM. "
      );
    }

    const nextProvider = this.providerManager.findNextBestProvider(
      selectedModel.id,
      baseUrl
    );

    if (nextProvider) {
      this._log(
        "DEBUG",
        `[RoutstrClient] _handleErrorResponse: Failing over to next provider: ${nextProvider}, model: ${selectedModel.id}`
      );
      // Get new model for this provider
      const newModel =
        (await this.providerManager.getModelForProvider(
          nextProvider,
          selectedModel.id
        )) ?? selectedModel;

      const messagesForPricing = Array.isArray(
        (body as { messages?: unknown })?.messages
      )
        ? ((body as { messages?: unknown }).messages as any[])
        : [];

      const newRequiredSats = this.providerManager.getRequiredSatsForModel(
        newModel,
        messagesForPricing,
        params.maxTokens
      );

      this._log(
        "DEBUG",
        `[RoutstrClient] _handleErrorResponse: Creating new token for failover provider ${nextProvider}, required sats: ${newRequiredSats}`
      );
      const spendResult = await this._spendToken({
        mintUrl,
        amount: newRequiredSats,
        baseUrl: nextProvider,
      });

      // Retry with new provider (reset retry count)
      return this._makeRequest({
        ...params,
        path,
        method,
        body,
        baseUrl: nextProvider,
        selectedModel: newModel,
        token: spendResult.token!,
        requiredSats: newRequiredSats,
        headers: this._withAuthHeader(params.baseHeaders, spendResult.token!),
        retryCount: 0,
      });
    }

    // No more providers to try
    throw new FailoverError(
      baseUrl,
      Array.from(this.providerManager.getFailedProviders())
    );
  }

  /**
   * Handle post-response balance update for all modes
   */
  private async _handlePostResponseBalanceUpdate(params: {
    token: string;
    baseUrl: string;
    mintUrl: string;
    initialTokenBalance: number;
    fallbackSatsSpent?: number;
    response?: Response;
    modelId?: string;
    usage?: UsageTrackingData;
    requestId?: string;
    clientApiKey?: string;
  }): Promise<number> {
    const {
      token,
      baseUrl,
      mintUrl,
      initialTokenBalance,
      fallbackSatsSpent,
      response,
      modelId,
      usage,
      requestId,
      clientApiKey,
    } = params;

    let satsSpent: number = initialTokenBalance;

    if (this.mode === "xcashu" && response) {
      const refundToken = response.headers.get("x-cashu") ?? undefined;
      if (refundToken) {
        const receiveResult =
          await this.cashuSpender.receiveToken(refundToken);
        if (receiveResult.success) {
          // Remove the spent token from storage
          this.storageAdapter.removeXcashuToken(baseUrl, token);
          satsSpent =
            initialTokenBalance -
            receiveResult.amount * (receiveResult.unit == "sat" ? 1 : 1000);
        } else {
          this._log(
            "ERROR",
            `[xcashu] Failed to receive refund token: ${receiveResult.message}`
          );
        }
      }
    } else if (this.mode === "apikeys") {
      try {
        const latestBalanceInfo = await this.balanceManager.getTokenBalance(
          token,
          baseUrl
        );
        this._log(
          "DEBUG",
          "LATEST Balance",
          latestBalanceInfo.amount,
          latestBalanceInfo.reserved,
          latestBalanceInfo.apiKey,
          baseUrl
        );
        const latestTokenBalance =
          latestBalanceInfo.unit === "msat"
            ? latestBalanceInfo.amount / 1000
            : latestBalanceInfo.amount;

        const storedApiKeyEntry = this.storageAdapter.getApiKey(baseUrl);
        if (
          storedApiKeyEntry?.key.startsWith("cashu") &&
          latestBalanceInfo.apiKey
        ) {
          this.storageAdapter.removeApiKey(baseUrl);
          this.storageAdapter.setApiKey(baseUrl, latestBalanceInfo.apiKey);
        }
        this.storageAdapter.updateApiKeyBalance(baseUrl, latestTokenBalance);

        satsSpent = initialTokenBalance - latestTokenBalance;
      } catch (e) {
        this._log("WARN", "Could not get updated API key balance:", e);
        satsSpent = fallbackSatsSpent ?? initialTokenBalance;
      }
    }

    await this._trackResponseUsage({
      token,
      baseUrl,
      response,
      modelId,
      satsSpent,
      usage,
      requestId,
      clientApiKey,
    });

    // Fire-and-forget async spinoff - does not block
    (async () => {
      try {
        // Refund all xcashu tokens
        // const xcashuResults =
        //  await this.cashuSpender.refundXcashuTokens(mintUrl);
        // this._log("DEBUG", "Refund xcashu tokens results:", xcashuResults);

        // Also refund API keys (apikeys mode) DISABLED FOR NOW
        // const results = await this.cashuSpaender.refundProviders(mintUrl);
      } catch (error) {
        this._log("ERROR", "Failed to refund providers:", error);
      }
    })();

    return satsSpent;
  }

  private async _trackResponseUsage(params: {
    token: string;
    baseUrl: string;
    response?: Response;
    modelId?: string;
    satsSpent: number;
    usage?: UsageTrackingData;
    requestId?: string;
    clientApiKey?: string;
  }): Promise<void> {
    const {
      token,
      baseUrl,
      response,
      modelId,
      satsSpent,
      usage: providedUsage,
      requestId: providedRequestId,
      clientApiKey,
    } = params;

    if (!response || !modelId) {
      return;
    }

    try {
      let usage = providedUsage;
      let requestId = providedRequestId;

      if (!usage || !requestId) {
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("text/event-stream")) {
          usage = usage ?? (response as any).usage;
          requestId =
            requestId ??
            (response as any).requestId ??
            response.headers.get("x-routstr-request-id") ??
            undefined;

          if (!usage) {
            return;
          }
        } else {
          const cloned = response.clone();
          const responseBody = await cloned.json();
          usage =
            usage ??
            extractUsageFromResponseBody(responseBody, satsSpent) ??
            undefined;
          requestId =
            requestId ??
            extractResponseId(responseBody) ??
            response.headers.get("x-routstr-request-id") ??
            undefined;
        }
      }

      if (!usage) {
        return;
      }

      const finalRequestId = requestId || "unknown";

      const store = this.sdkStore ?? (await getDefaultSdkStore());
      const state = store.getState();

      // Use clientApiKey for matching if provided, otherwise fall back to token
      const matchKey = clientApiKey ?? token;
      const matchingClient = state.clientIds.find(
        (client) => client.apiKey === matchKey
      );

      const entryId =
        finalRequestId === "unknown"
          ? `req-${Date.now()}-${modelId}`
          : finalRequestId;

      const usageTracking =
        this.usageTrackingDriver ?? getDefaultUsageTrackingDriver();

      const entry = {
        id: entryId,
        timestamp: Date.now(),
        modelId,
        baseUrl,
        requestId: finalRequestId,
        client: matchingClient?.clientId,
        ...usage,
      };

      // For xcashu mode, use satsSpent directly for satsCost instead of calculating from usage
      if (this.mode === "xcashu") {
        entry.satsCost = satsSpent;
      }

      await usageTracking.append(entry);
    } catch (error) {
      // Silently ignore tracking failures
    }
  }

  /**
   * Convert messages for API format
   */
  private async _convertMessages(messages: Message[]): Promise<any[]> {
    return Promise.all(
      messages
        .filter((m) => m.role !== "system")
        .map(async (m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : m.content,
        }))
    );
  }

  /**
   * Create assistant message from streaming result
   */
  private async _createAssistantMessage(
    result: StreamingResult
  ): Promise<Message> {
    if (result.images && result.images.length > 0) {
      // Multimodal message with images
      const content: any[] = [];

      if (result.content) {
        content.push({
          type: "text",
          text: result.content,
          thinking: result.thinking,
          citations: result.citations,
          annotations: result.annotations,
        });
      }

      for (const img of result.images) {
        content.push({
          type: "image_url",
          image_url: {
            url: img.image_url.url,
          },
        });
      }

      return {
        role: "assistant",
        content,
      };
    }

    // Simple text message
    return {
      role: "assistant",
      content: result.content || "",
    };
  }

  /**
   * Calculate estimated costs from usage
   */
  private _getEstimatedCosts(
    selectedModel: Model,
    streamingResult: StreamingResult
  ): number {
    let estimatedCosts = 0;
    if (streamingResult.usage) {
      const { completion_tokens, prompt_tokens } = streamingResult.usage;
      if (completion_tokens !== undefined && prompt_tokens !== undefined) {
        estimatedCosts =
          (selectedModel.sats_pricing?.completion ?? 0) * completion_tokens +
          (selectedModel.sats_pricing?.prompt ?? 0) * prompt_tokens;
      }
    }
    return estimatedCosts;
  }

  /**
   * Get pending API key amount
   */
  private _getPendingCashuTokenAmount(): number {
    const apiKeyDistribution = this.storageAdapter.getApiKeyDistribution();
    return apiKeyDistribution.reduce((total, item) => total + item.amount, 0);
  }

  /**
   * Handle errors and notify callbacks
   */
  private _handleError(error: unknown, callbacks: StreamingCallbacks): void {
    this._log("ERROR", "[RoutstrClient] _handleError: Error occurred", error);

    if (error instanceof Error) {
      const isStreamError =
        error.message.includes("Error in input stream") ||
        error.message.includes("Load failed");
      const modifiedErrorMsg = isStreamError
        ? "AI stream was cut off, turn on Keep Active or please try again"
        : error.message;

      this._log(
        "ERROR",
        `[RoutstrClient] _handleError: Error type=${error.constructor.name}, message=${modifiedErrorMsg}, isStreamError=${isStreamError}`
      );

      callbacks.onMessageAppend({
        role: "system",
        content:
          "Uncaught Error: " +
          modifiedErrorMsg +
          (this.alertLevel === "max" ? " | " + error.stack : ""),
      });
    } else {
      callbacks.onMessageAppend({
        role: "system",
        content: "Unknown Error: Please tag Routstr on Nostr and/or retry.",
      });
    }
  }

  /**
   * Check wallet balance and throw if insufficient
   */
  private async _checkBalance(): Promise<void> {
    const balances = await this.walletAdapter.getBalances();
    const totalBalance = Object.values(balances).reduce((sum, v) => sum + v, 0);

    if (totalBalance <= 0) {
      throw new InsufficientBalanceError(1, 0);
    }
  }

  /**
   * Spend a token using CashuSpender with standardized error handling
   */
  private async _spendToken(params: {
    mintUrl: string;
    amount: number;
    baseUrl: string;
  }): Promise<{
    token: string;
    tokenBalance: number;
    tokenBalanceUnit: "sat" | "msat";
  }> {
    const { mintUrl, amount, baseUrl } = params;

    this._log(
      "DEBUG",
      `[RoutstrClient] _spendToken: mode=${this.mode}, amount=${amount}, baseUrl=${baseUrl}, mintUrl=${mintUrl}`
    );

    if (this.mode === "apikeys") {
      let parentApiKey = this.storageAdapter.getApiKey(baseUrl);
      if (!parentApiKey) {
        this._log(
          "DEBUG",
          `[RoutstrClient] _spendToken: No existing API key for ${baseUrl}, creating new one via Cashu`
        );
        const spendResult = await this.cashuSpender.spend({
          mintUrl: mintUrl,
          amount: amount * TOPUP_MARGIN,
          baseUrl: "",
          reuseToken: false,
        });

        if (!spendResult.token) {
          this._log(
            "ERROR",
            `[RoutstrClient] _spendToken: Failed to create Cashu token for API key creation, error:`,
            spendResult.error
          );
          throw new Error(
            `[RoutstrClient] _spendToken: Failed to create Cashu token for API key creation, error: ${spendResult.error}`
          );
        } else {
          this._log(
            "DEBUG",
            `[RoutstrClient] _spendToken: Cashu token created, token preview: ${spendResult.token}`
          );
        }

        this._log(
          "DEBUG",
          `[RoutstrClient] _spendToken: Created API key for ${baseUrl}, key preview: ${spendResult.token}, balance: ${spendResult.balance}`
        );

        try {
          this.storageAdapter.setApiKey(baseUrl, spendResult.token);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("ApiKey already exists")
          ) {
            const receiveResult = await this.cashuSpender.receiveToken(
              spendResult.token
            );
            if (receiveResult.success) {
              this._log(
                "DEBUG",
                `[RoutstrClient] _handleErrorResponse: Token restored successfully, amount=${receiveResult.amount}`
              );
            } else {
              this._log(
                "DEBUG",
                `[RoutstrClient] _handleErrorResponse: Token restore failed: ${receiveResult.message}`
              );
            }
            this._log(
              "DEBUG",
              `[RoutstrClient] _spendToken: API key already exists for ${baseUrl}, using existing key`
            );
          } else {
            throw error;
          }
        }
        parentApiKey = this.storageAdapter.getApiKey(baseUrl);
      } else {
        this._log(
          "DEBUG",
          `[RoutstrClient] _spendToken: Using existing API key for ${baseUrl}, key preview: ${parentApiKey.key}`
        );
      }

      let tokenBalance = 0;
      let tokenBalanceUnit: "sat" | "msat" = "sat";

      const apiKeyDistribution = this.storageAdapter.getApiKeyDistribution();
      const distributionForBaseUrl = apiKeyDistribution.find(
        (d) => d.baseUrl === baseUrl
      );
      if (distributionForBaseUrl) {
        tokenBalance = distributionForBaseUrl.amount;
      }

      if (tokenBalance === 0 && parentApiKey) {
        try {
          const balanceInfo = await this.balanceManager.getTokenBalance(
            parentApiKey.key,
            baseUrl
          );
          tokenBalance = balanceInfo.amount;
          tokenBalanceUnit = balanceInfo.unit;
        } catch (e) {
          this._log("WARN", "Could not get initial API key balance:", e);
        }
      }

      this._log(
        "DEBUG",
        `[RoutstrClient] _spendToken: Returning token with balance=${tokenBalance} ${tokenBalanceUnit}`
      );

      return {
        token: parentApiKey?.key ?? "",
        tokenBalance,
        tokenBalanceUnit,
      };
    }

    this._log(
      "DEBUG",
      `[RoutstrClient] _spendToken: Calling CashuSpender.spend for amount=${amount}, mintUrl=${mintUrl}, mode=${this.mode}`
    );
    const spendResult = await this.cashuSpender.spend({
      mintUrl,
      amount,
      baseUrl: "",
      reuseToken: false,
    });

    if (!spendResult.token) {
      this._log(
        "ERROR",
        `[RoutstrClient] _spendToken: CashuSpender.spend failed, error:`,
        spendResult.error
      );
    } else {
      this._log(
        "DEBUG",
        `[RoutstrClient] _spendToken: Cashu token created, token preview: ${spendResult.token}, balance: ${spendResult.balance} ${spendResult.unit ?? "sat"}`
      );
      // Store xcashu token using the storage adapter
      this.storageAdapter.addXcashuToken(baseUrl, spendResult.token);
    }

    return {
      token: spendResult.token!,
      tokenBalance: spendResult.balance,
      tokenBalanceUnit: spendResult.unit ?? "sat",
    };
  }

  /**
   * Build request headers with common defaults and dev mock controls
   */
  private _buildBaseHeaders(
    additionalHeaders: Record<string, string> = {},
    token?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...additionalHeaders,
      "Content-Type": "application/json",
    };

    return headers;
  }

  /**
   * Attach auth headers using the active client mode
   */
  private _withAuthHeader(
    headers: Record<string, string>,
    token: string
  ): Record<string, string> {
    const nextHeaders = { ...headers };

    if (this.mode === "xcashu") {
      nextHeaders["X-Cashu"] = token;
    } else {
      nextHeaders["Authorization"] = `Bearer ${token}`;
    }

    return nextHeaders;
  }
}
