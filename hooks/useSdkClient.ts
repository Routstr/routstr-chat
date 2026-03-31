import { useEffect, useMemo, useRef, useState } from "react";
import {
  createProviderRegistryFromStore,
  createSdkStore,
  createStorageAdapterFromStore,
} from "@/sdk/storage/store";
import { createIndexedDBDriver } from "@/sdk/storage/drivers/indexedDB";
import { createMemoryDriver } from "@/sdk/storage/drivers/memory";

const isBrowser = typeof window !== "undefined";
import type { StorageAdapter, ProviderRegistry } from "@/sdk/wallet/interfaces";
import {
  RoutstrClient,
  type RoutstrClientMode,
} from "@/sdk/client/RoutstrClient";
import type { WalletAdapter } from "@/sdk/wallet/interfaces";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { getScopedDbName } from "@/utils/accountScope";

interface UseSdkClientResult {
  client: RoutstrClient;
  isReady: boolean;
  error: Error | null;
}

const createPendingDeps = (): {
  storageAdapter: StorageAdapter;
  providerRegistry: ProviderRegistry;
} => {
  const pendingHandler = () => {
    throw new Error("SDK not ready");
  };
  const pendingRegistry: ProviderRegistry = {
    getModelsForProvider: () => [],
    getDisabledProviders: () => [],
    getProviderMints: () => [],
    getProviderInfo: async () => null,
    getAllProvidersModels: () => ({}),
  };
  const pendingStorage: StorageAdapter = {
    saveProviderInfo: pendingHandler,
    getProviderInfo: () => null,
    getApiKey: () => null,
    setApiKey: pendingHandler,
    updateApiKeyBalance: pendingHandler,
    removeApiKey: pendingHandler,
    getAllApiKeys: () => [],
    getApiKeyDistribution: () => [],
    getChildKey: () => null,
    setChildKey: pendingHandler,
    updateChildKeyBalance: pendingHandler,
    removeChildKey: pendingHandler,
    getAllChildKeys: () => [],
    getCachedReceiveTokens: () => [],
    setCachedReceiveTokens: pendingHandler,
    getXcashuTokens: () => ({}),
    getXcashuTokensForBaseUrl: () => [],
    addXcashuToken: pendingHandler,
    removeXcashuToken: pendingHandler,
    clearXcashuTokensForBaseUrl: pendingHandler,
    updateXcashuTokenTryCount: pendingHandler,
  };
  return { storageAdapter: pendingStorage, providerRegistry: pendingRegistry };
};

export function useSdkClient(
  walletAdapter: WalletAdapter | null,
  mode: RoutstrClientMode = "xcashu"
): UseSdkClientResult {
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);
  const identityId = activeAccount?.pubkey ?? null;

  const scopedStore = useMemo(
    () =>
      createSdkStore({
        driver: isBrowser
          ? createIndexedDBDriver({
              dbName: getScopedDbName("routstr-sdk", identityId),
            })
          : createMemoryDriver(),
      }),
    [identityId]
  );

  const deps = useMemo(() => {
    return {
      storageAdapter: createStorageAdapterFromStore(scopedStore.store),
      providerRegistry: createProviderRegistryFromStore(scopedStore.store),
    };
  }, [scopedStore]);

  const client = useMemo(() => {
    if (!walletAdapter) {
      const pendingDeps = createPendingDeps();
      return new RoutstrClient(
        {} as WalletAdapter,
        pendingDeps.storageAdapter,
        pendingDeps.providerRegistry,
        "min",
        mode
      );
    }
    return new RoutstrClient(
      walletAdapter,
      deps.storageAdapter,
      deps.providerRegistry,
      "min",
      mode
    );
  }, [walletAdapter, deps, mode]);

  useEffect(() => {
    let cancelled = false;
    setIsReady(false);
    scopedStore.hydrate
      .then(() => {
        if (cancelled) return;
        setIsReady(true);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error ? e : new Error("Failed to load SDK dependencies")
        );
      });

    return () => {
      cancelled = true;
    };
  }, [scopedStore]);

  return {
    client,
    isReady,
    error,
  };
}
