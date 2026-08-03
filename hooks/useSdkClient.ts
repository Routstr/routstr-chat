import { useEffect, useMemo, useState } from "react";
import {
  storageAdapter,
  discoveryAdapter,
  usageTrackingDriver,
  hydrate,
} from "@/sdk/sharedStore";
import type { StorageAdapter } from "@routstr/sdk/wallet";
import type { DiscoveryAdapter } from "@routstr/sdk/discovery";
import {
  RoutstrClient,
  type RoutstrClientMode,
} from "@routstr/sdk/client";
import type { WalletAdapter } from "@routstr/sdk/wallet";

/**
 * Creates a filtered logger that only passes through warn and error messages.
 * Use "warn" to see warn+error, "error" for error only.
 */
function createFilteredLogger(level: "warn" | "error") {
  const filter = (...args: unknown[]): void => {
    // warn level includes both warn and error
    // error level includes only error
    // both levels suppress log and debug
  };

  const logger = {
    log: filter,
    debug: filter,
    warn:
      level === "warn"
        ? (...args: unknown[]) => console.warn(...args)
        : filter,
    error: (...args: unknown[]) => console.error(...args),
    child: () => logger,
  };

  return logger;
}

interface UseSdkClientResult {
  client: RoutstrClient;
  isReady: boolean;
  error: Error | null;
}

const createPendingDeps = (): {
  storageAdapter: StorageAdapter;
  discoveryAdapter: DiscoveryAdapter;
} => {
  const pendingHandler = () => {
    throw new Error("SDK not ready");
  };
  const pendingDiscovery: DiscoveryAdapter = {
    getCachedModels: () => ({}),
    setCachedModels: () => {},
    getCachedMints: () => ({}),
    setCachedMints: () => {},
    getCachedProviderInfo: () => ({}),
    setCachedProviderInfo: () => {},
    getProviderLastUpdate: () => null,
    setProviderLastUpdate: () => {},
    getLastUsedModel: () => null,
    setLastUsedModel: () => {},
    getDisabledProviders: () => [],
    getManuallyDisabledProviders: () => [],
    getBaseUrlsList: () => [],
    getBaseUrlsLastUpdate: () => null,
    setBaseUrlsList: () => {},
    setBaseUrlsLastUpdate: () => {},
    getRoutstr21Models: () => [],
    setRoutstr21Models: () => {},
    getRoutstr21ModelsLastUpdate: () => null,
    setRoutstr21ModelsLastUpdate: () => {},
  };
  const pendingStorage: StorageAdapter = {
    saveProviderInfo: pendingHandler,
    getProviderInfo: () => null,
    getApiKey: () => null,
    setApiKey: pendingHandler,
    updateApiKeyBalance: pendingHandler,
    touchApiKeyLastUsed: pendingHandler,
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
  return { storageAdapter: pendingStorage, discoveryAdapter: pendingDiscovery };
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
        pendingDeps.discoveryAdapter,
        "min",
        mode,
      );
    }
    return new RoutstrClient(
      walletAdapter,
      storageAdapter,
      discoveryAdapter,
      "min",
      mode,
      {
        usageTrackingDriver,
        logger: createFilteredLogger("warn"), // only show warn + error; change to "error" for error-only
      },
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
