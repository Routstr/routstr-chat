import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DiscoveryAdapter } from "@/sdk/discovery";
import {
  createDiscoveryAdapterFromStore,
  createSdkStore,
} from "@/sdk/storage/store";
import { localStorageDriver } from "@/sdk/storage/drivers/localStorage";
import {
  getCurrentIdentityId,
  subscribeToIdentityScope,
} from "@/utils/accountScope";

const browserDiscoveryStores = new Map<string, ReturnType<typeof createSdkStore>>();

const getBrowserDiscoveryStore = (
  scopeKey: string
): ReturnType<typeof createSdkStore> => {
  const existingStore = browserDiscoveryStores.get(scopeKey);
  if (existingStore) {
    return existingStore;
  }

  const store = createSdkStore({
      driver: localStorageDriver,
    });
  browserDiscoveryStores.set(scopeKey, store);
  return store;
};

export function useDiscoveryAdapter(): DiscoveryAdapter {
  const scopeKey = useSyncExternalStore(
    subscribeToIdentityScope,
    () => getCurrentIdentityId() ?? "__device__",
    () => "__device__"
  );
  const scopedStore = useMemo(
    () => getBrowserDiscoveryStore(scopeKey),
    [scopeKey]
  );
  const adapter = useMemo(
    () => createDiscoveryAdapterFromStore(scopedStore.store),
    [scopedStore]
  );

  useEffect(() => {
    let cancelled = false;
    scopedStore.hydrate
      .then(() => {
        if (cancelled) return;
      })
      .catch((error) => {
        console.warn("Failed to initialize discovery adapter", error);
      });
    return () => {
      cancelled = true;
    };
  }, [scopedStore]);

  return adapter;
}
