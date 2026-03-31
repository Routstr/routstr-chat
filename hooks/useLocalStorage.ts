import { useState, useEffect, useSyncExternalStore } from "react";
import {
  getScopedStorageKey,
  subscribeToIdentityScope,
} from "@/utils/accountScope";

/**
 * Generic hook for managing localStorage state
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  }
) {
  const serialize = serializer?.serialize || JSON.stringify;
  const deserialize = serializer?.deserialize || JSON.parse;
  const resolvedKey = useSyncExternalStore(
    subscribeToIdentityScope,
    () => getScopedStorageKey(key),
    () => key
  );

  const loadValue = (storageKey: string): T => {
    // Check if we're in the browser environment
    if (typeof window === "undefined") {
      return defaultValue;
    }

    try {
      const item = localStorage.getItem(storageKey);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to load ${storageKey} from localStorage:`, error);
      return defaultValue;
    }
  };

  const [state, setState] = useState<T>(() => {
    return loadValue(resolvedKey);
  });

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(state) : value;
      setState(valueToStore);

      // Only access localStorage in the browser
      if (typeof window !== "undefined") {
        localStorage.setItem(resolvedKey, serialize(valueToStore));
      }
    } catch (error) {
      console.warn(`Failed to save ${resolvedKey} to localStorage:`, error);
    }
  };

  // Hydrate from localStorage on client mount and account scope changes
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setState(loadValue(resolvedKey));
  }, [resolvedKey]); // Run on mount and scope changes

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    // Only set up storage listener in the browser
    if (typeof window === "undefined") {
      return;
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === resolvedKey && e.newValue !== null) {
        try {
          setState(deserialize(e.newValue));
        } catch (error) {
          console.warn(
            `Failed to sync ${resolvedKey} from localStorage:`,
            error
          );
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [resolvedKey, deserialize]);

  return [state, setValue] as const;
}
