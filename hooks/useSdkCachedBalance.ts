import { useEffect, useSyncExternalStore } from "react";
import { store, hydrate } from "@/sdk/sharedStore";

function getSnapshot(): number {
  const state = store.getState();
  const apiKeyTotal = state.apiKeys.reduce(
    (sum, k) => sum + (k.balance || 0),
    0,
  );
  const childKeyTotal = state.childKeys.reduce(
    (sum, k) => sum + (k.balance || 0),
    0,
  );
  // Satoshis are integers — round away floating-point drift from accumulation
  return Math.round(apiKeyTotal + childKeyTotal);
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Subscribe to the SDK store's cached balance (apiKeys + childKeys).
 * Uses useSyncExternalStore to avoid race conditions with async hydration.
 */
export function useSdkCachedBalance(): number {
  const cachedBalance = useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Trigger hydration (no-op if already resolved)
  useEffect(() => {
    void hydrate.catch((error) => {
      console.warn("Failed to hydrate store", error);
    });

    // Debug: log cached balance periodically
    const interval = setInterval(() => {
      const state = store.getState();
      const apiKeyTotal = state.apiKeys.reduce(
        (sum, k) => sum + (k.balance || 0),
        0,
      );
      const childKeyTotal = state.childKeys.reduce(
        (sum, k) => sum + (k.balance || 0),
        0,
      );
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return cachedBalance;
}
