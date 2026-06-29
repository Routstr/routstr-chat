/**
 * Plain (non-React) helpers for the disabled-providers list.
 *
 * The SDK's `SdkStore.disabledProviders` (IndexedDB-backed zustand store
 * exported from `@/sdk/sharedStore`) is the **single source of truth** — it is
 * the list `ProviderManager` / `ModelManager` consult for routing, price
 * ranking and failover. The chat app no longer maintains a separate
 * localStorage `disabled_providers` list.
 *
 * Use {@link getDisabledProvidersSync} in non-React code (e.g. failover in
 * `apiUtils.ts`). In React components use the `useDisabledProviders` hook
 * (`@/hooks/useDisabledProviders`) so the UI re-renders when the list changes.
 */
import { store, discoveryAdapter, hydrate } from "@/sdk/sharedStore";
import {
  loadDisabledProviders,
  STORAGE_KEYS,
} from "@/utils/storageUtils";

/**
 * Synchronous read of the current disabled-providers list from the SDK store.
 *
 * Returns the in-memory state, which is `[]` until `hydrate` completes.
 */
export function getDisabledProvidersSync(): string[] {
  return store.getState().disabledProviders;
}

/**
 * Replace the entire disabled-providers list in the SDK store.
 * URLs are normalized (trailing slash) by the store setter.
 */
export function setDisabledProvidersSync(urls: string[]): void {
  discoveryAdapter.setDisabledProviders?.(urls);
}

/**
 * One-time migration of the legacy localStorage `disabled_providers` list into
 * the SDK store.
 *
 * Runs after `hydrate` so we merge with — rather than clobber — any
 * Nostr-review-derived disabled providers the SDK already populated. The
 * legacy localStorage key is removed afterwards so the two lists can never
 * drift again. Idempotent.
 */
export async function migrateDisabledProvidersToSdk(): Promise<void> {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined")
    return;
  try {
    await hydrate;
    const legacy = loadDisabledProviders();
    if (legacy.length === 0) {
      // Nothing to migrate; clear any stale empty key just in case.
      try {
        localStorage.removeItem(STORAGE_KEYS.DISABLED_PROVIDERS);
      } catch {}
      return;
    }

    const merged = new Set(store.getState().disabledProviders);
    for (const url of legacy) {
      merged.add(url.endsWith("/") ? url : `${url}/`);
    }
    discoveryAdapter.setDisabledProviders?.(Array.from(merged));

    try {
      localStorage.removeItem(STORAGE_KEYS.DISABLED_PROVIDERS);
    } catch {}
  } catch (error) {
    console.warn("migrateDisabledProvidersToSdk failed:", error);
  }
}
