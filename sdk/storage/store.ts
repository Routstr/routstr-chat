import { createStore, type StoreApi } from "zustand/vanilla";
import type { DiscoveryAdapter } from "../discovery/interfaces";
import type { StorageAdapter, ProviderRegistry } from "../wallet/interfaces";
import type { ProviderInfo, Model } from "../core";
import { SDK_STORAGE_KEYS } from "./keys";
import type { StorageDriver, SdkStorageState } from "./types";

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

export interface SdkStoreOptions {
  driver: StorageDriver;
}

export interface SdkStorageStore extends SdkStorageState {
  setModelsFromAllProviders: (value: Record<string, Model[]>) => void;
  setLastUsedModel: (value: string | null) => void;
  setBaseUrlsList: (value: string[]) => void;
  setBaseUrlsLastUpdate: (value: number | null) => void;
  setDisabledProviders: (value: string[]) => void;
  setMintsFromAllProviders: (value: Record<string, string[]>) => void;
  setInfoFromAllProviders: (value: Record<string, ProviderInfo>) => void;
  setLastModelsUpdate: (value: Record<string, number>) => void;
  setApiKeys: (
    value:
      | Array<{
          baseUrl: string;
          key: string;
          balance?: number;
          lastUsed?: number | null;
        }>
      | ((current: SdkStorageStore["apiKeys"]) => SdkStorageStore["apiKeys"])
  ) => void;
  setChildKeys: (
    value: Array<{
      parentBaseUrl: string;
      childKey: string;
      balance?: number;
      balanceLimit?: number;
      validityDate?: number;
      createdAt?: number;
    }>
  ) => void;
  setXcashuTokens: (value: Record<string, Array<{
    baseUrl: string;
    token: string;
    createdAt?: number;
    tryCount?: number;
  }>>) => void;
  updateXcashuTokenTryCount: (token: string, tryCount: number) => void;
  setRoutstr21Models: (value: string[]) => void;
  setRoutstr21ModelsLastUpdate: (value: number | null) => void;
  setCachedReceiveTokens: (
    value: Array<{
      token: string;
      amount: number;
      unit: "sat" | "msat";
      createdAt?: number;
    }>
  ) => void;
  setClientIds: (
    value:
      | Array<{
          clientId: string;
          name: string;
          apiKey: string;
          createdAt?: number;
          lastUsed?: number | null;
        }>
      | ((current: SdkStorageStore["clientIds"]) => SdkStorageStore["clientIds"])
  ) => void;
  // ========== Failure Tracking ==========
  setFailedProviders: (value: string[]) => void;
  addFailedProvider: (baseUrl: string) => void;
  removeFailedProvider: (baseUrl: string) => void;
  setLastFailed: (value: Record<string, number>) => void;
  setLastFailedTimestamp: (baseUrl: string, timestamp: number) => void;
  setProvidersOnCooldown: (value: Array<{ baseUrl: string; timestamp: number }>) => void;
  addProviderOnCooldown: (baseUrl: string, timestamp: number) => void;
  removeProviderFromCooldown: (baseUrl: string) => void;
  clearProvidersOnCooldown: () => void;
}

/** Store type returned after async initialization */
export type SdkStore = StoreApi<SdkStorageStore>;

const createEmptyStore = (driver: StorageDriver): SdkStore =>
  createStore<SdkStorageStore>((set, get) => ({
    modelsFromAllProviders: {},
    lastUsedModel: null,
    baseUrlsList: [],
    lastBaseUrlsUpdate: null,
    disabledProviders: [],
    mintsFromAllProviders: {},
    infoFromAllProviders: {},
    lastModelsUpdate: {},
    apiKeys: [],
    childKeys: [],
    xcashuTokens: {},
    routstr21Models: [],
    lastRoutstr21ModelsUpdate: null,
    cachedReceiveTokens: [],
    clientIds: [],
    failedProviders: [],
    lastFailed: {},
    providersOnCooldown: [],
    setModelsFromAllProviders: (value) => {
      const normalized: Record<string, Model[]> = {};
      for (const [baseUrl, models] of Object.entries(value)) {
        normalized[normalizeBaseUrl(baseUrl)] = models;
      }
      void driver.setItem(
        SDK_STORAGE_KEYS.MODELS_FROM_ALL_PROVIDERS,
        normalized
      );
      set({ modelsFromAllProviders: normalized });
    },
    setLastUsedModel: (value) => {
      void driver.setItem(SDK_STORAGE_KEYS.LAST_USED_MODEL, value);
      set({ lastUsedModel: value });
    },
    setBaseUrlsList: (value) => {
      const normalized = value.map((url) => normalizeBaseUrl(url));
      void driver.setItem(SDK_STORAGE_KEYS.BASE_URLS_LIST, normalized);
      set({ baseUrlsList: normalized });
    },
    setBaseUrlsLastUpdate: (value) => {
      void driver.setItem(SDK_STORAGE_KEYS.LAST_BASE_URLS_UPDATE, value);
      set({ lastBaseUrlsUpdate: value });
    },
    setDisabledProviders: (value) => {
      const normalized = value.map((url) => normalizeBaseUrl(url));
      void driver.setItem(SDK_STORAGE_KEYS.DISABLED_PROVIDERS, normalized);
      set({ disabledProviders: normalized });
    },
    setMintsFromAllProviders: (value) => {
      const normalized: Record<string, string[]> = {};
      for (const [baseUrl, mints] of Object.entries(value)) {
        normalized[normalizeBaseUrl(baseUrl)] = mints.map((mint) =>
          mint.endsWith("/") ? mint.slice(0, -1) : mint
        );
      }
      void driver.setItem(
        SDK_STORAGE_KEYS.MINTS_FROM_ALL_PROVIDERS,
        normalized
      );
      set({ mintsFromAllProviders: normalized });
    },
    setInfoFromAllProviders: (value) => {
      const normalized: Record<string, ProviderInfo> = {};
      for (const [baseUrl, info] of Object.entries(value)) {
        normalized[normalizeBaseUrl(baseUrl)] = info;
      }
      void driver.setItem(SDK_STORAGE_KEYS.INFO_FROM_ALL_PROVIDERS, normalized);
      set({ infoFromAllProviders: normalized });
    },
    setLastModelsUpdate: (value) => {
      const normalized: Record<string, number> = {};
      for (const [baseUrl, timestamp] of Object.entries(value)) {
        normalized[normalizeBaseUrl(baseUrl)] = timestamp;
      }
      void driver.setItem(SDK_STORAGE_KEYS.LAST_MODELS_UPDATE, normalized);
      set({ lastModelsUpdate: normalized });
    },
    setApiKeys: (value) => {
      set((state) => {
        const updates =
          typeof value === "function" ? value(state.apiKeys) : value;
        const normalized = updates.map((entry) => ({
          ...entry,
          baseUrl: normalizeBaseUrl(entry.baseUrl),
          balance: entry.balance ?? 0,
          lastUsed: entry.lastUsed ?? null,
        }));
        void driver.setItem(SDK_STORAGE_KEYS.API_KEYS, normalized);
        return { apiKeys: normalized };
      });
    },
    setChildKeys: (
      value:
        | Array<{
            parentBaseUrl: string;
            childKey: string;
            balance?: number;
            balanceLimit?: number;
            validityDate?: number;
            createdAt?: number;
          }>
        | ((
            current: SdkStorageStore["childKeys"]
          ) => SdkStorageStore["childKeys"])
    ) => {
      set((state) => {
        const updates =
          typeof value === "function" ? value(state.childKeys) : value;
        const normalized = updates.map((entry) => ({
          parentBaseUrl: normalizeBaseUrl(entry.parentBaseUrl),
          childKey: entry.childKey,
          balance: entry.balance ?? 0,
          balanceLimit: entry.balanceLimit,
          validityDate: entry.validityDate,
          createdAt: entry.createdAt ?? Date.now(),
        }));
        void driver.setItem(SDK_STORAGE_KEYS.CHILD_KEYS, normalized);
        return { childKeys: normalized };
      });
    },
    setXcashuTokens: (value) => {
      const normalized: Record<string, Array<{
        baseUrl: string;
        token: string;
        createdAt: number;
        tryCount: number;
      }>> = {};
      for (const [baseUrl, tokens] of Object.entries(value)) {
        normalized[normalizeBaseUrl(baseUrl)] = tokens.map((entry) => ({
          ...entry,
          baseUrl: normalizeBaseUrl(entry.baseUrl),
          createdAt: entry.createdAt ?? Date.now(),
          tryCount: entry.tryCount ?? 0,
        }));
      }
      void driver.setItem(SDK_STORAGE_KEYS.XCASHU_TOKENS, normalized);
      set({ xcashuTokens: normalized });
    },
    updateXcashuTokenTryCount: (token, tryCount) => {
      const currentTokens = get().xcashuTokens;
      const updatedTokens: Record<string, Array<{
        baseUrl: string;
        token: string;
        createdAt: number;
        tryCount: number;
      }>> = {};
      
      for (const [baseUrl, tokens] of Object.entries(currentTokens)) {
        updatedTokens[baseUrl] = tokens.map((entry) =>
          entry.token === token ? { ...entry, tryCount } : entry
        );
      }
      
      void driver.setItem(SDK_STORAGE_KEYS.XCASHU_TOKENS, updatedTokens);
      set({ xcashuTokens: updatedTokens });
    },
    setRoutstr21Models: (value) => {
      void driver.setItem(SDK_STORAGE_KEYS.ROUTSTR21_MODELS, value);
      set({ routstr21Models: value });
    },
    setRoutstr21ModelsLastUpdate: (value) => {
      void driver.setItem(SDK_STORAGE_KEYS.LAST_ROUTSTR21_MODELS_UPDATE, value);
      set({ lastRoutstr21ModelsUpdate: value });
    },
    setCachedReceiveTokens: (value) => {
      const normalized = value.map((entry) => ({
        token: entry.token,
        amount: entry.amount,
        unit: entry.unit || "sat",
        createdAt: entry.createdAt ?? Date.now(),
      }));
      void driver.setItem(SDK_STORAGE_KEYS.CACHED_RECEIVE_TOKENS, normalized);
      set({ cachedReceiveTokens: normalized });
    },
    setClientIds: (value) => {
      set((state) => {
        const updates =
          typeof value === "function" ? value(state.clientIds) : value;
        const normalized = updates.map((entry) => ({
          ...entry,
          createdAt: entry.createdAt ?? Date.now(),
          lastUsed: entry.lastUsed ?? null,
        }));
        void driver.setItem(SDK_STORAGE_KEYS.CLIENT_IDS, normalized);
        return { clientIds: normalized };
      });
    },
    // ========== Failure Tracking ==========
    setFailedProviders: (value) => {
      const normalized = value.map((url) => normalizeBaseUrl(url));
      void driver.setItem(SDK_STORAGE_KEYS.FAILED_PROVIDERS, normalized);
      set({ failedProviders: normalized });
    },
    addFailedProvider: (baseUrl) => {
      const normalized = normalizeBaseUrl(baseUrl);
      const current = get().failedProviders;
      if (!current.includes(normalized)) {
        const updated = [...current, normalized];
        void driver.setItem(SDK_STORAGE_KEYS.FAILED_PROVIDERS, updated);
        set({ failedProviders: updated });
      }
    },
    removeFailedProvider: (baseUrl) => {
      const normalized = normalizeBaseUrl(baseUrl);
      const current = get().failedProviders;
      const updated = current.filter((url) => url !== normalized);
      void driver.setItem(SDK_STORAGE_KEYS.FAILED_PROVIDERS, updated);
      set({ failedProviders: updated });
    },
    setLastFailed: (value) => {
      const normalized: Record<string, number> = {};
      for (const [baseUrl, timestamp] of Object.entries(value)) {
        normalized[normalizeBaseUrl(baseUrl)] = timestamp;
      }
      void driver.setItem(SDK_STORAGE_KEYS.LAST_FAILED, normalized);
      set({ lastFailed: normalized });
    },
    setLastFailedTimestamp: (baseUrl, timestamp) => {
      const normalized = normalizeBaseUrl(baseUrl);
      const current = get().lastFailed;
      const updated = { ...current, [normalized]: timestamp };
      void driver.setItem(SDK_STORAGE_KEYS.LAST_FAILED, updated);
      set({ lastFailed: updated });
    },
    setProvidersOnCooldown: (value) => {
      const normalized = value.map((entry) => ({
        baseUrl: normalizeBaseUrl(entry.baseUrl),
        timestamp: entry.timestamp,
      }));
      void driver.setItem(SDK_STORAGE_KEYS.PROVIDERS_ON_COOLDOWN, normalized);
      set({ providersOnCooldown: normalized });
    },
    addProviderOnCooldown: (baseUrl, timestamp) => {
      const normalized = normalizeBaseUrl(baseUrl);
      const current = get().providersOnCooldown;
      if (!current.some((entry) => entry.baseUrl === normalized)) {
        const updated = [...current, { baseUrl: normalized, timestamp }];
        void driver.setItem(SDK_STORAGE_KEYS.PROVIDERS_ON_COOLDOWN, updated);
        set({ providersOnCooldown: updated });
      }
    },
    removeProviderFromCooldown: (baseUrl) => {
      const normalized = normalizeBaseUrl(baseUrl);
      const current = get().providersOnCooldown;
      const updated = current.filter((entry) => entry.baseUrl !== normalized);
      void driver.setItem(SDK_STORAGE_KEYS.PROVIDERS_ON_COOLDOWN, updated);
      set({ providersOnCooldown: updated });
    },
    clearProvidersOnCooldown: () => {
      void driver.setItem(SDK_STORAGE_KEYS.PROVIDERS_ON_COOLDOWN, []);
      set({ providersOnCooldown: [] });
    },
  }));

const hydrateStoreFromDriver = async (
  store: SdkStore,
  driver: StorageDriver
): Promise<void> => {
  const [
    rawModels,
    lastUsedModel,
    rawBaseUrls,
    lastBaseUrlsUpdate,
    rawDisabledProviders,
    rawMints,
    rawInfo,
    rawLastModelsUpdate,
    rawApiKeys,
    rawChildKeys,
    rawXcashuTokens,
    rawRoutstr21Models,
    rawLastRoutstr21ModelsUpdate,
    rawCachedReceiveTokens,
    rawClientIds,
    rawFailedProviders,
    rawLastFailed,
    rawProvidersOnCooldown,
  ] = await Promise.all([
    driver.getItem<Record<string, Model[]>>(
      SDK_STORAGE_KEYS.MODELS_FROM_ALL_PROVIDERS,
      {}
    ),
    driver.getItem<string | null>(SDK_STORAGE_KEYS.LAST_USED_MODEL, null),
    driver.getItem<string[]>(SDK_STORAGE_KEYS.BASE_URLS_LIST, []),
    driver.getItem<number | null>(SDK_STORAGE_KEYS.LAST_BASE_URLS_UPDATE, null),
    driver.getItem<string[]>(SDK_STORAGE_KEYS.DISABLED_PROVIDERS, []),
    driver.getItem<Record<string, string[]>>(
      SDK_STORAGE_KEYS.MINTS_FROM_ALL_PROVIDERS,
      {}
    ),
    driver.getItem<Record<string, ProviderInfo>>(
      SDK_STORAGE_KEYS.INFO_FROM_ALL_PROVIDERS,
      {}
    ),
    driver.getItem<Record<string, number>>(
      SDK_STORAGE_KEYS.LAST_MODELS_UPDATE,
      {}
    ),
    driver.getItem<
      Array<{
        baseUrl: string;
        key: string;
        balance?: number;
        lastUsed?: number | null;
      }>
    >(SDK_STORAGE_KEYS.API_KEYS, []),
    driver.getItem<
      Array<{
        parentBaseUrl: string;
        childKey: string;
        balance?: number;
        balanceLimit?: number;
        validityDate?: number;
        createdAt?: number;
      }>
    >(SDK_STORAGE_KEYS.CHILD_KEYS, []),
    driver.getItem<
      Record<string, Array<{
        baseUrl: string;
        token: string;
        createdAt?: number;
        tryCount?: number;
      }>>
    >(SDK_STORAGE_KEYS.XCASHU_TOKENS, {}),
    driver.getItem<string[]>(SDK_STORAGE_KEYS.ROUTSTR21_MODELS, []),
    driver.getItem<number | null>(
      SDK_STORAGE_KEYS.LAST_ROUTSTR21_MODELS_UPDATE,
      null
    ),
    driver.getItem<
      Array<{
        token: string;
        amount: number;
        unit: "sat" | "msat";
        createdAt?: number;
      }>
    >(SDK_STORAGE_KEYS.CACHED_RECEIVE_TOKENS, []),
    driver.getItem<
      Array<{
        clientId: string;
        name: string;
        apiKey: string;
        createdAt?: number;
        lastUsed?: number | null;
      }>
    >(SDK_STORAGE_KEYS.CLIENT_IDS, []),
    driver.getItem<string[]>(SDK_STORAGE_KEYS.FAILED_PROVIDERS, []),
    driver.getItem<Record<string, number>>(SDK_STORAGE_KEYS.LAST_FAILED, {}),
    driver.getItem<
      Array<{ baseUrl: string; timestamp: number }>
    >(SDK_STORAGE_KEYS.PROVIDERS_ON_COOLDOWN, []),
  ]);

  const modelsFromAllProviders = Object.fromEntries(
    Object.entries(rawModels).map(([baseUrl, models]) => [
      normalizeBaseUrl(baseUrl),
      models,
    ])
  );

  const baseUrlsList = rawBaseUrls.map((url) => normalizeBaseUrl(url));

  const disabledProviders = rawDisabledProviders.map((url) =>
    normalizeBaseUrl(url)
  );

  const mintsFromAllProviders = Object.fromEntries(
    Object.entries(rawMints).map(([baseUrl, mints]) => [
      normalizeBaseUrl(baseUrl),
      mints.map((mint) => (mint.endsWith("/") ? mint.slice(0, -1) : mint)),
    ])
  );

  const infoFromAllProviders = Object.fromEntries(
    Object.entries(rawInfo).map(([baseUrl, info]) => [
      normalizeBaseUrl(baseUrl),
      info,
    ])
  );

  const lastModelsUpdate = Object.fromEntries(
    Object.entries(rawLastModelsUpdate).map(([baseUrl, timestamp]) => [
      normalizeBaseUrl(baseUrl),
      timestamp,
    ])
  );

  const apiKeys = rawApiKeys.map((entry) => ({
    ...entry,
    baseUrl: normalizeBaseUrl(entry.baseUrl),
    balance: entry.balance ?? 0,
    lastUsed: entry.lastUsed ?? null,
  }));

  const childKeys = rawChildKeys.map((entry) => ({
    parentBaseUrl: normalizeBaseUrl(entry.parentBaseUrl),
    childKey: entry.childKey,
    balance: entry.balance ?? 0,
    balanceLimit: entry.balanceLimit,
    validityDate: entry.validityDate,
    createdAt: entry.createdAt ?? Date.now(),
  }));

  const xcashuTokens = Object.fromEntries(
    Object.entries(rawXcashuTokens).map(([baseUrl, tokens]) => [
      normalizeBaseUrl(baseUrl),
      tokens.map((entry) => ({
        baseUrl: normalizeBaseUrl(entry.baseUrl),
        token: entry.token,
        createdAt: entry.createdAt ?? Date.now(),
        tryCount: entry.tryCount ?? 0,
      })),
    ])
  );

  const routstr21Models = rawRoutstr21Models;
  const lastRoutstr21ModelsUpdate = rawLastRoutstr21ModelsUpdate;

  const cachedReceiveTokens = rawCachedReceiveTokens?.map((entry) => ({
    token: entry.token,
    amount: entry.amount,
    unit: entry.unit || "sat",
    createdAt: entry.createdAt ?? Date.now(),
  }));

  const clientIds = rawClientIds.map((entry) => ({
    ...entry,
    createdAt: entry.createdAt ?? Date.now(),
    lastUsed: entry.lastUsed ?? null,
  }));

  const failedProviders = rawFailedProviders.map((url) => normalizeBaseUrl(url));
  const lastFailed = Object.fromEntries(
    Object.entries(rawLastFailed).map(([baseUrl, timestamp]) => [
      normalizeBaseUrl(baseUrl),
      timestamp,
    ])
  );
  const providersOnCooldown = rawProvidersOnCooldown.map((entry) => ({
    baseUrl: normalizeBaseUrl(entry.baseUrl),
    timestamp: entry.timestamp,
  }));

  store.setState({
    modelsFromAllProviders,
    lastUsedModel,
    baseUrlsList,
    lastBaseUrlsUpdate,
    disabledProviders,
    mintsFromAllProviders,
    infoFromAllProviders,
    lastModelsUpdate,
    apiKeys,
    childKeys,
    xcashuTokens,
    routstr21Models,
    lastRoutstr21ModelsUpdate,
    cachedReceiveTokens,
    clientIds,
    failedProviders,
    lastFailed,
    providersOnCooldown,
  });
};

export const createSdkStore = ({
  driver,
}: SdkStoreOptions): { store: SdkStore; hydrate: Promise<void> } => {
  const store = createEmptyStore(driver);
  return {
    store,
    hydrate: hydrateStoreFromDriver(store, driver),
  };
};

export const createDiscoveryAdapterFromStore = (
  store: SdkStore
): DiscoveryAdapter => ({
  getCachedModels: () => store.getState().modelsFromAllProviders,
  setCachedModels: (models) =>
    store.getState().setModelsFromAllProviders(models),
  getCachedMints: () => store.getState().mintsFromAllProviders,
  setCachedMints: (mints) => store.getState().setMintsFromAllProviders(mints),
  getCachedProviderInfo: () => store.getState().infoFromAllProviders,
  setCachedProviderInfo: (info) =>
    store.getState().setInfoFromAllProviders(info),
  getProviderLastUpdate: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const timestamps = store.getState().lastModelsUpdate;
    return timestamps[normalized] || null;
  },
  setProviderLastUpdate: (baseUrl, timestamp) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const timestamps = { ...store.getState().lastModelsUpdate };
    timestamps[normalized] = timestamp;
    store.getState().setLastModelsUpdate(timestamps);
  },
  getLastUsedModel: () => store.getState().lastUsedModel,
  setLastUsedModel: (modelId) => store.getState().setLastUsedModel(modelId),
  getDisabledProviders: () => store.getState().disabledProviders,
  getBaseUrlsList: () => store.getState().baseUrlsList,
  setBaseUrlsList: (urls) => store.getState().setBaseUrlsList(urls),
  getBaseUrlsLastUpdate: () => store.getState().lastBaseUrlsUpdate,
  setBaseUrlsLastUpdate: (timestamp) =>
    store.getState().setBaseUrlsLastUpdate(timestamp),
  getRoutstr21Models: () => store.getState().routstr21Models,
  setRoutstr21Models: (models) => store.getState().setRoutstr21Models(models),
  getRoutstr21ModelsLastUpdate: () =>
    store.getState().lastRoutstr21ModelsUpdate,
  setRoutstr21ModelsLastUpdate: (timestamp) =>
    store.getState().setRoutstr21ModelsLastUpdate(timestamp),
});

export const createStorageAdapterFromStore = (
  store: SdkStore
): StorageAdapter => ({
  getApiKeyDistribution: () => {
    const apiKeys = store.getState().apiKeys;
    const distributionMap: Record<string, number> = {};

    for (const entry of apiKeys) {
      const sum = entry.balance || 0;
      distributionMap[entry.baseUrl] =
        (distributionMap[entry.baseUrl] || 0) + sum;
    }

    return Object.entries(distributionMap)
      .map(([baseUrl, amt]) => ({ baseUrl, amount: amt }))
      .sort((a, b) => b.amount - a.amount);
  },
  saveProviderInfo: (baseUrl, info) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const next = { ...store.getState().infoFromAllProviders };
    next[normalized] = info;
    store.getState().setInfoFromAllProviders(next);
  },
  getProviderInfo: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    return store.getState().infoFromAllProviders[normalized] || null;
  },

  // ========== API Keys (for apikeys mode) ==========

  getApiKey: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const entry = store
      .getState()
      .apiKeys.find((key) => key.baseUrl === normalized);
    if (!entry) return null;
   return entry;
  },

  setApiKey: (baseUrl, key) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const keys = store.getState().apiKeys;
    const existingIndex = keys.findIndex(
      (entry) => entry.baseUrl === normalized
    );
    if (existingIndex !== -1) {
      throw new Error(`ApiKey already exists for baseUrl: ${normalized}`);
    }
    const next = [...keys];
    next.push({
      baseUrl: normalized,
      key,
      balance: 0,
      lastUsed: Date.now(),
    });
    store.getState().setApiKeys(next);
  },

  updateApiKeyBalance: (baseUrl, balance) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const keys = store.getState().apiKeys;
    const next = keys.map((entry) =>
      entry.baseUrl === normalized
        ? { ...entry, balance, lastUsed: Date.now() }
        : entry
    );
    store.getState().setApiKeys(next);
  },

  removeApiKey: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const next = store
      .getState()
      .apiKeys.filter((entry) => entry.baseUrl !== normalized);
    store.getState().setApiKeys(next);
  },

  getAllApiKeys: () => {
    return store.getState().apiKeys.map((entry) => ({
      baseUrl: entry.baseUrl,
      key: entry.key,
      balance: entry.balance,
      lastUsed: entry.lastUsed,
    }));
  },

  // ========== Child Keys ==========

  getChildKey: (parentBaseUrl) => {
    const normalized = normalizeBaseUrl(parentBaseUrl);
    const entry = store
      .getState()
      .childKeys.find((key) => key.parentBaseUrl === normalized);
    if (!entry) return null;
    return {
      parentBaseUrl: entry.parentBaseUrl,
      childKey: entry.childKey,
      balance: entry.balance,
      balanceLimit: entry.balanceLimit,
      validityDate: entry.validityDate,
      createdAt: entry.createdAt,
    };
  },

  setChildKey: (
    parentBaseUrl,
    childKey,
    balance,
    validityDate,
    balanceLimit
  ) => {
    const normalized = normalizeBaseUrl(parentBaseUrl);
    const keys = store.getState().childKeys;
    const existingIndex = keys.findIndex(
      (entry) => entry.parentBaseUrl === normalized
    );
    if (existingIndex !== -1) {
      // Update existing child key
      const next = keys.map((entry) =>
        entry.parentBaseUrl === normalized
          ? {
              ...entry,
              childKey,
              balance: balance ?? 0,
              validityDate,
              balanceLimit,
              createdAt: Date.now(),
            }
          : entry
      );
      store.getState().setChildKeys(next);
    } else {
      // Add new child key
      const next = [...keys];
      next.push({
        parentBaseUrl: normalized,
        childKey,
        balance: balance ?? 0,
        validityDate,
        balanceLimit,
        createdAt: Date.now(),
      });
      store.getState().setChildKeys(next);
    }
  },

  updateChildKeyBalance: (parentBaseUrl, balance) => {
    const normalized = normalizeBaseUrl(parentBaseUrl);
    const keys = store.getState().childKeys;
    const next = keys.map((entry) =>
      entry.parentBaseUrl === normalized ? { ...entry, balance } : entry
    );
    store.getState().setChildKeys(next);
  },

  removeChildKey: (parentBaseUrl) => {
    const normalized = normalizeBaseUrl(parentBaseUrl);
    const next = store
      .getState()
      .childKeys.filter((entry) => entry.parentBaseUrl !== normalized);
    store.getState().setChildKeys(next);
  },

  getAllChildKeys: () => {
    return store.getState().childKeys.map((entry) => ({
      parentBaseUrl: entry.parentBaseUrl,
      childKey: entry.childKey,
      balance: entry.balance,
      balanceLimit: entry.balanceLimit,
      validityDate: entry.validityDate,
      createdAt: entry.createdAt,
    }));
  },

  getCachedReceiveTokens: () => {
    return store.getState().cachedReceiveTokens;
  },

  setCachedReceiveTokens: (tokens) => {
    store.getState().setCachedReceiveTokens(tokens);
  },

  // ========== XCashu Tokens (multiple tokens per baseUrl) ==========

  getXcashuTokens: () => {
    return store.getState().xcashuTokens;
  },

  getXcashuTokensForBaseUrl: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    return store.getState().xcashuTokens[normalized] || [];
  },

  addXcashuToken: (baseUrl, token) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const tokens = store.getState().xcashuTokens;
    const existing = tokens[normalized] || [];
    const next = { ...tokens };
    next[normalized] = [
      ...existing,
      { baseUrl: normalized, token, createdAt: Date.now(), tryCount: 0 },
    ];
    store.getState().setXcashuTokens(next);
  },

  removeXcashuToken: (baseUrl, token) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const tokens = store.getState().xcashuTokens;
    const existing = tokens[normalized] || [];
    const next = { ...tokens };
    next[normalized] = existing.filter((entry) => entry.token !== token);
    if (next[normalized].length === 0) {
      delete next[normalized];
    }
    store.getState().setXcashuTokens(next);
  },

  clearXcashuTokensForBaseUrl: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const tokens = store.getState().xcashuTokens;
    const next = { ...tokens };
    delete next[normalized];
    store.getState().setXcashuTokens(next);
  },

  updateXcashuTokenTryCount: (token, tryCount) => {
    store.getState().updateXcashuTokenTryCount(token, tryCount);
  },
});

export const createProviderRegistryFromStore = (
  store: SdkStore
): ProviderRegistry => ({
  getModelsForProvider: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    return store.getState().modelsFromAllProviders[normalized] || [];
  },
  getDisabledProviders: () => store.getState().disabledProviders,
  getProviderMints: (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    return store.getState().mintsFromAllProviders[normalized] || [];
  },
  getProviderInfo: async (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const cached = store.getState().infoFromAllProviders[normalized];
    if (cached) return cached;
    try {
      const response = await fetch(`${normalized}v1/info`);
      if (!response.ok) {
        throw new Error(`Failed ${response.status}`);
      }
      const info = (await response.json()) as ProviderInfo;
      const next = { ...store.getState().infoFromAllProviders };
      next[normalized] = info;
      store.getState().setInfoFromAllProviders(next);
      return info;
    } catch (error) {
      console.warn(`Failed to fetch provider info from ${normalized}:`, error);
      return null;
    }
  },
  getAllProvidersModels: () => store.getState().modelsFromAllProviders,
});
