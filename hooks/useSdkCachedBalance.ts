import { useState, useEffect, useRef } from "react";
import { createSdkStore, type SdkStore } from "@routstr/sdk/storage";
import { localStorageDriver } from "@routstr/sdk/storage";

let globalStore: ReturnType<typeof createSdkStore> | null = null;

const getSdkStore = (): ReturnType<typeof createSdkStore> => {
  if (!globalStore) {
    globalStore = createSdkStore({ driver: localStorageDriver });
  }
  return globalStore;
};

export function useSdkCachedBalance(): number {
  const [cachedBalance, setCachedBalance] = useState(0);
  const storeRef = useRef(getSdkStore());

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const computeBalance = () => {
      const state = storeRef.current.store.getState();
      const apiKeys = state.apiKeys;
      const childKeys = state.childKeys;
      console.log("API BALANCE", apiKeys);

      const apiKeyTotal = apiKeys.reduce((sum, k) => sum + (k.balance || 0), 0);
      const childKeyTotal = childKeys.reduce(
        (sum, k) => sum + (k.balance || 0),
        0
      );

      setCachedBalance(apiKeyTotal + childKeyTotal);
    };

    computeBalance();
    unsubscribe = storeRef.current.store.subscribe(computeBalance);

    void storeRef.current.hydrate.catch((error) => {
      console.warn("Failed to hydrate store", error);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return cachedBalance;
}
