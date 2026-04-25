/**
 * ModelManager class for discovering, fetching, and managing models from providers
 * Core responsibility: fetching models from providers, caching them, and selecting the best option
 * (lowest cost) across multiple providers
 */

import type { Model } from "../core/types";
import type { DiscoveryAdapter, ProviderInfo } from "./interfaces";
import {
  NoProvidersAvailableError,
  ProviderBootstrapError,
} from "../core/errors";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";
import { tap } from "rxjs";

/**
 * Configuration for ModelManager
 */
export interface ModelManagerConfig {
  /** URL to fetch provider directory from */
  providerDirectoryUrl?: string;
  /** Additional provider base URLs to include */
  includeProviderUrls?: string[];
  /** Provider base URLs to exclude */
  excludeProviderUrls?: string[];
  /** Cache TTL in milliseconds (default: 21 minutes) */
  cacheTTL?: number;
}

/**
 * ModelManager handles all model discovery and caching logic
 * Abstracts away storage details via DiscoveryAdapter
 */
export class ModelManager {
  private readonly cacheTTL: number;
  private readonly providerDirectoryUrl: string;
  private readonly includeProviderUrls: string[];
  private readonly excludeProviderUrls: string[];

  constructor(
    private adapter: DiscoveryAdapter,
    config: ModelManagerConfig = {}
  ) {
    this.providerDirectoryUrl =
      config.providerDirectoryUrl || "https://api.routstr.com/v1/providers/";
    this.cacheTTL = config.cacheTTL || 210 * 60 * 1000; // 21 minutes
    this.includeProviderUrls = config.includeProviderUrls || [];
    this.excludeProviderUrls = config.excludeProviderUrls || [];
  }

  /**
   * Get the list of bootstrapped provider base URLs
   * @returns Array of provider base URLs
   */
  getBaseUrls(): string[] {
    return this.adapter.getBaseUrlsList();
  }

  static async init(
    adapter: DiscoveryAdapter,
    config: ModelManagerConfig = {},
    options: { torMode?: boolean; forceRefresh?: boolean } = {}
  ): Promise<ModelManager> {
    const manager = new ModelManager(adapter, config);
    const torMode = options.torMode ?? false;
    const forceRefresh = options.forceRefresh ?? false;
    const providers = await manager.bootstrapProviders(torMode, forceRefresh);
    await manager.fetchModels(providers, forceRefresh);
    return manager;
  }

  /**
   * Bootstrap provider list from the provider directory
   * First tries to fetch from Nostr (kind 30421), falls back to HTTP
   * @param torMode Whether running in Tor context
   * @param forceRefresh Ignore provider cache and refresh provider sources
   * @returns Array of provider base URLs
   * @throws ProviderBootstrapError if all providers fail to fetch
   */
  async bootstrapProviders(
    torMode: boolean = false,
    forceRefresh: boolean = false
  ): Promise<string[]> {
    // First try cache
    if (!forceRefresh) {
      const cachedUrls = this.adapter.getBaseUrlsList();
      if (cachedUrls.length > 0) {
        const lastUpdate = this.adapter.getBaseUrlsLastUpdate();
        const cacheValid =
          lastUpdate && Date.now() - lastUpdate <= this.cacheTTL;
        if (cacheValid) {
          await this.fetchRoutstr21Models(forceRefresh);
          return this.filterBaseUrlsForTor(cachedUrls, torMode);
        }
      }
    }

    // Try Nostr first (kind 38421)
    try {
      const nostrProviders = await this.bootstrapFromNostr(38421, torMode);
      if (nostrProviders.length > 0) {
        const filtered = this.filterBaseUrlsForTor(nostrProviders, torMode);
        this.adapter.setBaseUrlsList(filtered);
        this.adapter.setBaseUrlsLastUpdate(Date.now());
        await this.fetchRoutstr21Models(forceRefresh);
        return filtered;
      }
    } catch (e) {
      console.warn("Nostr bootstrap failed, falling back to HTTP:", e);
    }

    // Fall back to HTTP
    return this.bootstrapFromHttp(torMode, forceRefresh);
  }

  /**
   * Bootstrap providers from Nostr network (kind 30421)
   * @param kind The Nostr kind to fetch
   * @param torMode Whether running in Tor context
   * @returns Array of provider base URLs
   */
  private async bootstrapFromNostr(
    kind: number,
    torMode: boolean
  ): Promise<string[]> {
    const DEFAULT_RELAYS = [
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://relay.damus.io",
    ];

    const pool = new RelayPool();
    const localEventStore = new EventStore();

    const timeoutMs = 5000;

    await new Promise<void>((resolve) => {
      pool
        .req(DEFAULT_RELAYS, {
          kinds: [kind],
          limit: 100,
        })
        .pipe(
          onlyEvents(),
          tap((event) => {
            localEventStore.add(event);
          })
        )
        .subscribe({
          complete: () => {
            resolve();
          },
        });

      setTimeout(() => {
        resolve();
      }, timeoutMs);
    });

    const timeline = localEventStore.getTimeline({ kinds: [kind] });

    const bases = new Set<string>();

    for (const event of timeline) {
      const eventUrls: string[] = [];

      for (const tag of event.tags) {
        if (tag[0] === "u" && typeof tag[1] === "string") {
          eventUrls.push(tag[1]);
        }
      }

      if (eventUrls.length > 0) {
        for (const url of eventUrls) {
          const normalized = this.normalizeUrl(url);
          if (!torMode || normalized.includes(".onion")) {
            bases.add(normalized);
          }
        }
        continue;
      }

      try {
        const content = JSON.parse(event.content);
        const providers = Array.isArray(content)
          ? content
          : content.providers || [];

        for (const p of providers) {
          const endpoints = this.getProviderEndpoints(p, torMode);
          for (const endpoint of endpoints) {
            bases.add(endpoint);
          }
        }
      } catch {
        try {
          const providers = JSON.parse(event.content);
          if (Array.isArray(providers)) {
            for (const p of providers) {
              const endpoints = this.getProviderEndpoints(p, torMode);
              for (const endpoint of endpoints) {
                bases.add(endpoint);
              }
            }
          }
        } catch {
          console.warn(
            "[NostrBootstrap] Failed to parse Nostr event content:",
            event.id
          );
        }
      }
    }

    // Add additional configured providers
    for (const url of this.includeProviderUrls) {
      const normalized = this.normalizeUrl(url);
      if (!torMode || normalized.includes(".onion")) {
        bases.add(normalized);
      }
    }

    const excluded = new Set(
      this.excludeProviderUrls.map((url) => this.normalizeUrl(url))
    );

    const result = Array.from(bases).filter((base) => !excluded.has(base));

    return result;
  }

  /**
   * Bootstrap providers from HTTP endpoint
   * @param torMode Whether running in Tor context
   * @param forceRefresh Ignore routstr21 cache and fetch fresh data
   * @returns Array of provider base URLs
   */
  private async bootstrapFromHttp(
    torMode: boolean,
    forceRefresh: boolean = false
  ): Promise<string[]> {
    try {
      const res = await fetch(this.providerDirectoryUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch providers: ${res.status}`);
      }

      const data = await res.json();
      const providers = Array.isArray(data?.providers) ? data.providers : [];

      const bases = new Set<string>();
      for (const p of providers) {
        const endpoints = this.getProviderEndpoints(p, torMode);
        for (const endpoint of endpoints) {
          bases.add(endpoint);
        }
      }

      for (const url of this.includeProviderUrls) {
        const normalized = this.normalizeUrl(url);
        if (!torMode || normalized.includes(".onion")) {
          bases.add(normalized);
        }
      }

      const excluded = new Set(
        this.excludeProviderUrls.map((url) => this.normalizeUrl(url))
      );

      const list = Array.from(bases).filter((base) => !excluded.has(base));

      if (list.length > 0) {
        this.adapter.setBaseUrlsList(list);
        this.adapter.setBaseUrlsLastUpdate(Date.now());
        await this.fetchRoutstr21Models(forceRefresh);
      }

      return list;
    } catch (e) {
      console.error("Failed to bootstrap providers", e);
      throw new ProviderBootstrapError([], `Provider bootstrap failed: ${e}`);
    }
  }

  /**
   * Fetch models from all providers and select best-priced options
   * Uses cache if available and not expired
   * @param baseUrls List of provider base URLs to fetch from
   * @param forceRefresh Ignore cache and fetch fresh data
   * @param onProgress Callback fired after each provider completes with current combined models
   * @returns Array of unique models with best prices selected
   */
  async fetchModels(
    baseUrls: string[],
    forceRefresh: boolean = false,
    onProgress?: (models: Model[]) => void
  ): Promise<Model[]> {
    if (baseUrls.length === 0) {
      throw new NoProvidersAvailableError();
    }

    const bestById = new Map<string, { model: Model; base: string }>();
    const modelsFromAllProviders: Record<string, Model[]> = {};
    const disabledProviders = this.adapter.getDisabledProviders();

    // Helper to estimate minimum cost for a model
    const estimateMinCost = (m: Model): number => {
      return m?.sats_pricing?.completion ?? 0;
    };

    // Helper to emit current progress
    const emitProgress = () => {
      if (onProgress) {
        const currentModels = Array.from(bestById.values()).map((v) => v.model);
        onProgress(currentModels);
      }
    };

    // Fetch from all providers in parallel with progressive updates
    const fetchPromises = baseUrls.map(async (url) => {
      const base = url.endsWith("/") ? url : `${url}/`;
      try {
        // Check cache if not forcing refresh
        let list: Model[];

        if (!forceRefresh) {
          const lastUpdate = this.adapter.getProviderLastUpdate(base);
          const cacheValid =
            lastUpdate && Date.now() - lastUpdate <= this.cacheTTL;

          if (cacheValid) {
            const cachedModels = this.adapter.getCachedModels();
            const cachedList = cachedModels[base] || [];
            list = cachedList;
          } else {
            // Cache expired or doesn't exist, fetch fresh
            list = await this.fetchModelsFromProvider(base);
          }
        } else {
          // Force refresh
          list = await this.fetchModelsFromProvider(base);
        }

        modelsFromAllProviders[base] = list;
        this.adapter.setProviderLastUpdate(base, Date.now());

        // Update best-priced models if provider not disabled
        if (!disabledProviders.includes(base)) {
          for (const m of list) {
            const existing = bestById.get(m.id);

            // Skip models without sats pricing
            if (!m.sats_pricing) continue;

            if (!existing) {
              bestById.set(m.id, { model: m, base });
              continue;
            }

            // Replace if this provider has lower cost
            const currentCost = estimateMinCost(m);
            const existingCost = estimateMinCost(existing.model);
            if (currentCost < existingCost && m.sats_pricing) {
              bestById.set(m.id, { model: m, base });
            }
          }
        }

        emitProgress();

        return { success: true, base, list };
      } catch (error) {
        if (this.isProviderDownError(error)) {
          console.warn(`Provider ${base} is down right now.`);
        } else {
          console.warn(`Failed to fetch models from ${base}:`, error);
        }
        this.adapter.setProviderLastUpdate(base, Date.now());
        return { success: false, base };
      }
    });

    await Promise.allSettled(fetchPromises);

    // Cache all provider results
    const existingCache = this.adapter.getCachedModels();
    this.adapter.setCachedModels({
      ...existingCache,
      ...modelsFromAllProviders,
    });

    // Return combined models array
    return Array.from(bestById.values()).map((v) => v.model);
  }

  /**
   * Fetch models from a single provider
   * @param baseUrl Provider base URL
   * @returns Array of models from provider
   */
  private async fetchModelsFromProvider(baseUrl: string): Promise<Model[]> {
    const res = await fetch(`${baseUrl}v1/models`);
    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status}`);
    }

    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];

    return list;
  }

  private isProviderDownError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    if (msg.includes("fetch failed")) return true;
    if (msg.includes("429")) return true;
    if (msg.includes("502")) return true;
    if (msg.includes("503")) return true;
    if (msg.includes("504")) return true;
    const cause = error.cause as { code?: string } | undefined;
    return cause?.code === "ENOTFOUND";
  }

  /**
   * Get all cached models from all providers
   * @returns Record mapping baseUrl -> models
   */
  getAllCachedModels(): Record<string, Model[]> {
    return this.adapter.getCachedModels();
  }

  /**
   * Clear cache for a specific provider
   * @param baseUrl Provider base URL
   */
  clearProviderCache(baseUrl: string): void {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const cached = this.adapter.getCachedModels();
    delete cached[base];
    this.adapter.setCachedModels(cached);
    this.adapter.setProviderLastUpdate(base, 0);
  }

  /**
   * Clear all model caches
   */
  clearAllCache(): void {
    this.adapter.setCachedModels({});
  }

  /**
   * Filter base URLs based on Tor context
   * @param baseUrls Provider URLs to filter
   * @param torMode Whether in Tor context
   * @returns Filtered URLs appropriate for Tor mode
   */
  filterBaseUrlsForTor(baseUrls: string[], torMode: boolean): string[] {
    if (!torMode) {
      // In normal mode, exclude onion URLs
      return baseUrls.filter((url) => !url.includes(".onion"));
    }
    // In Tor mode, only include onion URLs
    return baseUrls.filter((url) => url.includes(".onion"));
  }

  /**
   * Get provider endpoints from provider info
   * @param provider Provider object from directory
   * @param torMode Whether in Tor context
   * @returns Array of endpoint URLs
   */
  private getProviderEndpoints(provider: any, torMode: boolean): string[] {
    const endpoints: string[] = [];

    if (torMode && provider.onion_url) {
      endpoints.push(this.normalizeUrl(provider.onion_url));
    } else if (provider.endpoint_url) {
      endpoints.push(this.normalizeUrl(provider.endpoint_url));
    }

    return endpoints;
  }

  /**
   * Normalize provider URL with trailing slash
   * @param url URL to normalize
   * @returns Normalized URL
   */
  private normalizeUrl(url: string): string {
    if (!url.startsWith("http")) {
      url = `https://${url}`;
    }
    return url.endsWith("/") ? url : `${url}/`;
  }

  /**
   * Fetch routstr21 models from Nostr network (kind 38423)
   * Uses cache if available and not expired
   * @returns Array of model IDs or empty array if not found
   */
  async fetchRoutstr21Models(forceRefresh: boolean = false): Promise<string[]> {
    // Check cache first
    const cachedModels = this.adapter.getRoutstr21Models();
    if (!forceRefresh && cachedModels.length > 0) {
      const lastUpdate = this.adapter.getRoutstr21ModelsLastUpdate();
      const cacheValid = lastUpdate && Date.now() - lastUpdate <= this.cacheTTL;
      if (cacheValid) {
        return cachedModels;
      }
    }

    const DEFAULT_RELAYS = [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.routstr.com",
    ];

    const pool = new RelayPool();
    const localEventStore = new EventStore();

    const timeoutMs = 5000;

    await new Promise<void>((resolve) => {
      pool
        .req(DEFAULT_RELAYS, {
          kinds: [38423],
          "#d": ["routstr-21-models"],
          limit: 1,
          authors: [
            "4ad6fa2d16e2a9b576c863b4cf7404a70d4dc320c0c447d10ad6ff58993eacc8",
          ],
        })
        .pipe(
          onlyEvents(),
          tap((event) => {
            localEventStore.add(event);
          })
        )
        .subscribe({
          complete: () => {
            resolve();
          },
        });

      setTimeout(() => {
        resolve();
      }, timeoutMs);
    });

    const timeline = localEventStore.getTimeline({ kinds: [38423] });

    if (timeline.length === 0) {
      return cachedModels.length > 0 ? cachedModels : [];
    }

    const event = timeline[0];

    try {
      const content = JSON.parse(event.content);
      const models = Array.isArray(content?.models) ? content.models : [];
      this.adapter.setRoutstr21Models(models);
      this.adapter.setRoutstr21ModelsLastUpdate(Date.now());
      return models;
    } catch {
      console.warn(
        "[Routstr21Models] Failed to parse Nostr event content:",
        event.id
      );
      return cachedModels.length > 0 ? cachedModels : [];
    }
  }
}
