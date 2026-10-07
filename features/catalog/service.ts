import type {
  MintDiscovery,
  ModelManager,
  ProviderManager,
} from "@routstr/sdk";
import type { DiscoveryAdapter } from "@routstr/sdk/discovery";
import type { Model } from "@/types/models";
import type { Route, RouteChoice, WalletView } from "./ports";

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
  /** Calls `listener` when routing changes between passes: a provider
   *  cooling down after failures, or one turned on or off. */
  changes(listener: () => void): () => void;
  /** Where the providers you turned off are kept on this device. */
  settings: Pick<Storage, "getItem" | "setItem">;
  route: Route;
}

/** The providers you turned off, on this device (localStorage). */
export const PROVIDERS_OFF = "providers_off";

export interface CatalogSnapshot {
  models: Model[];
  /** No model list has been shown yet. */
  loading: boolean;
  /** Providers that are off: by you, or by Routstr's reviews. Never ranked,
   *  never paid. */
  off: string[];
  /** The ones you turned off. */
  turnedOff: string[];
}

const REFRESH_EVERY_MS = 30 * 60 * 1000;

/**
 * Which providers exist and which models they serve, for the whole tab. Each
 * pass rewrites the SDK's cache wholesale, so passes run one at a time and a
 * pass that a newer one replaced while it waited never runs.
 */
export class CatalogService {
  private snapshot: CatalogSnapshot = {
    models: [],
    loading: true,
    off: [],
    turnedOff: [],
  };
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private latest = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unwatch: (() => void) | undefined;

  constructor(private deps: CatalogDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CatalogSnapshot => this.snapshot;

  /** Shows what the last visit cached, then refreshes, then keeps it fresh. */
  start(): void {
    void this.deps.ready.then(() => {
      this.applyTurnedOff();
      this.seed();
    });
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_EVERY_MS);
    // the same models, ranked again
    this.unwatch = this.deps.changes(() =>
      this.set({ ...this.snapshot, models: [...this.snapshot.models] })
    );
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unwatch?.();
  }

  /** Turns a provider off on this device, or back on. On never overrides a
   *  Routstr review that keeps it off. Turned back on, it is asked for its
   *  models again. */
  setProviderOn(baseUrl: string, on: boolean): void {
    const url = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const off = this.turnedOff().filter((u) => u !== url);
    this.saveTurnedOff(on ? off : [...off, url], on ? [url] : []);
  }

  /** Every provider you turned off, on again. */
  allProvidersOn(): void {
    this.saveTurnedOff([], this.turnedOff());
  }

  /** Another tab changed the list: follow it. */
  reloadTurnedOff(): void {
    this.applyTurnedOff();
    void this.refresh();
  }

  private turnedOff(): string[] {
    try {
      const list: unknown = JSON.parse(
        this.deps.settings.getItem(PROVIDERS_OFF) ?? "[]"
      );
      return Array.isArray(list)
        ? list.filter((u) => typeof u === "string")
        : [];
    } catch {
      return [];
    }
  }

  private saveTurnedOff(urls: string[], backOn: string[]): void {
    try {
      this.deps.settings.setItem(PROVIDERS_OFF, JSON.stringify(urls));
    } catch (error) {
      // storage full: it holds in this tab until it closes
      console.warn("Could not keep the providers you turned off", error);
    }
    this.applyTurnedOff(urls);
    for (const url of backOn) {
      this.deps.discoveryAdapter.setProviderLastUpdate(url, 0);
    }
    void this.refresh();
  }

  // The SDK honors the list in ranking and payment. A provider trusted by
  // hand (a test stack's) is trusted no longer once you turn it off.
  private applyTurnedOff(urls = this.turnedOff()): void {
    const adapter = this.deps.discoveryAdapter;
    adapter.setManuallyDisabledProviders?.(urls);
    const trusted = adapter.getManuallyEnabledProviders();
    if (trusted.some((url) => urls.includes(url))) {
      adapter.setManuallyEnabledProviders?.(
        trusted.filter((url) => !urls.includes(url))
      );
    }
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

  /** Where a send of this model is paid, by the SDK's own rule: the cheapest
   *  provider that takes a mint holding sats, else the cheapest. Undefined
   *  while the list is not in, or when no provider serves it. */
  async goesTo(
    modelId: string,
    wallet: WalletView
  ): Promise<RouteChoice | undefined> {
    if (!this.warm()) return undefined;
    try {
      return await this.deps.route(modelId, wallet);
    } catch {
      return undefined;
    }
  }

  /** The providers discovery found, whatever their routing state. */
  knownProviders(): string[] {
    return this.deps.discoveryAdapter.getBaseUrlsList();
  }

  /** What a provider itself lists, whatever its routing state. */
  listing(baseUrl: string): Model[] {
    const cached =
      this.deps.discoveryAdapter.getCachedModels() as unknown as Record<
        string,
        Model[]
      >;
    return cached[baseUrl] ?? [];
  }

  /** A pin to a provider that dropped out is priced at its own listing. */
  listedAt(baseUrl: string, modelId: string): Model | undefined {
    return this.listing(baseUrl).find((model) => model.id === modelId);
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

  private set(snapshot: Omit<CatalogSnapshot, "off" | "turnedOff">): void {
    this.snapshot = {
      ...snapshot,
      off: this.deps.discoveryAdapter.getDisabledProviders(),
      turnedOff: this.turnedOff(),
    };
    this.listeners.forEach((listener) => listener());
  }
}
