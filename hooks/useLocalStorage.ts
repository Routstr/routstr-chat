import { useState, useEffect } from "react";

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

  const [state, setState] = useState<T>(() => {
    // Check if we're in the browser environment
    if (typeof window === "undefined") {
      return defaultValue;
    }

    try {
      const item = localStorage.getItem(key);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to load ${key} from localStorage:`, error);
      return defaultValue;
    }
  });

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(state) : value;
      setState(valueToStore);

      // Only access localStorage in the browser
      if (typeof window !== "undefined") {
        localStorage.setItem(key, serialize(valueToStore));
      }
    } catch (error) {
      console.warn(`Failed to save ${key} to localStorage:`, error);
    }
  };

  // Hydrate from localStorage on client mount
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const item = localStorage.getItem(key);
      if (item) {
        setState(deserialize(item));
      }
    } catch (error) {
      console.warn(`Failed to hydrate ${key} from localStorage:`, error);
    }
  }, []); // Run once on mount

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    // Only set up storage listener in the browser
    if (typeof window === "undefined") {
      return;
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(deserialize(e.newValue));
        } catch (error) {
          console.warn(`Failed to sync ${key} from localStorage:`, error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [key, deserialize]);

  return [state, setValue] as const;
}
