import type {
  MintDiscovery,
  ModelManager,
  ProviderManager,
} from "@routstr/sdk";
import type { DiscoveryAdapter } from "@routstr/sdk/discovery";
import type { Model } from "@/types/models";

export interface CatalogDeps {
  discoveryAdapter: DiscoveryAdapter;
  modelManager: ModelManager;
  providerManager: ProviderManager;
  mintDiscovery: Pick<MintDiscovery, "discoverMints">;
  /** The discovery cache is loaded from disk. */
  ready: Promise<unknown>;
  /** A remote routstrd node that pays, if any: then it is the only provider. */
  node(): string | undefined;
  torMode(): boolean;
}

export interface CatalogSnapshot {
  models: Model[];
  /** No model list has been shown yet. */
  loading: boolean;
}

const REFRESH_EVERY_MS = 30 * 60 * 1000;

/**
 * Which providers exist and which models they serve, for the whole tab. Each
 * pass rewrites the SDK's cache wholesale, so passes run one at a time and a
 * pass that a newer one replaced while it waited never runs.
 */
export class CatalogService {
  private snapshot: CatalogSnapshot = { models: [], loading: true };
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private latest = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private deps: CatalogDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CatalogSnapshot => this.snapshot;

  /** Shows what the last visit cached, then refreshes, then keeps it fresh. */
  start(): void {
    void this.deps.ready.then(() => this.seed());
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_EVERY_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  /** Runs after every pass already queued; resolves when this one is done. */
  refresh(): Promise<void> {
    const pass = ++this.latest;
    this.chain = this.chain.then(() =>
      pass === this.latest ? this.load() : undefined
    );
    return this.chain;
  }

  /** The models Routstr recommends, best first. */
  picks(): string[] {
    return this.deps.discoveryAdapter.getRoutstr21Models();
  }

  /** The mints a provider takes, as the last discovery found them. */
  mintsOf(baseUrl: string): string[] {
    const all = this.deps.discoveryAdapter.getCachedMints();
    const bare = baseUrl.replace(/\/+$/, "");
    return all[baseUrl] ?? all[bare] ?? all[`${bare}/`] ?? [];
  }

  /** Providers that serve this model, cheapest first, as routing ranks them. */
  routes(modelId: string) {
    return this.deps.providerManager.getProviderPriceRankingForModel(modelId, {
      torMode: this.deps.torMode(),
    });
  }

  /** What a provider itself lists for a model, whatever its routing state:
   *  a pin to a provider that dropped out is priced at its own listing. */
  listedAt(baseUrl: string, modelId: string): Model | undefined {
    const cached =
      this.deps.discoveryAdapter.getCachedModels() as unknown as Record<
        string,
        Model[]
      >;
    return cached[baseUrl]?.find((model) => model.id === modelId);
  }

  /** The managers once their cache holds models: the SDK then routes from
   *  the cache instead of discovering on its own first. */
  warm() {
    const { modelManager, providerManager, discoveryAdapter } = this.deps;
    const cached = discoveryAdapter.getCachedModels();
    // Only a cache made for this mode: after node mode the cache holds only
    // the node's models until a public pass has refetched, and the list a node
    // request leaves is stamped 0. Routing a public send there would pay the node.
    const forThisMode =
      (this.deps.node() || discoveryAdapter.getBaseUrlsLastUpdate()) &&
      modelManager.getBaseUrls().some((base) => cached[base]?.length);
    return forThisMode ? { modelManager, providerManager } : undefined;
  }

  /** In node mode routing reads only the cache: the node's models must be in
   *  it, and the node must be a provider there, or the SDK discovers on its
   *  own and turns the unreviewed node off. */
  async ensureNode(url: string): Promise<void> {
    const { modelManager, discoveryAdapter } = this.deps;
    // The node is the only provider; stamped stale, so leaving node mode
    // discovers the public ones again
    if (!discoveryAdapter.getBaseUrlsList().includes(url)) {
      discoveryAdapter.setBaseUrlsList([url]);
      discoveryAdapter.setBaseUrlsLastUpdate(0);
    }
    if (discoveryAdapter.getCachedModels()[url]?.length) return;
    await modelManager.fetchModels([url], true);
    if (!discoveryAdapter.getCachedModels()[url]?.length) {
      throw new Error("Could not load the node's models.");
    }
  }

  // runs before the first pass can show anything: start() orders it so
  private seed(): void {
    const torMode = this.deps.torMode();
    const byId = new Map<string, Model>();
    for (const models of Object.values(
      this.deps.discoveryAdapter.getCachedModels()
    )) {
      for (const model of models as unknown as Model[]) {
        // a model nobody can serve right now would show as loaded but never route
        if (
          !byId.has(model.id) &&
          this.deps.providerManager.getBestProviderForModel(model.id, {
            torMode,
          })
        ) {
          byId.set(model.id, model);
        }
      }
    }
    if (byId.size) this.set({ models: [...byId.values()], loading: false });
  }

  private async load(): Promise<void> {
    const { modelManager, discoveryAdapter, mintDiscovery } = this.deps;
    await this.deps.ready;
    const node = this.deps.node();
    try {
      // The node replaces the provider set: fetchModels prunes every other one
      const bases = node
        ? [node]
        : await modelManager.bootstrapProviders(this.deps.torMode());
      if (!bases.length) return this.set({ models: [], loading: false });
      // a switch in or out of node mode left these lists pruned but fresh
      const cached = discoveryAdapter.getCachedModels();
      const stale = !bases.some((base) => cached[base]?.length);
      const show = (models: unknown[]) => {
        if (models.length)
          this.set({ models: models as Model[], loading: false });
      };
      let models = await modelManager.fetchModels(bases, stale, show);
      // Models were lost while their timestamps survived, so every pass would
      // serve the empty cache as fresh: fetch once for real
      if (!models.length)
        models = await modelManager.fetchModels(bases, true, show);
      this.set({ models: models as unknown as Model[], loading: false });
      await mintDiscovery.discoverMints(bases);
    } catch (error) {
      console.error("Could not load the model list", error);
      this.set({ ...this.snapshot, loading: false });
    }
  }

  private set(snapshot: CatalogSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
