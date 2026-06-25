import { useEffect, useMemo, useState } from "react";
import {
  storageAdapter,
  providerRegistry,
  usageTrackingDriver,
  hydrate,
} from "@/sdk/sharedStore";
import type { StorageAdapter, ProviderRegistry } from "@routstr/sdk/wallet";
import {
  RoutstrClient,
  type RoutstrClientMode,
} from "@routstr/sdk/client";
import type { WalletAdapter } from "@routstr/sdk/wallet";

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
  mode: RoutstrClientMode = "xcashu",
): UseSdkClientResult {
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);

  const client = useMemo(() => {
    if (!walletAdapter) {
      const pendingDeps = createPendingDeps();
      return new RoutstrClient(
        {} as WalletAdapter,
        pendingDeps.storageAdapter,
        pendingDeps.providerRegistry,
        "min",
        mode,
      );
    }
    return new RoutstrClient(
      walletAdapter,
      storageAdapter,
      providerRegistry,
      "min",
      mode,
      { usageTrackingDriver },
    );
  }, [walletAdapter, mode]);

  useEffect(() => {
    let cancelled = false;
    hydrate
      .then(() => {
        if (cancelled) return;
        setIsReady(true);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e
            : new Error("Failed to load SDK dependencies"),
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    client,
    isReady,
    error,
  };
}
