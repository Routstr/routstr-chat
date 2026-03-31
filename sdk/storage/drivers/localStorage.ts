import type { StorageDriver } from "../types";
import { getScopedStorageKey } from "@/utils/accountScope";

const canUseLocalStorage = (): boolean => {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
};

const isQuotaExceeded = (error: unknown): boolean => {
  const e = error as { name?: string; code?: number } | null;
  return (
    !!e &&
    (e?.name === "QuotaExceededError" || e?.code === 22 || e?.code === 1014)
  );
};

const NON_CRITICAL_KEYS = new Set<string>(["modelsFromAllProviders"]);

export const localStorageDriver: StorageDriver = {
  async getItem<T>(key: string, defaultValue: T): Promise<T> {
    if (!canUseLocalStorage()) return defaultValue;
    const resolvedKey = getScopedStorageKey(key);
    try {
      const item = window.localStorage.getItem(resolvedKey);
      if (item === null) return defaultValue;
      try {
        return JSON.parse(item) as T;
      } catch (parseError) {
        if (typeof defaultValue === "string") {
          return item as T;
        }
        throw parseError;
      }
    } catch (error) {
      console.error(`Error retrieving item with key "${resolvedKey}":`, error);
      if (canUseLocalStorage()) {
        try {
          window.localStorage.removeItem(resolvedKey);
        } catch (removeError) {
          console.error(
            `Error removing corrupted item with key "${resolvedKey}":`,
            removeError
          );
        }
      }
      return defaultValue;
    }
  },
  async setItem<T>(key: string, value: T): Promise<void> {
    if (!canUseLocalStorage()) return;
    const resolvedKey = getScopedStorageKey(key);
    try {
      window.localStorage.setItem(resolvedKey, JSON.stringify(value));
    } catch (error) {
      if (isQuotaExceeded(error)) {
        if (NON_CRITICAL_KEYS.has(key)) {
          console.warn(
            `Storage quota exceeded; skipping non-critical key "${key}".`
          );
          return;
        }
        try {
          window.localStorage.removeItem("modelsFromAllProviders");
        } catch {}
        try {
          window.localStorage.setItem(resolvedKey, JSON.stringify(value));
          return;
        } catch (retryError) {
          console.warn(
            `Storage quota exceeded; unable to persist key "${resolvedKey}" after cleanup attempt.`,
            retryError
          );
          return;
        }
      }
      console.error(`Error storing item with key "${resolvedKey}":`, error);
    }
  },
  async removeItem(key: string): Promise<void> {
    if (!canUseLocalStorage()) return;
    const resolvedKey = getScopedStorageKey(key);
    try {
      window.localStorage.removeItem(resolvedKey);
    } catch (error) {
      console.error(`Error removing item with key "${resolvedKey}":`, error);
    }
  },
};
