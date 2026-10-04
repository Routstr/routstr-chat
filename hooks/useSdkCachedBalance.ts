import { useEffect, useSyncExternalStore } from "react";
import { getTokenMetadata } from "@cashu/cashu-ts";
import { store, hydrate } from "@/sdk/sharedStore";

/**
 * Decode a Cashu token string to its satoshi value.
 * Returns 0 for malformed tokens or non-sat units.
 */
function tokenToSats(token: string): number {
  try {
    const metadata = getTokenMetadata(token);
    if (metadata.unit && metadata.unit !== "sat") return 0;
    return metadata.amount;
  } catch {
    return 0;
  }
}

/** The same figure, read once, outside React (to measure what a call moved). */
export function readSdkCachedBalance(): number {
  return getSnapshot();
}

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
  // xcashuTokens is keyed by baseUrl; each entry is an array of token objects.
  const xcashuTotal = Object.values(state.xcashuTokens).reduce(
    (sum, tokens) =>
      sum + tokens.reduce((s, t) => s + tokenToSats(t.token), 0),
    0,
  );
  // Satoshis are integers — round away floating-point drift from accumulation
  return Math.round(apiKeyTotal + childKeyTotal + xcashuTotal);
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Subscribe to the SDK store's cached balance
 * (apiKeys + childKeys + xcashu tokens).
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
  }, []);

  return cachedBalance;
}
