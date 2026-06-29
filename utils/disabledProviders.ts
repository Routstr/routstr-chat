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
import { store, discoveryAdapter } from "@/sdk/sharedStore";

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
