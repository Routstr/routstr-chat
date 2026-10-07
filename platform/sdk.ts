import {
  fetchAIResponse,
  isTorContext,
  MintDiscovery,
  ModelManager,
  noopLogger,
  ProviderManager,
} from "@routstr/sdk";
import { RoutstrClient } from "@routstr/sdk/client";
import {
  createDiscoveryAdapterFromStore,
  createIndexedDBDriver,
  createIndexedDBUsageTrackingDriver,
  createMemoryDriver,
  createMemoryUsageTrackingDriver,
  createSdkStore,
} from "@routstr/sdk/storage";
import type { StorageAdapter, WalletAdapter } from "@routstr/sdk/wallet";
import type { Sdk } from "@/features/payments/ports";

/**
 * The Routstr SDK's routing state, built once per tab: where providers and
 * their models are cached, how they rank, and the usage log. Credentials are
 * not here: they live per account in the keys service. The discovery cache
 * has its own database, so nothing that writes it can touch credit.
 */
export function createSdk({ extraProviders }: { extraProviders: string[] }) {
  const browser = typeof window !== "undefined";
  const { store, hydrate } = createSdkStore({
    driver: browser
      ? createIndexedDBDriver({ dbName: "routstr-chat-discovery" })
      : createMemoryDriver(),
  });
  const discoveryAdapter = createDiscoveryAdapterFromStore(store);
  // main's usage log, so costs recorded there stay visible
  const usageTrackingDriver = browser
    ? createIndexedDBUsageTrackingDriver()
    : createMemoryUsageTrackingDriver();
  // Providers added by hand are trusted without a Routstr review, which an
  // offline test stack cannot have
  const ready = hydrate.then(() => {
    const enabled = discoveryAdapter.getManuallyEnabledProviders();
    const added = extraProviders.filter((url) => !enabled.includes(url));
    if (added.length) {
      discoveryAdapter.setManuallyEnabledProviders?.([...enabled, ...added]);
    }
  });
  const request: Sdk["request"] = (options, callbacks) =>
    fetchAIResponse(
      { ...options, discoveryAdapter, usageTrackingDriver, sdkStore: store },
      {
        ...callbacks,
        onBalanceUpdate: () => {},
        onTransactionUpdate: () => {},
      },
      { alertLevel: "min", logger: noopLogger }
    );
  // by request id alone: the log keeps the canonical model id, not the one picked
  const cost: Sdk["cost"] = async (requestId) =>
    (await usageTrackingDriver.list({ after: Date.now() - 60_000 })).find(
      (entry) => entry.id === requestId
    )?.satsCost;
  return {
    ready,
    discoveryAdapter,
    modelManager: new ModelManager(discoveryAdapter, {
      includeProviderUrls: extraProviders,
      logger: noopLogger,
    }),
    providerManager: new ProviderManager(discoveryAdapter, store, noopLogger),
    mintDiscovery: new MintDiscovery(discoveryAdapter),
    request,
    cost,
    usageTrackingDriver,
    torMode: isTorContext,
    client: (wallet: WalletAdapter, storage: StorageAdapter) =>
      new RoutstrClient(wallet, storage, discoveryAdapter, "min", "apikeys", {
        logger: noopLogger,
        usageTrackingDriver,
        sdkStore: store,
      }),
  };
}
