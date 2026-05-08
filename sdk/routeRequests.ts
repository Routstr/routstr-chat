/**
 * routeRequests - SDK helper for routing OpenAI-compatible requests to the cheapest provider
 *
 * This module provides a reusable function for routing requests to the cheapest
 * provider based on model pricing, with automatic Cashu token handling.
 */

import type { Model, Message, SdkLogger } from "./core/types";
import type { DiscoveryAdapter } from "./discovery/interfaces";
import type {
  ProviderRegistry,
  WalletAdapter,
  StorageAdapter,
} from "./wallet/interfaces";
import { ModelManager } from "./discovery/ModelManager";
import { ProviderManager } from "./client/ProviderManager";
import { RoutstrClient, type DebugLevel } from "./client/RoutstrClient";
import type { UsageTrackingDriver } from "./storage/usageTracking";
import type { SdkStore } from "./storage/store";

/**
 * Options for routeRequests function
 */
export interface RouteRequestOptions {
  /** The model ID to route (e.g., "gpt-4o") */
  modelId: string;
  /** The request body to proxy to the provider */
  requestBody: unknown;
  /** Optional: API path (defaults to /v1/chat/completions) */
  path?: string;
  /** Optional: request headers to forward upstream */
  headers?: Record<string, string>;
  /** Optional: force a specific provider base URL */
  forcedProvider?: string;
  /** Wallet adapter for Cashu operations */
  walletAdapter: WalletAdapter;
  /** Storage adapter for caching */
  storageAdapter: StorageAdapter;
  /** Provider registry for tracking available providers */
  providerRegistry: ProviderRegistry;
  /** Discovery adapter for model/mint discovery */
  discoveryAdapter: DiscoveryAdapter;
  /** Optional: additional provider URLs to include */
  includeProviderUrls?: string[];
  /** Optional: Tor mode for onion routing */
  torMode?: boolean;
  /** Optional: force refresh of cached data */
  forceRefresh?: boolean;
  /** Optional: pre-initialized ModelManager (skips bootstrap if provided) */
  modelManager?: ModelManager;
  /** Optional: set RoutstrClient debug level */
  debugLevel?: DebugLevel;
  /** Optional: client mode (xcashu or apikeys) */
  mode?: "xcashu" | "apikeys";
  /** Optional: explicit usage tracking driver */
  usageTrackingDriver?: UsageTrackingDriver;
  /** Optional: explicit SDK store (for using correct DB path) */
  sdkStore?: SdkStore;
  /** Optional: shared ProviderManager instance for consistent failure tracking */
  providerManager?: ProviderManager;
  /** Optional: injectable logger for structured/prefixed logging */
  logger?: SdkLogger;
}

/**
 * Result from routeRequests function
 */
export interface RouteRequestResult {
  /** The selected provider base URL */
  baseUrl: string;
  /** The selected model with pricing info */
  selectedModel: Model;
  /** Pricing info for the selected provider */
  pricing: {
    promptPerMillion: number;
    completionPerMillion: number;
    totalPerMillion: number;
  };
  /** The response from the provider */
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
}

async function resolveRouteRequestContext(options: RouteRequestOptions): Promise<{
  client: RoutstrClient;
  baseUrl: string;
  mintUrl: string;
  path: string;
  headers: Record<string, string>;
  modelId: string;
  proxiedBody: Record<string, unknown>;
}> {
  const {
    modelId,
    requestBody,
    path = "/v1/chat/completions",
    headers = {},
    forcedProvider,
    walletAdapter,
    storageAdapter,
    providerRegistry,
    discoveryAdapter,
    includeProviderUrls = [],
    torMode = false,
    forceRefresh = false,
    modelManager: providedModelManager,
    debugLevel,
    mode = "apikeys",
    usageTrackingDriver,
    sdkStore,
    providerManager: providedProviderManager,
    logger,
  } = options;

  let modelManager: ModelManager;
  let providers: string[];

  if (providedModelManager) {
    modelManager = providedModelManager;
    providers = modelManager.getBaseUrls();
    if (providers.length === 0) {
      throw new Error("No providers available - run bootstrap first");
    }
  } else {
    modelManager = new ModelManager(discoveryAdapter, {
      includeProviderUrls: forcedProvider
        ? [forcedProvider, ...includeProviderUrls]
        : includeProviderUrls,
      logger,
    });

    providers = await modelManager.bootstrapProviders(torMode);
    if (providers.length === 0) {
      throw new Error("No providers available");
    }

    await modelManager.fetchModels(providers, forceRefresh);
  }

  // Use provided ProviderManager or create a new one
  const providerManager = providedProviderManager ?? new ProviderManager(providerRegistry, sdkStore, logger);

  let baseUrl: string;
  let selectedModel: Model;

  if (forcedProvider) {
    const normalizedProvider = forcedProvider.endsWith("/")
      ? forcedProvider
      : `${forcedProvider}/`;
    const cachedModels = modelManager.getAllCachedModels();
    const models = cachedModels[normalizedProvider] || [];
    const match = models.find((m) => m.id === modelId);
    if (!match) {
      throw new Error(
        `Provider ${normalizedProvider} does not offer model: ${modelId}`
      );
    }
    baseUrl = normalizedProvider;
    selectedModel = match;
  } else {
    const ranking = providerManager.getProviderPriceRankingForModel(modelId, {
      torMode,
      includeDisabled: false,
    });
    if (ranking.length === 0) {
      throw new Error(`No providers found for model: ${modelId}`);
    }
    const cheapest = ranking[0];
    baseUrl = cheapest.baseUrl;
    selectedModel = cheapest.model;
  }

  const balances = await walletAdapter.getBalances();
  const totalBalance = Object.values(balances).reduce((sum, v) => sum + v, 0);

  if (totalBalance <= 0) {
    throw new Error(
      "Wallet balance is empty. Add a mint and fund it before making requests."
    );
  }

  const providerMints = providerRegistry.getProviderMints(baseUrl);
  const mintUrl =
    walletAdapter.getActiveMintUrl() ||
    providerMints[0] ||
    Object.keys(balances)[0];

  if (!mintUrl) {
    throw new Error("No mint configured in wallet");
  }

  const client = new RoutstrClient(
    walletAdapter,
    storageAdapter,
    providerRegistry,
    "min",
    mode,
    { usageTrackingDriver, sdkStore, providerManager, logger }
  );

  if (debugLevel) {
    client.setDebugLevel(debugLevel);
  }

  const maxTokens = extractMaxTokens(requestBody);
  const stream = extractStream(requestBody);

  const proxiedBody: Record<string, unknown> =
    requestBody && typeof requestBody === "object"
      ? { ...(requestBody as Record<string, unknown>) }
      : {};

  proxiedBody.model = selectedModel.id;

  if (stream !== undefined) {
    proxiedBody.stream = stream;
  }

  if (maxTokens !== undefined) {
    proxiedBody.max_tokens = maxTokens;
  }

  return {
    client,
    baseUrl,
    mintUrl,
    path,
    headers,
    modelId,
    proxiedBody,
  };
}

/**
 * Route an OpenAI-compatible request to the cheapest provider
 */
export async function routeRequests(
  options: RouteRequestOptions
): Promise<Response> {
  const { client, baseUrl, mintUrl, path, headers, modelId, proxiedBody } =
    await resolveRouteRequestContext(options);


  try {
    const response = await client.routeRequest({
      path,
      method: "POST",
      body: proxiedBody,
      headers,
      baseUrl,
      mintUrl,
      modelId,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("401") ||
        error.message.includes("402") ||
        error.message.includes("403"))
    ) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Extract message history from request body
 */
function extractMessageHistory(requestBody: unknown): Message[] {
  if (!requestBody || typeof requestBody !== "object") {
    return [];
  }

  const body = requestBody as Record<string, unknown>;
  const messages = body.messages;

  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.filter(
    (m): m is Message =>
      m &&
      typeof m === "object" &&
      "role" in m &&
      "content" in m &&
      typeof (m as any).role === "string"
  );
}

/**
 * Extract max_tokens from request body
 */
function extractMaxTokens(requestBody: unknown): number | undefined {
  if (!requestBody || typeof requestBody !== "object") {
    return undefined;
  }

  const body = requestBody as Record<string, unknown>;
  const maxTokens = body.max_tokens;

  return typeof maxTokens === "number" ? maxTokens : undefined;
}

/**
 * Extract stream flag from request body
 */
function extractStream(requestBody: unknown): boolean | undefined {
  if (!requestBody || typeof requestBody !== "object") {
    return undefined;
  }

  const body = requestBody as Record<string, unknown>;
  const stream = body.stream;

  return typeof stream === "boolean" ? stream : undefined;
}
