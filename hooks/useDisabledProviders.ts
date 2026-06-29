"use client";

import { useCallback } from "react";
import { useStore } from "zustand";
import { store } from "@/sdk/sharedStore";
import {
  getDisabledProvidersSync,
  setDisabledProvidersSync,
} from "@/utils/disabledProviders";

/**
 * Single source of truth for disabled providers — the SDK's `SdkStore`.
 *
 * The chat app used to keep its own `disabled_providers` list in localStorage
 * (`loadDisabledProviders` / `saveDisabledProviders`). That list had **zero
 * effect on routing** — `ProviderManager` / `ModelManager` only ever consult
 * the SDK's `SdkStore.disabledProviders` (the IndexedDB-backed zustand store
 * exported from `@/sdk/sharedStore`).
 *
 * This hook reads/writes that same SDK store, so a provider toggled off in the
 * UI is now actually skipped during price ranking, failover, and request
 * resolution. One list, one store, one truth.
 *
 * The list is normalized with a trailing slash (matching the SDK's
 * `normalizeBaseUrl`), consistent with `normalizeProviderUrl` from torUtils.
 */
export function useDisabledProviders() {
  // Subscribe reactively to the SDK store. Before hydration this is `[]`
  // (the store's initial state); once hydration completes the zustand state
  // updates and subscribers re-render automatically.
  const disabledProviders = useStore(store, (s) => s.disabledProviders);

  /**
   * Replace the entire disabled-providers list.
   * URLs are normalized (trailing slash) by the SDK store setter.
   */
  const setDisabledProviders = useCallback((urls: string[]): void => {
    setDisabledProvidersSync(urls);
  }, []);

  /**
   * Toggle a single provider's disabled state.
   */
  const toggleProvider = useCallback(
    (url: string, disabled: boolean): void => {
      const normalized = url.endsWith("/") ? url : `${url}/`;
      const current = new Set(getDisabledProvidersSync());
      if (disabled) {
        current.add(normalized);
      } else {
        current.delete(normalized);
      }
      setDisabledProvidersSync(Array.from(current));
    },
    [],
  );

  return { disabledProviders, setDisabledProviders, toggleProvider };
}
