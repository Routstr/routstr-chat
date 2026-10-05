import { useEffect } from "react";
import { getTokenMetadata } from "@cashu/cashu-ts";
import { useStore } from "zustand";
import { createMemoryDriver } from "@routstr/sdk/storage";
import { createPaymentStore, getPaymentStore } from "@/sdk/paymentStore";
import { hydrate as hydrateShared, store as sharedStore } from "@/sdk/sharedStore";
import { hasCredit, legacyCredit } from "@/sdk/refundCredit";
import { otherDeviceKeys } from "@/hooks/useSdkApiKeysSync";
import { loadRemoteNode } from "@/utils/storageUtils";
import type { StorageAdapter } from "@routstr/sdk/wallet";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";

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

const empty = createPaymentStore(createMemoryDriver());

function creditSats(storage: StorageAdapter): number {
  const apiKeyTotal = storage
    .getAllApiKeys()
    .reduce((sum, k) => sum + (k.balance || 0), 0);
  const childKeyTotal = storage
    .getAllChildKeys()
    .reduce((sum, k) => sum + (k.balance || 0), 0);
  // xcashuTokens is keyed by baseUrl; each entry is an array of token objects.
  const xcashuTotal = Object.values(storage.getXcashuTokens()).reduce(
    (sum, tokens) =>
      sum + tokens.reduce((s, t) => s + tokenToSats(t.token), 0),
    0,
  );
  const heldTotal = storage
    .getCachedReceiveTokens()
    .reduce((sum, t) => sum + (t.unit === "msat" ? t.amount / 1000 : t.amount), 0);
  // Satoshis are integers — round away floating-point drift from accumulation
  return Math.round(apiKeyTotal + childKeyTotal + xcashuTotal + heldTotal);
}

/**
 * This account's provider credit plus pre-upgrade credit. `refundable` also
 * counts keys reading 0 and other devices' keys, so Refund stays reachable.
 */
export function useSdkCachedBalance(): { sats: number; refundable: boolean } {
  const { manager } = useAccountManager();
  const account = useObservableState(manager.active$);
  const payments = account ? getPaymentStore(account.pubkey) : empty;
  const legacy = legacyCredit(loadRemoteNode()?.url);
  const cachedBalance = useStore(payments.store, () =>
    creditSats(payments.storage),
  );
  const legacyBalance = useStore(sharedStore, () => creditSats(legacy));
  const held = useStore(payments.store, () => hasCredit(payments.storage));
  const legacyHeld = useStore(sharedStore, () => hasCredit(legacy));
  const othersHeld = useStore(
    otherDeviceKeys,
    (state) => state.owner === account?.pubkey && state.keys.length > 0,
  );

  // Trigger hydration (no-op if already resolved)
  useEffect(() => {
    void Promise.all([payments.hydrate, hydrateShared]).catch((error) => {
      console.warn("Failed to hydrate store", error);
    });
  }, [payments]);

  const sats = cachedBalance + legacyBalance;
  return { sats, refundable: sats > 0 || held || legacyHeld || othersHeld };
}
