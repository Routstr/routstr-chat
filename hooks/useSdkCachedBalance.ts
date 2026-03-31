import { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { createSdkStore, type SdkStore } from "@/sdk/storage/store";
import { localStorageDriver } from "@/sdk/storage/drivers/localStorage";
import {
  getCurrentIdentityId,
  subscribeToIdentityScope,
} from "@/utils/accountScope";

const sdkStores = new Map<string, ReturnType<typeof createSdkStore>>();

const getSdkStore = (scopeKey: string): ReturnType<typeof createSdkStore> => {
  const existingStore = sdkStores.get(scopeKey);
  if (existingStore) {
    return existingStore;
  }

  const store = createSdkStore({ driver: localStorageDriver });
  sdkStores.set(scopeKey, store);
  return store;
};

export function useSdkCachedBalance(): number {
  const [cachedBalance, setCachedBalance] = useState(0);
  const scopeKey = useSyncExternalStore(
    subscribeToIdentityScope,
    () => getCurrentIdentityId() ?? "__device__",
    () => "__device__"
  );
  const scopedStore = useMemo(() => getSdkStore(scopeKey), [scopeKey]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const computeBalance = () => {
      const apiKeys = scopedStore.store.getState().apiKeys;
      const total = apiKeys.reduce((sum, k) => sum + (k.balance || 0), 0);
      setCachedBalance(total);
    };

    computeBalance();
    unsubscribe = scopedStore.store.subscribe(computeBalance);

    void scopedStore.hydrate.catch((error) => {
      console.warn("Failed to hydrate store", error);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [scopedStore]);

  return cachedBalance;
}
