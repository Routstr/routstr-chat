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
  createIndexedDBDriver,
  createIndexedDBUsageTrackingDriver,
  createMemoryDriver,
  createMemoryUsageTrackingDriver,
} from "@routstr/sdk/storage";
import { ModelManager, ProviderManager, consoleLogger } from "@routstr/sdk";

import type { SdkStore, UsageTrackingDriver } from "@routstr/sdk/storage";
import type { DiscoveryAdapter } from "@routstr/sdk/discovery";
import type { StorageAdapter } from "@routstr/sdk/wallet";
import { eventStore } from "@/lib/applesauce-core";
import { eventDatabaseReady } from "@/lib/eventDatabase";

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------
const isBrowser = typeof window !== "undefined";

/**
 * We use IndexedDB in the browser (handles larger payloads like provider
 * metadata) and an in-memory driver during SSR / edge rendering.
 */
const driver = isBrowser ? createIndexedDBDriver() : createMemoryDriver();

// Both drivers are at version 3 and share the same "routstr-sdk" database.
// The main driver's cross-driver init already creates the usage_tracking
// object store with all indexes.
const usageTrackingDriver: UsageTrackingDriver = isBrowser
  ? createIndexedDBUsageTrackingDriver()
  : createMemoryUsageTrackingDriver();

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------
const { store, hydrate } = createSdkStore({ driver });
const discoveryReady = Promise.all([hydrate, eventDatabaseReady]).then(() => {});

// ---------------------------------------------------------------------------
// Pre-built adapters (derived from the one store)
// ---------------------------------------------------------------------------
const discoveryAdapter: DiscoveryAdapter =
  createDiscoveryAdapterFromStore(store);

const storageAdapter: StorageAdapter = createStorageAdapterFromStore(store);

// ---------------------------------------------------------------------------
// Shared managers (derived from the one store + adapter)
// ---------------------------------------------------------------------------
// A single ModelManager instance shared across all hooks.  This avoids
// re-creating (and re-bootstrapping) a ModelManager on every render / every
// fetchAIResponse call.  The underlying cache lives in discoveryAdapter, so
// all consumers read from the same source of truth.
const modelManager = new ModelManager(discoveryAdapter, {
  logger: consoleLogger,
  eventStore,
});

// A single ProviderManager for consistent failure-tracking / cooldown state
// across all requests.  Without a shared instance, each fetchAIResponse call
// would create a new ProviderManager that knows nothing about providers that
// already failed.
const providerManager = new ProviderManager(discoveryAdapter, store, consoleLogger);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export {
  driver,
  store,
  hydrate,
  discoveryReady,
  discoveryAdapter,
  storageAdapter,
  usageTrackingDriver,
  modelManager,
  providerManager,
};
export type { SdkStore, DiscoveryAdapter, StorageAdapter };
