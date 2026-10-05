import { getTokenMetadata } from "@cashu/cashu-ts";
import {
  createSdkStore,
  createStorageAdapterFromStore,
  createIndexedDBDriver,
  createMemoryDriver,
  type StorageDriver,
} from "@routstr/sdk/storage";

function tokenValue(token: string): { amount: number; unit: "sat" | "msat" } {
  try {
    const { amount, unit } = getTokenMetadata(token);
    return { amount, unit: unit === "msat" ? "msat" : "sat" };
  } catch {
    // Keep the token even when its amount can't be read here.
    return { amount: 0, unit: "sat" };
  }
}

export function createPaymentStore(driver: StorageDriver) {
  const { store, hydrate } = createSdkStore({ driver });
  const storage = createStorageAdapterFromStore(store);
  return {
    store,
    storage,
    hydrate,
    /** Saves a refund token for this account's next refund to receive. */
    async hold(token: string) {
      const value = tokenValue(token);
      const held = storage.getCachedReceiveTokens();
      const added = !held.some((entry) => entry.token === token);
      if (added) {
        storage.setCachedReceiveTokens([
          ...held,
          { token, ...value, createdAt: Date.now() },
        ]);
      }
      await storage.flush?.();
      return { ...value, added };
    },
    async reload() {
      await hydrate;
      await storage.flush?.();
      const loaded = createSdkStore({ driver });
      await loaded.hydrate;
      const { apiKeys, childKeys, xcashuTokens, cachedReceiveTokens } =
        loaded.store.getState();
      store.setState({ apiKeys, childKeys, xcashuTokens, cachedReceiveTokens });
    },
  };
}

const accounts = new Map<string, ReturnType<typeof createPaymentStore>>();

export function getPaymentStore(pubkey: string, node = false) {
  const name = `routstr-chat-payments:${pubkey}:${node ? "node" : "direct"}`;
  let payments = accounts.get(name);
  if (!payments) {
    payments = createPaymentStore(
      typeof window === "undefined"
        ? createMemoryDriver()
        : createIndexedDBDriver({ dbName: name })
    );
    accounts.set(name, payments);
  }
  return payments;
}
