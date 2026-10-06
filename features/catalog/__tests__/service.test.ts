import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogService, type CatalogDeps } from "../service";

const PUBLIC = "https://public.example/";
const NODE = "https://node.example/";
const model = (id: string) => ({ id }) as never;

/** The SDK's discovery as the catalog uses it: a cache of models per provider. */
function setup(cache: Record<string, unknown[]> = {}) {
  let node: string | undefined;
  const discovery = {
    bases: [] as string[],
    stamped: null as number | null,
  };
  const modelManager = {
    // like the SDK: a fresh public list, stamped now
    bootstrapProviders: vi.fn(async () => {
      discovery.bases = [PUBLIC];
      discovery.stamped = Date.now();
      return [PUBLIC];
    }),
    // like the SDK: a pass keeps only the providers it was given
    fetchModels: vi.fn(
      async (
        bases: string[],
        _force: boolean,
        progress?: (m: unknown[]) => void
      ) => {
        for (const key of Object.keys(cache))
          if (!bases.includes(key)) delete cache[key];
        for (const base of bases) cache[base] ??= [model(`${base}m`)];
        const models = bases.flatMap((base) => cache[base]);
        progress?.(models);
        return models;
      }
    ),
    getBaseUrls: () => discovery.bases,
  };
  const deps = {
    discoveryAdapter: {
      getCachedModels: () => cache,
      getCachedMints: () => ({ [PUBLIC]: ["https://mint.example"] }),
      getBaseUrlsList: () => discovery.bases,
      setBaseUrlsList: (urls: string[]) => (discovery.bases = urls),
      setBaseUrlsLastUpdate: (at: number) => (discovery.stamped = at),
      getBaseUrlsLastUpdate: () => discovery.stamped,
    },
    modelManager,
    providerManager: {
      getBestProviderForModel: vi.fn(() => PUBLIC),
      getProviderPriceRankingForModel: vi.fn(() => []),
    },
    mintDiscovery: { discoverMints: vi.fn(async () => ({})) },
    ready: Promise.resolve(),
    node: () => node,
    torMode: () => false,
  } as unknown as CatalogDeps;
  return {
    catalog: new CatalogService(deps),
    modelManager,
    deps,
    cache,
    discovery,
    setNode: (url?: string) => (node = url),
  };
}

afterEach(() => vi.useRealTimers());

describe("CatalogService", () => {
  it("shows the models providers serve, then finds their mints", async () => {
    const { catalog, deps } = setup();

    await catalog.refresh();

    expect(catalog.getSnapshot()).toEqual({
      models: [model(`${PUBLIC}m`)],
      loading: false,
    });
    expect(deps.mintDiscovery.discoverMints).toHaveBeenCalledWith([PUBLIC]);
  });

  it("tells which mints a provider takes, with or without its closing slash", () => {
    const { catalog } = setup();
    expect(catalog.mintsOf(PUBLIC)).toEqual(["https://mint.example"]);
    expect(catalog.mintsOf(PUBLIC.slice(0, -1))).toEqual(["https://mint.example"]);
    expect(catalog.mintsOf("https://other.example/")).toEqual([]);
  });

  it("runs one pass at a time and skips a pass a newer one replaced", async () => {
    const { catalog, modelManager } = setup();
    let release!: () => void;
    modelManager.bootstrapProviders.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([PUBLIC])))
    );

    const first = catalog.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    void catalog.refresh();
    const third = catalog.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modelManager.bootstrapProviders).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, third]);
    expect(modelManager.bootstrapProviders).toHaveBeenCalledTimes(2);
  });

  it("makes the node the only provider while it pays", async () => {
    const { catalog, modelManager, setNode } = setup();
    setNode(NODE);

    await catalog.refresh();

    expect(modelManager.bootstrapProviders).not.toHaveBeenCalled();
    expect(modelManager.fetchModels).toHaveBeenCalledWith(
      [NODE],
      true,
      expect.any(Function)
    );
    expect(catalog.getSnapshot().models).toEqual([model(`${NODE}m`)]);
  });

  it("refetches after leaving node mode left the public lists pruned", async () => {
    const { catalog, modelManager, setNode } = setup();
    setNode(NODE);
    await catalog.refresh();

    setNode(undefined);
    await catalog.refresh();

    expect(modelManager.fetchModels).toHaveBeenLastCalledWith(
      [PUBLIC],
      true,
      expect.any(Function)
    );
    expect(catalog.getSnapshot().models).toEqual([model(`${PUBLIC}m`)]);
  });

  it("uses the fresh cache without refetching", async () => {
    const { catalog, modelManager } = setup({ [PUBLIC]: [model("cached")] });

    await catalog.refresh();

    expect(modelManager.fetchModels).toHaveBeenCalledWith(
      [PUBLIC],
      false,
      expect.any(Function)
    );
  });

  it("fetches for real once when every list came back empty", async () => {
    const { catalog, modelManager } = setup({ [PUBLIC]: [model("x")] });
    modelManager.fetchModels.mockImplementationOnce(async () => []);

    await catalog.refresh();

    expect(modelManager.fetchModels).toHaveBeenCalledTimes(2);
    expect(modelManager.fetchModels).toHaveBeenLastCalledWith(
      [PUBLIC],
      true,
      expect.any(Function)
    );
  });

  it("opens with the last visit's models that can still be routed", async () => {
    const { catalog, deps, modelManager } = setup({
      [PUBLIC]: [model("a"), model("b")],
    });
    vi.mocked(deps.providerManager.getBestProviderForModel).mockImplementation(
      (id: string) => (id === "a" ? PUBLIC : null) as never
    );
    modelManager.bootstrapProviders.mockImplementation(
      () => new Promise(() => {})
    );

    catalog.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(catalog.getSnapshot()).toEqual({
      models: [model("a")],
      loading: false,
    });
    catalog.dispose();
  });

  it("keeps the list it has when a pass fails", async () => {
    const { catalog, modelManager } = setup();
    await catalog.refresh();
    vi.spyOn(console, "error").mockImplementation(() => {});
    modelManager.bootstrapProviders.mockRejectedValueOnce(new Error("offline"));

    await catalog.refresh();

    expect(catalog.getSnapshot()).toEqual({
      models: [model(`${PUBLIC}m`)],
      loading: false,
    });
  });

  it("refreshes every half hour until disposed", async () => {
    vi.useFakeTimers();
    const { catalog, modelManager } = setup();
    catalog.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(modelManager.bootstrapProviders).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(modelManager.bootstrapProviders).toHaveBeenCalledTimes(2);

    catalog.dispose();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(modelManager.bootstrapProviders).toHaveBeenCalledTimes(2);
  });

  it("loads a node's models before routing to it, and says when it cannot", async () => {
    const { catalog, modelManager, cache } = setup();

    await catalog.ensureNode(NODE);
    expect(cache[NODE]).toHaveLength(1);

    modelManager.fetchModels.mockImplementationOnce(async () => []);
    delete cache[NODE];
    await expect(catalog.ensureNode(NODE)).rejects.toThrow("node's models");
  });

  it("makes the node the only provider, stamped so leaving refetches", async () => {
    const { catalog, discovery } = setup();
    discovery.bases = [PUBLIC];

    await catalog.ensureNode(NODE);

    expect(discovery.bases).toEqual([NODE]);
    expect(discovery.stamped).toBe(0);
  });

  it("never routes public requests over the list node mode left behind", async () => {
    const { catalog, setNode } = setup();
    setNode(NODE);
    await catalog.ensureNode(NODE);
    expect(catalog.warm()).toBeDefined();

    setNode(undefined);
    expect(catalog.warm()).toBeUndefined();

    await catalog.refresh();
    expect(catalog.warm()).toBeDefined();
  });

  it("never routes public requests over a cache node mode left, until a public pass refetched", async () => {
    const { catalog, modelManager, setNode } = setup();
    await catalog.refresh();
    setNode(NODE);
    await catalog.refresh();
    setNode(undefined);
    expect(catalog.warm()).toBeUndefined();

    let release!: () => void;
    const fetchModels = modelManager.fetchModels.getMockImplementation()!;
    modelManager.fetchModels.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return fetchModels(...args);
    });
    const refreshing = catalog.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(catalog.warm()).toBeUndefined();

    release();
    await refreshing;
    expect(catalog.warm()).toBeDefined();
  });

  it("lets the SDK route from the cache only once it holds models", async () => {
    const { catalog } = setup();
    expect(catalog.warm()).toBeUndefined();

    await catalog.refresh();

    expect(catalog.warm()).toMatchObject({ modelManager: expect.anything() });
  });
});
