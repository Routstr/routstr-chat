/**
 * ProviderManager - Handles provider selection and failover logic
 *
 * Handles:
 * - Finding the best provider for a model based on price
 * - Provider failover when errors occur
 * - Tracking failed providers to avoid retry loops
 * - Provider version compatibility
 *
 * Extracted from utils/apiUtils.ts findNextBestProvider and related logic
 */

import type { ProviderRegistry } from "../wallet/interfaces";
import type { Model, SdkLogger } from "../core/types";
import { consoleLogger } from "../core/types";
import type { SdkStore } from "../storage/store";
import { isOnionUrl, isTorContext } from "../utils/torUtils";

export interface ModelProviderPrice {
  baseUrl: string;
  model: Model;
  promptPerMillion: number;
  completionPerMillion: number;
  totalPerMillion: number;
}

/**
 * Extract image resolution (width, height) from a base64 data URL without DOM.
 * Supports PNG and JPEG. Returns null if format unsupported or parsing fails.
 */
function getImageResolutionFromDataUrl(
  dataUrl: string
): { width: number; height: number } | null {
  try {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:"))
      return null;

    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return null;

    const meta = dataUrl.slice(5, commaIdx); // e.g. "image/png;base64"
    const base64 = dataUrl.slice(commaIdx + 1);

    // Decode base64 to binary
    const binary =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary");

    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

    const isPNG = meta.includes("image/png");
    const isJPEG = meta.includes("image/jpeg") || meta.includes("image/jpg");

    // PNG: width/height are 4-byte big-endian at offsets 16 and 20
    if (isPNG) {
      // Validate PNG signature
      const sig = [137, 80, 78, 71, 13, 10, 26, 10];
      for (let i = 0; i < sig.length; i++) {
        if (bytes[i] !== sig[i]) return null;
      }
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
      );
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    // JPEG: parse markers to SOF0/SOF2 for dimensions
    if (isJPEG) {
      let offset = 0;
      // JPEG SOI 0xFFD8
      if (bytes[offset++] !== 0xff || bytes[offset++] !== 0xd8) return null;

      while (offset < bytes.length) {
        // Find marker
        while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
        if (offset + 1 >= bytes.length) break;

        // Skip fill bytes 0xFF
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];

        // Standalone markers without length
        if (marker === 0xd8 || marker === 0xd9) continue; // SOI/EOI

        if (offset + 1 >= bytes.length) break;
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;

        // SOF0 (0xC0) or SOF2 (0xC2) contain dimensions
        if (marker === 0xc0 || marker === 0xc2) {
          if (length < 7 || offset + length - 2 > bytes.length) return null;
          const precision = bytes[offset];
          const height = (bytes[offset + 1] << 8) | bytes[offset + 2];
          const width = (bytes[offset + 3] << 8) | bytes[offset + 4];
          if (precision > 0 && width > 0 && height > 0)
            return { width, height };
          return null;
        } else {
          // Skip this segment
          offset += length - 2;
        }
      }
      return null;
    }

    // Unsupported formats (e.g., webp/gif) - skip for now
    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate image tokens based on OpenAI's vision pricing.
 *
 * For low detail: 85 tokens
 * For high detail/auto: 85 base tokens + 170 tokens per 512px tile
 */
function calculateImageTokens(
  width: number,
  height: number,
  detail: "low" | "high" | "auto" = "auto"
): number {
  if (detail === "low") return 85;

  let w = width;
  let h = height;

  // Clamp longest side to 2048 while preserving aspect ratio
  if (w > 2048 || h > 2048) {
    const aspectRatio = w / h;
    if (w > h) {
      w = 2048;
      h = Math.floor(w / aspectRatio);
    } else {
      h = 2048;
      w = Math.floor(h * aspectRatio);
    }
  }

  // Then clamp longest side to 768 while preserving aspect ratio
  if (w > 768 || h > 768) {
    const aspectRatio = w / h;
    if (w > h) {
      w = 768;
      h = Math.floor(w / aspectRatio);
    } else {
      h = 768;
      w = Math.floor(h * aspectRatio);
    }
  }

  // Number of 512px tiles, ceil division using (x + 511) // 512
  const tilesWidth = Math.floor((w + 511) / 512);
  const tilesHeight = Math.floor((h + 511) / 512);
  const numTiles = tilesWidth * tilesHeight;

  return 85 + 170 * numTiles;
}

/**
 * Candidate provider for failover
 */
interface CandidateProvider {
  baseUrl: string;
  model: Model;
  cost: number;
}

/**
 * ProviderManager handles provider selection and failover
 */
function isInsecureHttpUrl(url: string): boolean {
  return url.startsWith("http://");
}

export class ProviderManager {
  private failedProviders = new Set<string>();
  /** Track when each provider last failed (provider URL -> timestamp) */
  private lastFailed = new Map<string, number>();
  /** Providers on cooldown: [provider_url, cooldown_started_timestamp][] */
  private providersOnCoolDown: [string, number][] = [];
  /** Cooldown duration in milliseconds (42 seconds) */
  private static readonly COOLDOWN_DURATION_MS = 42 * 1000;
  /** Optional persistent store for failure tracking */
  private store: SdkStore | null = null;
  /** Instance ID for debugging */
  private readonly instanceId: string;
  private readonly logger: SdkLogger;

  constructor(
    private providerRegistry: ProviderRegistry,
    store?: SdkStore,
    logger?: SdkLogger
  ) {
    this.instanceId = `pm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger = (logger ?? consoleLogger).child(`ProviderManager:${this.instanceId}`);
    if (store) {
      this.store = store;
      this.hydrateFromStore();
    }
  }

  /**
   * Hydrate in-memory state from persistent store
   */
  private hydrateFromStore(): void {
    if (!this.store) return;
    const state = this.store.getState();

    // Hydrate failedProviders
    this.failedProviders = new Set(state.failedProviders);

    // Hydrate lastFailed
    this.lastFailed = new Map(Object.entries(state.lastFailed));

    // Hydrate providersOnCooldown (filter out expired)
    const now = Date.now();
    this.providersOnCoolDown = state.providersOnCooldown
      .filter(
        (entry) => now - entry.timestamp < ProviderManager.COOLDOWN_DURATION_MS
      )
      .map((entry) => [entry.baseUrl, entry.timestamp] as [string, number]);

    this.logger.log(`Hydrated from store: failedProviders=${this.failedProviders.size} lastFailed=${this.lastFailed.size} providersOnCooldown=${this.providersOnCoolDown.length}`);
  }

  /**
   * Get instance ID for debugging
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Clean up expired cooldown entries
   * Also removes the provider from failedProviders so it can be retried
   */
  private cleanupExpiredCooldowns(): void {
    const now = Date.now();
    const before = this.providersOnCoolDown.length;
    this.providersOnCoolDown = this.providersOnCoolDown.filter(
      ([url, timestamp]) => {
        const age = now - timestamp;
        const isExpired = age >= ProviderManager.COOLDOWN_DURATION_MS;
        if (isExpired) {
          this.logger.log(`Removing expired cooldown for ${url} (age: ${age}ms)`);
          // Also remove from failedProviders so the provider can be retried
          this.failedProviders.delete(url);
          // Persist to store
          if (this.store) {
            this.store.getState().removeFailedProvider(url);
          }
        }
        return !isExpired;
      }
    );
    const after = this.providersOnCoolDown.length;
    if (before !== after) {
      this.logger.log(`Cleaned up ${before - after} expired cooldown(s), ${after} remaining`);
    }
  }

  /**
   * Get the cooldown duration in milliseconds
   */
  getCooldownDurationMs(): number {
    return ProviderManager.COOLDOWN_DURATION_MS;
  }

  /**
   * Check if a provider is currently on cooldown
   */
  isOnCooldown(baseUrl: string): boolean {
    this.cleanupExpiredCooldowns();

    const result = this.providersOnCoolDown.some(([url]) => url === baseUrl);
    return result;
  }

  /**
   * Get all providers currently on cooldown
   */
  getProvidersOnCooldown(): [string, number][] {
    this.cleanupExpiredCooldowns();
    return [...this.providersOnCoolDown];
  }

  /**
   * Reset the failed providers list
   */
  resetFailedProviders(): void {
    this.failedProviders.clear();
    // Persist to store
    if (this.store) {
      this.store.getState().setFailedProviders([]);
    }
  }

  /**
   * Get the last failed timestamp for a provider
   */
  getLastFailed(baseUrl: string): number | undefined {
    return this.lastFailed.get(baseUrl);
  }

  /**
   * Get all providers with their last failed timestamps
   */
  getAllLastFailed(): Map<string, number> {
    return new Map(this.lastFailed);
  }

  /**
   * Mark a provider as failed
   * If a provider fails twice within 5 minutes, it's added to cooldown
   */
  markFailed(baseUrl: string): void {
    const now = Date.now();
    const lastFailure = this.lastFailed.get(baseUrl);

    this.logger.log(`markFailed: ${baseUrl} lastFailure=${lastFailure} now=${now}`);

    if (lastFailure !== undefined) {
      const timeSinceLastFailure = now - lastFailure;
      this.logger.log(`markFailed: timeSinceLastFailure=${timeSinceLastFailure}ms withinCooldown=${timeSinceLastFailure < ProviderManager.COOLDOWN_DURATION_MS}`);
    }

    // Track this failure in memory
    this.lastFailed.set(baseUrl, now);
    this.failedProviders.add(baseUrl);

    // Persist to store
    if (this.store) {
      this.store.getState().setLastFailedTimestamp(baseUrl, now);
      this.store.getState().addFailedProvider(baseUrl);
    }

    this.logger.log(`markFailed: updated ${baseUrl} to ${now}, failedProviders=${this.failedProviders.size}`);

    // Check if this is a second failure within the cooldown window
    if (
      lastFailure !== undefined &&
      now - lastFailure < ProviderManager.COOLDOWN_DURATION_MS
    ) {
      // Second failure within 5 minutes - add to cooldown
      this.logger.log(`markFailed: second failure within cooldown window for ${baseUrl}`);
      if (!this.isOnCooldown(baseUrl)) {
        this.providersOnCoolDown.push([baseUrl, now]);
        // Persist to store
        if (this.store) {
          this.store.getState().addProviderOnCooldown(baseUrl, now);
        }
        this.logger.log(`markFailed: ${baseUrl} added to cooldown`);
      } else {
        this.logger.log(`markFailed: ${baseUrl} already on cooldown`);
      }
    } else {
      if (lastFailure === undefined) {
        this.logger.log(`markFailed: first failure for ${baseUrl}`);
      } else {
        this.logger.log(`markFailed: failure outside cooldown window for ${baseUrl} (${now - lastFailure}ms ago)`);
      }
    }
  }

  /**
   * Remove a provider from cooldown (e.g., after successful request)
   */
  removeFromCooldown(baseUrl: string): void {
    this.providersOnCoolDown = this.providersOnCoolDown.filter(
      ([url]) => url !== baseUrl
    );
    // Persist to store
    if (this.store) {
      this.store.getState().removeProviderFromCooldown(baseUrl);
    }
  }

  /**
   * Clear all cooldown tracking
   */
  clearCooldowns(): void {
    this.providersOnCoolDown = [];
    // Persist to store
    if (this.store) {
      this.store.getState().clearProvidersOnCooldown();
    }
  }

  /**
   * Clear all failure tracking (lastFailed timestamps)
   */
  clearFailureHistory(): void {
    this.lastFailed.clear();
    // Persist to store
    if (this.store) {
      this.store.getState().setLastFailed({});
    }
  }

  /**
   * Check if a provider has failed
   */
  hasFailed(baseUrl: string): boolean {
    return this.failedProviders.has(baseUrl);
  }

  /**
   * Get a copy of the failed providers set
   */
  getFailedProviders(): Set<string> {
    return new Set(this.failedProviders);
  }

  /**
   * Find the next best provider for a model
   * @param modelId The model ID to find a provider for
   * @param currentBaseUrl The current provider to exclude
   * @returns The best provider URL or null if none available
   */
  findNextBestProvider(modelId: string, currentBaseUrl: string): string | null {
    try {
      const torMode = isTorContext();
      const disabledProviders = new Set(
        this.providerRegistry.getDisabledProviders()
      );

      this.logger.log(`findNextBestProvider: model=${modelId} disabled=${[...disabledProviders].length} onCooldown=${this.providersOnCoolDown.length}`);

      // Get all providers with their models
      const allProviders = this.providerRegistry.getAllProvidersModels();
      this.logger.log(`findNextBestProvider: total providers=${Object.keys(allProviders).length}`);

      // Find all candidate providers
      const candidates: CandidateProvider[] = [];

      for (const [baseUrl, models] of Object.entries(allProviders)) {
        // Skip current, failed, disabled, and cooldown providers
        if (baseUrl === currentBaseUrl) {
          continue;
        }
        // if (this.failedProviders.has(baseUrl)) {
        //   console.log(`[findNextBestProvider:${this.instanceId}] SKIP (failed): ${baseUrl}`);
        //   skippedFailed++;
        //   continue;
        // }
        if (disabledProviders.has(baseUrl)) {
          continue;
        }
        if (this.isOnCooldown(baseUrl)) {
          continue;
        }

        // Skip onion URLs and insecure http URLs if not in Tor mode
        if (!torMode && (isOnionUrl(baseUrl) || isInsecureHttpUrl(baseUrl))) {
          continue;
        }

        // Find the model in this provider's list
        const model = models.find((m: Model) => m.id === modelId);
        if (!model) {
          continue;
        }

        // Calculate cost (using completion price as the metric)
        const cost = model.sats_pricing?.completion ?? 0;
        candidates.push({ baseUrl, model, cost });
      }

      // Sort by price (lowest first)
      candidates.sort((a, b) => a.cost - b.cost);

      if (candidates.length > 0) {
        return candidates[0].baseUrl;
      } else {
        return null;
      }
    } catch (error) {
      this.logger.error("findNextBestProvider error:", error);
      return null;
    }
  }

  /**
   * Find the best model for a provider
   * Useful when switching providers and need to find equivalent model
   */
  async getModelForProvider(
    baseUrl: string,
    modelId: string
  ): Promise<Model | null> {
    // Get models for this provider
    const models = this.providerRegistry.getModelsForProvider(baseUrl);

    // First try exact match
    const exactMatch = models.find((m) => m.id === modelId);
    if (exactMatch) return exactMatch;

    // Try matching by ID suffix (for backward compatibility with v0.1.x providers)
    const providerInfo = await this.providerRegistry.getProviderInfo(baseUrl);
    if (providerInfo?.version && /^0\.1\./.test(providerInfo.version)) {
      const suffix = modelId.split("/").pop();
      const suffixMatch = models.find((m) => m.id === suffix);
      if (suffixMatch) return suffixMatch;
    }

    return null;
  }

  /**
   * Get all available providers for a model
   * Returns sorted list by price
   */
  getAllProvidersForModel(modelId: string): Array<{
    baseUrl: string;
    model: Model;
    cost: number;
  }> {
    const candidates: CandidateProvider[] = [];
    const allProviders = this.providerRegistry.getAllProvidersModels();
    const disabledProviders = new Set(
      this.providerRegistry.getDisabledProviders()
    );
    const torMode = isTorContext();

    for (const [baseUrl, models] of Object.entries(allProviders)) {
      if (disabledProviders.has(baseUrl)) continue;
      if (this.isOnCooldown(baseUrl)) continue;
      if (!torMode && (isOnionUrl(baseUrl) || isInsecureHttpUrl(baseUrl)))
        continue;

      const model = models.find((m: Model) => m.id === modelId);
      if (!model) continue;

      const cost = model.sats_pricing?.completion ?? 0;
      candidates.push({ baseUrl, model, cost });
    }

    return candidates.sort((a, b) => a.cost - b.cost);
  }

  /**
   * Get providers for a model sorted by prompt+completion pricing
   */
  getProviderPriceRankingForModel(
    modelId: string,
    options: { torMode?: boolean; includeDisabled?: boolean } = {}
  ): ModelProviderPrice[] {
    const includeDisabled = options.includeDisabled ?? false;
    const torMode = options.torMode ?? false;
    const disabledProviders = new Set(
      this.providerRegistry.getDisabledProviders()
    );
    const allModels = this.providerRegistry.getAllProvidersModels();
    const results: ModelProviderPrice[] = [];

    for (const [baseUrl, models] of Object.entries(allModels)) {
      if (!includeDisabled && disabledProviders.has(baseUrl)) continue;
      if (this.isOnCooldown(baseUrl)) continue;
      if (torMode && !baseUrl.includes(".onion")) continue;
      if (
        !torMode &&
        (baseUrl.includes(".onion") || isInsecureHttpUrl(baseUrl))
      )
        continue;

      const match = models.find((model) => model.id === modelId);
      if (!match?.sats_pricing) continue;

      const prompt = match.sats_pricing.prompt;
      const completion = match.sats_pricing.completion;
      if (typeof prompt !== "number" || typeof completion !== "number") {
        continue;
      }

      const promptPerMillion = prompt * 1_000_000;
      const completionPerMillion = completion * 1_000_000;
      const totalPerMillion = promptPerMillion + completionPerMillion;

      results.push({
        baseUrl,
        model: match,
        promptPerMillion,
        completionPerMillion,
        totalPerMillion,
      });
    }

    return results.sort((a, b) => {
      if (a.totalPerMillion !== b.totalPerMillion) {
        return a.totalPerMillion - b.totalPerMillion;
      }
      return a.baseUrl.localeCompare(b.baseUrl);
    });
  }

  /**
   * Get best-priced provider for a specific model
   */
  getBestProviderForModel(
    modelId: string,
    options: { torMode?: boolean; includeDisabled?: boolean } = {}
  ): string | null {
    const ranking = this.getProviderPriceRankingForModel(modelId, options);
    return ranking[0]?.baseUrl ?? null;
  }

  private normalizeModelId(modelId: string): string {
    return modelId.includes("/")
      ? modelId.split("/").pop() || modelId
      : modelId;
  }

  /**
   * Check if a provider accepts a specific mint
   */
  providerAcceptsMint(baseUrl: string, mintUrl: string): boolean {
    const providerMints = this.providerRegistry.getProviderMints(baseUrl);
    if (providerMints.length === 0) {
      // If no mints specified, provider accepts all
      return true;
    }
    return providerMints.includes(mintUrl);
  }

  /**
   * Get required sats for a model based on message history
   * Simple estimation based on typical usage
   */
  getRequiredSatsForModel(
    model: Model,
    apiMessages: any[],
    maxTokens?: number
  ): number {
    try {
      let imageTokens = 0;
      if (apiMessages) {
        for (const msg of apiMessages as any[]) {
          const content = (msg as any)?.content;
          if (Array.isArray(content)) {
            for (const part of content) {
              const isImage =
                part && typeof part === "object" && part.type === "image_url";
              const url: string | undefined = isImage
                ? typeof part.image_url === "string"
                  ? part.image_url
                  : part.image_url?.url
                : undefined;

              // Expecting a base64 data URL for local image inputs
              if (url && typeof url === "string" && url.startsWith("data:")) {
                const res = getImageResolutionFromDataUrl(url);
                if (res) {
                  const tokensFromImage = calculateImageTokens(
                    res.width,
                    res.height
                  );
                  // const patchSize = 32;
                  // const patchesW = Math.floor((res.width + patchSize - 1) / patchSize);
                  // const patchesH = Math.floor((res.height + patchSize - 1) / patchSize);
                  // const tokensFromImage = patchesW * patchesH;
                  imageTokens += tokensFromImage;
                  this.logger.log(`IMAGE INPUT RESOLUTION width=${res.width} height=${res.height} tokens=${tokensFromImage}`);
                } else {
                  this.logger.log("IMAGE INPUT RESOLUTION: unknown format");
                }
              }
            }
          }
        }
      }
      // Remove image_url parts from apiMessages when estimating text token count
      const apiMessagesNoImages = apiMessages // SWITCH AFTER NODE UPDAATES
        ? (apiMessages as any[]).map((m: any) => {
            if (Array.isArray(m?.content)) {
              const filtered = m.content.filter(
                (p: any) =>
                  !(p && typeof p === "object" && p.type === "image_url")
              );
              return { ...m, content: filtered };
            }
            return m;
          })
        : undefined;

      const approximateTokens = apiMessagesNoImages // SWITCH AFTER NODE UPDAATES
        ? Math.ceil(JSON.stringify(apiMessagesNoImages, null, 2).length / 2.84)
        : 10000; // Assumed tokens for minimum balance calculation

      const totalInputTokens = approximateTokens + imageTokens;

      const sp: any = model?.sats_pricing as any;

      if (!sp) {
        return 0;
      }

      // If we don't have max_completion_cost, fall back to max_cost
      if (!sp.max_completion_cost) {
        return sp.max_cost ?? 50;
      }

      // Calculate based on token usage (similar to getTokenAmountForModel in apiUtils.ts)
      const promptCosts = (sp.prompt || 0) * totalInputTokens;
      let completionCost = sp.max_completion_cost;
      if (maxTokens !== undefined && sp.completion) {
        completionCost = sp.completion * maxTokens;
      }
      const totalEstimatedCosts = (promptCosts + completionCost) * 1.05;
      // return totalEstimatedCosts > sp.max_cost ? sp.max_cost : totalEstimatedCosts; // in some image input calculations, this cost balloons up. Now includes image tokens via 32px patches.
      return totalEstimatedCosts; // Backend has a bug here.it's calculating image tokens wrong. gotta switch to different logic once its fixed
    } catch (e) {
      this.logger.error("getRequiredSatsForModel error:", e);
      return 0;
    }
  }
}
