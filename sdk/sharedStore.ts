/**
 * Shared SDK store singleton.
 *
 * All hooks (useSdkClient, useDiscoveryAdapter, useSdkCachedBalance, etc.)
 * import from here so there is exactly ONE store, ONE hydrate cycle, and
 * ONE set of adapters across the entire app.
 */
import {
  createSdkStore,
  createDiscoveryAdapterFromStore,
  createStorageAdapterFromStore,
  createProviderRegistryFromStore,
  createIndexedDBDriver,
  createIndexedDBUsageTrackingDriver,
  createMemoryDriver,
  createMemoryUsageTrackingDriver,
} from "@routstr/sdk/storage";

import type { SdkStore, UsageTrackingDriver } from "@routstr/sdk/storage";
import type { DiscoveryAdapter } from "@routstr/sdk/discovery";
import type { StorageAdapter, ProviderRegistry } from "@routstr/sdk/wallet";

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------
const isBrowser = typeof window !== "undefined";

/**
 * We use IndexedDB in the browser (handles larger payloads like provider
 * metadata) and an in-memory driver during SSR / edge rendering.
 */
const driver = isBrowser ? createIndexedDBDriver() : createMemoryDriver();

// Keep usage in a separate database: the SDK's two IndexedDB drivers use
// independent schemas and cannot safely share the default database.
const usageTrackingDriver: UsageTrackingDriver = isBrowser
  ? createIndexedDBUsageTrackingDriver({ dbName: "routstr-chat-usage" })
  : createMemoryUsageTrackingDriver();

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------
const { store, hydrate } = createSdkStore({ driver });

// ---------------------------------------------------------------------------
// Pre-built adapters (derived from the one store)
// ---------------------------------------------------------------------------
const discoveryAdapter: DiscoveryAdapter =
  createDiscoveryAdapterFromStore(store);

const storageAdapter: StorageAdapter = createStorageAdapterFromStore(store);

const providerRegistry: ProviderRegistry =
  createProviderRegistryFromStore(store);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export {
  store,
  hydrate,
  discoveryAdapter,
  storageAdapter,
  providerRegistry,
  usageTrackingDriver,
};
export type { SdkStore, DiscoveryAdapter, StorageAdapter, ProviderRegistry };
