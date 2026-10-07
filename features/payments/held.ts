import type { ApiKeyEntry, StorageAdapter } from "@routstr/sdk/wallet";
import { tokenSats } from "@/features/wallet/tokens";

// A key is made from a token; until the provider reports its balance (a
// request stopped before any answer), the token is what it holds
const keySats = (key: ApiKeyEntry) =>
  key.balance || (key.key.startsWith("cashu") ? tokenSats(key.key) : 0);

/** What these keys hold, unrounded. */
export const keysSats = (keys: ApiKeyEntry[]): number =>
  keys.reduce((sum, key) => sum + keySats(key), 0);

/** Sats held at providers in this credit store: what its keys hold, X-Cashu
 *  tokens kept for a provider, and refunds a provider sent back that the
 *  wallet has not taken in yet. */
export const heldSats = (storage: StorageAdapter): number =>
  Math.round(
    keysSats(storage.getAllApiKeys()) +
      Object.values(storage.getXcashuTokens())
        .flat()
        .reduce((sum, t) => sum + tokenSats(t.token), 0) +
      storage
        .getCachedReceiveTokens()
        .reduce(
          (sum, t) => sum + (t.unit === "msat" ? t.amount / 1000 : t.amount),
          0
        )
  );

/** What this account's key at each provider holds, by the provider's address
 *  as keys are stored (with its closing slash). The API-key path spends it
 *  before the wallet, at that provider and no other. */
export const keyCredit = (storage: StorageAdapter): Record<string, number> => {
  const sats: Record<string, number> = {};
  for (const key of storage.getAllApiKeys())
    sats[key.baseUrl] = (sats[key.baseUrl] ?? 0) + keySats(key);
  return sats;
};
