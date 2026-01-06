import { TransactionHistory } from "@/types/chat";
import { useCashuStore } from "@/features/wallet/state/cashuStore";

/**
 * SSR-safe check for localStorage availability
 */
const canUseLocalStorage = (): boolean => {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
};

/**
 * Identify quota exceeded errors across browsers
 */
const isQuotaExceeded = (error: unknown): boolean => {
  const e = error as any;
  // name: 'QuotaExceededError' (standard),
  // code: 22 (Safari), 1014 (Firefox)
  return (
    !!e &&
    (e?.name === "QuotaExceededError" || e?.code === 22 || e?.code === 1014)
  );
};

/**
 * Keys that are safe to skip persisting when storage is full
 */
const NON_CRITICAL_STORAGE_KEYS = new Set<string>(["modelsFromAllProviders"]);

/**
 * Interface for a stored Cashu token entry
 */
export interface CashuTokenEntry {
  token: string;
  baseUrl: string;
}

/**
 * Generic localStorage helper with error handling
 * @param key Storage key
 * @param value Value to store (will be JSON stringified)
 */
export const setStorageItem = <T>(key: string, value: T): void => {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Handle storage full scenarios gracefully
    if (isQuotaExceeded(error)) {
      // If the key is non-critical (cache-like), skip persisting silently
      if (NON_CRITICAL_STORAGE_KEYS.has(key)) {
        console.warn(
          `Storage quota exceeded; skipping non-critical key "${key}".`
        );
        return;
      }
      // Attempt minimal cleanup: remove known large, non-critical caches then retry once
      try {
        localStorage.removeItem("modelsFromAllProviders");
      } catch {}
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return;
      } catch (retryError) {
        console.warn(
          `Storage quota exceeded; unable to persist key "${key}" after cleanup attempt.`,
          retryError
        );
        return;
      }
    }
    console.error(`Error storing item with key "${key}":`, error);
  }
};

/**
 * Generic localStorage getter with error handling and type safety
 * @param key Storage key
 * @param defaultValue Default value to return if key not found or parsing fails
 * @returns Parsed value or default value
 */
export const getStorageItem = <T>(key: string, defaultValue: T): T => {
  if (!canUseLocalStorage()) return defaultValue;
  try {
    const item = localStorage.getItem(key);
    if (item === null) return defaultValue;

    // Try to parse as JSON first
    try {
      return JSON.parse(item);
    } catch (parseError) {
      // If JSON parsing fails, check if it's a string type and return the raw value
      if (typeof defaultValue === "string") {
        return item as T;
      }
      // For non-string types, throw the original parse error
      throw parseError;
    }
  } catch (error) {
    console.error(`Error retrieving item with key "${key}":`, error);
    // Clear the corrupted item from storage
    if (canUseLocalStorage()) {
      try {
        localStorage.removeItem(key);
      } catch (removeError) {
        console.error(
          `Error removing corrupted item with key "${key}":`,
          removeError
        );
      }
    }
    return defaultValue;
  }
};

/**
 * Remove an item from localStorage
 * @param key Storage key to remove
 */
export const removeStorageItem = (key: string): void => {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`Error removing item with key "${key}":`, error);
  }
};

/**
 * Check if a key exists in localStorage
 * @param key Storage key to check
 * @returns True if key exists, false otherwise
 */
export const hasStorageItem = (key: string): boolean => {
  if (!canUseLocalStorage()) return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch (error) {
    console.error(`Error checking existence of key "${key}":`, error);
    return false;
  }
};

/**
 * Clear all localStorage items and Cashu store (use with caution)
 */
export const clearAllStorage = (): void => {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.clear();
    // Also clear the Cashu store
    useCashuStore.getState().clearStore();
  } catch (error) {
    console.error("Error clearing storage:", error);
  }
};

/**
 * Migrate and fix corrupted storage items
 * This function checks for common storage keys and ensures they're properly JSON formatted
 */
export const migrateStorageItems = (): void => {
  if (!canUseLocalStorage()) return;
  const keysToMigrate = [
    { key: "base_url", defaultValue: "" },
    { key: "mint_url", defaultValue: "https://mint.minibits.cash/Bitcoin" },
    { key: "lastUsedModel", defaultValue: null },
    { key: "usingNip60", defaultValue: "true" },
    // Initialize relays list if missing
    { key: "nostr_relays", defaultValue: [] as string[] },
  ];

  keysToMigrate.forEach(({ key, defaultValue }) => {
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        try {
          // Try to parse the item
          JSON.parse(item);
          // If parsing succeeds, the item is already properly formatted
        } catch (parseError) {
          // If parsing fails, re-save the item with proper JSON formatting
          console.log(
            `Migrating storage item "${key}" from raw value to JSON format`
          );
          if (typeof defaultValue === "string") {
            setStorageItem(key, item); // Re-save the raw string value as JSON
          } else {
            setStorageItem(key, defaultValue); // Use default value if type mismatch
          }
        }
      }
    } catch (error) {
      console.error(`Error migrating storage item "${key}":`, error);
      // If there's any error, just set the default value
      setStorageItem(key, defaultValue);
    }
  });
};

// Specific storage utilities for the chat app

/**
 * Load transaction history from localStorage
 * @returns Array of transaction history or empty array
 */
export const loadTransactionHistory = (): TransactionHistory[] => {
  return getStorageItem<TransactionHistory[]>("transaction_history", []);
};

/**
 * Save transaction history to localStorage
 * @param history Array of transaction history
 */
export const saveTransactionHistory = (history: TransactionHistory[]): void => {
  setStorageItem("transaction_history", history);
};

/**
 * Load favorite models from localStorage
 * @returns Array of favorite model IDs
 */
export const loadFavoriteModels = (): string[] => {
  return getStorageItem<string[]>("favorite_models", []);
};

/**
 * Save favorite models to localStorage
 * @param favoriteModels Array of favorite model IDs
 */
export const saveFavoriteModels = (favoriteModels: string[]): void => {
  setStorageItem("favorite_models", favoriteModels);
};

/**
 * Load configured ("My Models") from localStorage with migration from favorites
 * @returns Array of configured model IDs
 */
export const loadConfiguredModels = (): string[] => {
  // New key for configured models
  if (hasStorageItem("configured_models")) {
    return getStorageItem<string[]>("configured_models", []);
  }

  // Migrate from legacy favorites if present
  const legacyFavorites = loadFavoriteModels();
  if (legacyFavorites.length > 0) {
    setStorageItem("configured_models", legacyFavorites);
    return legacyFavorites;
  }

  return [];
};

/**
 * Save configured ("My Models") to localStorage
 * @param configuredModels Array of model IDs
 */
export const saveConfiguredModels = (configuredModels: string[]): void => {
  setStorageItem("configured_models", configuredModels);
};

/**
 * Load mapping of modelId -> provider base URL
 */
export const loadModelProviderMap = (): Record<string, string> => {
  return getStorageItem<Record<string, string>>("model_provider_map", {});
};

/**
 * Save mapping of modelId -> provider base URL
 */
export const saveModelProviderMap = (map: Record<string, string>): void => {
  setStorageItem("model_provider_map", map);
};

/**
 * Load last used model ID from localStorage
 * @returns Last used model ID or null
 */
export const loadLastUsedModel = (): string | null => {
  return getStorageItem<string | null>("lastUsedModel", null);
};

/**
 * Save last used model ID to localStorage
 * @param modelId Model ID to save
 */
export const saveLastUsedModel = (modelId: string): void => {
  setStorageItem("lastUsedModel", modelId);
};

/**
 * Load mint URL from localStorage
 * @param defaultMintUrl Default mint URL to use if none stored
 * @returns Stored or default mint URL
 */
export const loadMintUrl = (defaultMintUrl: string): string => {
  return getStorageItem<string>("mint_url", defaultMintUrl);
};

/**
 * Save mint URL to localStorage
 * @param mintUrl Mint URL to save
 */
export const saveMintUrl = (mintUrl: string): void => {
  setStorageItem("mint_url", mintUrl);
};

/**
 * Load base URL from localStorage
 * @param defaultBaseUrl Default base URL to use if none stored
 * @returns Stored or default base URL (normalized with trailing slash)
 */
export const loadBaseUrl = (defaultBaseUrl: string): string => {
  const baseUrl = getStorageItem<string>("base_url", defaultBaseUrl);
  // If nothing set, return empty string (no default base URL)
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
};

/**
 * Save base URL to localStorage
 * @param baseUrl Base URL to save
 */
export const saveBaseUrl = (baseUrl: string): void => {
  setStorageItem("base_url", baseUrl);
};

/**
 * Load and manage the list of base URLs from localStorage.
 * Ensures default URLs are present and handles initialization.
 * @returns Array of base URLs
 */
export const loadBaseUrlsList = (): string[] => {
  // Load persisted list; no code-level defaults
  return getStorageItem<string[]>(STORAGE_KEYS.BASE_URLS_LIST, []);
};

/**
 * Save the list of base URLs to localStorage
 * @param baseUrls Array of base URLs to save
 */
export const saveBaseUrlsList = (baseUrls: string[]): void => {
  setStorageItem(STORAGE_KEYS.BASE_URLS_LIST, baseUrls);
};

// Removed unused: loadNostrRelaysList, saveNostrRelaysList

/**
 * Load configured Nostr relays from storage
 */
export const loadRelays = (): string[] => {
  return getStorageItem<string[]>(STORAGE_KEYS.RELAYS, []);
};

/**
 * Save Nostr relays to storage
 */
export const saveRelays = (relays: string[]): void => {
  setStorageItem(STORAGE_KEYS.RELAYS, relays);
};

/**
 * Default relays for reset-to-default action
 */
export const DEFAULT_RELAYS: readonly string[] = [
  "wss://relay.chorus.community",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
];

/**
 * Load NIP-60 usage preference from localStorage
 * @returns True if using NIP-60, defaults to true if not set
 */
export const loadUsingNip60 = (): boolean => {
  if (!canUseLocalStorage()) return true;
  const storedValue = localStorage.getItem("usingNip60");
  if (storedValue === null) return true;
  try {
    // Stored value may be a JSON-encoded boolean or a raw string
    return JSON.parse(storedValue);
  } catch {
    // Fallback for legacy "stringified string" format
    return storedValue === "true";
  }
};

/**
 * Save NIP-60 usage preference to localStorage
 * @param usingNip60 Whether to use NIP-60
 */
export const saveUsingNip60 = (usingNip60: boolean): void => {
  // Persist the raw boolean value to avoid double-encoding issues
  setStorageItem("usingNip60", usingNip60);
};

/**
 * Check if user has seen the top-up prompt
 * @returns True if top-up prompt has been seen
 */
export const hasSeenTopUpPrompt = (): boolean => {
  return getStorageItem<boolean>(STORAGE_KEYS.TOPUP_PROMPT_SEEN, false);
};

/**
 * Mark top-up prompt as seen
 */
export const markTopUpPromptSeen = (): void => {
  setStorageItem(STORAGE_KEYS.TOPUP_PROMPT_SEEN, true);
};

export const hasCreatedEphemeralNsec = (): boolean => {
  return getStorageItem<boolean>(STORAGE_KEYS.CREATED_EPHEMERAL_NSEC, false);
};

export const markEphemeralNsecCreated = (): void => {
  setStorageItem(STORAGE_KEYS.CREATED_EPHEMERAL_NSEC, true);
};

export const markEphemeralNsecDeleted = (): void => {
  setStorageItem(STORAGE_KEYS.CREATED_EPHEMERAL_NSEC, false);
};

/**
 * Load sidebar open state from localStorage
 * @returns Sidebar open state, defaults to false for first use
 */
export const loadSidebarOpen = (): boolean => {
  return getStorageItem<boolean>("sidebar_open", false);
};

/**
 * Save sidebar open state to localStorage
 * @param isOpen Whether the sidebar is open
 */
export const saveSidebarOpen = (isOpen: boolean): void => {
  setStorageItem("sidebar_open", isOpen);
};

/**
 * Load sidebar collapsed state from localStorage
 * @returns Sidebar collapsed state, defaults to false
 */
export const loadSidebarCollapsed = (): boolean => {
  return getStorageItem<boolean>("sidebar_collapsed", true);
};

/**
 * Save sidebar collapsed state to localStorage
 * @param isCollapsed Whether the sidebar is collapsed
 */
export const saveSidebarCollapsed = (isCollapsed: boolean): void => {
  setStorageItem("sidebar_collapsed", isCollapsed);
};

/**
 * Load active conversation ID from localStorage
 * @returns Active conversation ID or null
 */
export const loadActiveConversationId = (): string | null => {
  return getStorageItem<string | null>(
    STORAGE_KEYS.ACTIVE_CONVERSATION_ID,
    null
  );
};

/**
 * Save active conversation ID to localStorage
 * @param conversationId Conversation ID to save
 */
export const saveActiveConversationId = (
  conversationId: string | null
): void => {
  setStorageItem(STORAGE_KEYS.ACTIVE_CONVERSATION_ID, conversationId);
};

/**
 * Storage keys used throughout the application
 */
export const STORAGE_KEYS = {
  CONVERSATIONS: "saved_conversations",
  ACTIVE_CONVERSATION_ID: "active_conversation_id",
  TRANSACTION_HISTORY: "transaction_history",
  FAVORITE_MODELS: "favorite_models",
  CONFIGURED_MODELS: "configured_models",
  MODEL_PROVIDER_MAP: "model_provider_map",
  LAST_USED_MODEL: "lastUsedModel",
  MINT_URL: "mint_url",
  BASE_URL: "base_url",
  BASE_URLS_LIST: "base_urls_list",
  USING_NIP60: "usingNip60",
  SIDEBAR_OPEN: "sidebar_open",
  SIDEBAR_COLLAPSED: "sidebar_collapsed",
  LOCAL_CASHU_TOKENS: "local_cashu_tokens",
  CASHU_PROOFS: "cashu_proofs",
  WRAPPED_CASHU_TOKENS: "wrapped_cashu_tokens",
  RELAYS: "nostr_relays",
  TOPUP_PROMPT_SEEN: "topup_prompt_seen",
  CREATED_EPHEMERAL_NSEC: "created_ephemeral_nsec",
  DISABLED_PROVIDERS: "disabled_providers",
  MINTS_FROM_ALL_PROVIDERS: "mints_from_all_providers",
  INFO_FROM_ALL_PROVIDERS: "info_from_all_providers",
  LAST_MODELS_UPDATE: "lastModelsUpdate",
  AUTO_DELETE_CONVERSATIONS: "auto_delete_conversations",
  KEEP_ALIVE_ENABLED: "keep_alive_enabled",
} as const;

/**
 * Load auto-delete conversations preference from localStorage
 * @returns True if auto-delete is enabled, defaults to false
 */
export const loadAutoDeleteConversations = (): boolean => {
  return getStorageItem<boolean>(STORAGE_KEYS.AUTO_DELETE_CONVERSATIONS, false);
};

/**
 * Save auto-delete conversations preference to localStorage
 * @param enabled Whether auto-delete is enabled
 */
export const saveAutoDeleteConversations = (enabled: boolean): void => {
  setStorageItem(STORAGE_KEYS.AUTO_DELETE_CONVERSATIONS, enabled);
};

/**
 * Load keep-alive (background audio) preference from localStorage
 * @returns True if keep-alive is enabled, defaults to false
 */
export const loadKeepAliveEnabled = (): boolean => {
  return getStorageItem<boolean>(STORAGE_KEYS.KEEP_ALIVE_ENABLED, false);
};

/**
 * Save keep-alive (background audio) preference to localStorage
 * @param enabled Whether keep-alive is enabled
 */
export const saveKeepAliveEnabled = (enabled: boolean): void => {
  setStorageItem(STORAGE_KEYS.KEEP_ALIVE_ENABLED, enabled);
};

/**
 * Retrieves all stored Cashu tokens.
 * @returns An array of CashuTokenEntry objects.
 */
export const getLocalCashuTokens = (): CashuTokenEntry[] => {
  return getStorageItem<CashuTokenEntry[]>(STORAGE_KEYS.LOCAL_CASHU_TOKENS, []);
};

/**
 * Stores or updates a Cashu token for a specific base URL.
 * If a token for the given base URL already exists, it will be updated.
 * Otherwise, a new entry will be added.
 * @param baseUrl The base URL associated with the token.
 * @param token The Cashu token string.
 */
export const setLocalCashuToken = (baseUrl: string, token: string): void => {
  const tokens = getLocalCashuTokens();
  const existingIndex = tokens.findIndex((entry) => entry.baseUrl === baseUrl);

  if (existingIndex !== -1) {
    tokens[existingIndex] = { baseUrl, token };
  } else {
    tokens.push({ baseUrl, token });
  }
  setStorageItem(STORAGE_KEYS.LOCAL_CASHU_TOKENS, tokens);
};

/**
 * Retrieves a Cashu token for a specific base URL.
 * @param baseUrl The base URL to retrieve the token for.
 * @returns The Cashu token string, or null if not found.
 */
export const getLocalCashuToken = (baseUrl: string): string | null => {
  const tokens = getLocalCashuTokens();
  const entry = tokens.find((entry) => entry.baseUrl === baseUrl);
  return entry ? entry.token : null;
};

/**
 * Removes a Cashu token for a specific base URL.
 * @param baseUrl The base URL of the token to remove.
 */
export const removeLocalCashuToken = (baseUrl: string): void => {
  const tokens = getLocalCashuTokens();
  const updatedTokens = tokens.filter((entry) => entry.baseUrl !== baseUrl);
  setStorageItem(STORAGE_KEYS.LOCAL_CASHU_TOKENS, updatedTokens);
};

/**
 * Migrates the old 'current_cashu_token' to the new 'local_cashu_tokens' format.
 * This function should be called once to ensure backward compatibility.
 * @param baseUrl The base URL to associate with the migrated token.
 */
export const migrateCurrentCashuToken = (baseUrl: string): void => {
  if (!canUseLocalStorage()) return;
  try {
    const currentToken = localStorage.getItem("current_cashu_token");
    if (currentToken) {
      console.log(
        "Migrating current_cashu_token to local_cashu_tokens format..."
      );
      setLocalCashuToken(baseUrl, currentToken);
      localStorage.removeItem("current_cashu_token");
      console.log(
        "Migration complete: current_cashu_token moved to local_cashu_tokens."
      );
    }
  } catch (error) {
    console.error("Error migrating current_cashu_token:", error);
  }
};

/**
 * Load disabled providers from localStorage
 * @returns Array of disabled provider base URLs
 */
export const loadDisabledProviders = (): string[] => {
  const providers = getStorageItem<string[]>(
    STORAGE_KEYS.DISABLED_PROVIDERS,
    []
  );
  if (!providers.includes("https://api.nonkycai.com/")) {
    providers.push("https://api.nonkycai.com/");
  }
  return providers;
};

/**
 * Save disabled providers to localStorage
 * @param disabledProviders Array of disabled provider base URLs
 */
export const saveDisabledProviders = (disabledProviders: string[]): void => {
  setStorageItem(STORAGE_KEYS.DISABLED_PROVIDERS, disabledProviders);
};

/**
 * Load mints from all providers
 * @returns Record mapping provider base URL to array of mint URLs
 */
export const loadMintsFromAllProviders = (): Record<string, string[]> => {
  const allProviderMints = getStorageItem<Record<string, string[]>>(
    STORAGE_KEYS.MINTS_FROM_ALL_PROVIDERS,
    {}
  );
  const normalizedMints = Object.entries(allProviderMints).map(
    ([baseUrl, mints]) => {
      const normalizedMints = mints.map((mint) =>
        mint.endsWith("/") ? mint.slice(0, -1) : mint
      );
      return [baseUrl, normalizedMints];
    }
  );
  return Object.fromEntries(normalizedMints);
};

/**
 * Save mints from all providers to localStorage
 * @param mintsMap Record mapping provider base URL to array of mint URLs
 */
export const saveMintsFromAllProviders = (
  mintsMap: Record<string, string[]>
): void => {
  setStorageItem(STORAGE_KEYS.MINTS_FROM_ALL_PROVIDERS, mintsMap);
};

/**
 * Get mints for a specific provider
 * @param providerBaseUrl Provider base URL
 * @returns Array of mint URLs for the provider
 */
export const getProviderMints = (providerBaseUrl: string): string[] => {
  const allMints = loadMintsFromAllProviders();
  const normalized = providerBaseUrl.endsWith("/")
    ? providerBaseUrl
    : `${providerBaseUrl}/`;
  return allMints[normalized] || [];
};

/**
 * Set mints for a specific provider
 * @param providerBaseUrl Provider base URL
 * @param mints Array of mint URLs
 */
export const setProviderMints = (
  providerBaseUrl: string,
  mints: string[]
): void => {
  const allMints = loadMintsFromAllProviders();
  const normalized = providerBaseUrl.endsWith("/")
    ? providerBaseUrl
    : `${providerBaseUrl}/`;
  allMints[normalized] = mints;
  saveMintsFromAllProviders(allMints);
};

/**
 * Load full /v1/info responses from all providers
 * @returns Record mapping provider base URL to info object
 */
export const loadInfoFromAllProviders = (): Record<string, any> => {
  return getStorageItem<Record<string, any>>(
    STORAGE_KEYS.INFO_FROM_ALL_PROVIDERS,
    {}
  );
};

/**
 * Save full /v1/info responses from all providers to localStorage
 * @param infoMap Record mapping provider base URL to info object
 */
export const saveInfoFromAllProviders = (
  infoMap: Record<string, any>
): void => {
  setStorageItem(STORAGE_KEYS.INFO_FROM_ALL_PROVIDERS, infoMap);
};
/**
 * Get cached /v1/info for a single provider, otherwise fetch and cache it.
 * @param providerBaseUrl Provider base URL (with or without trailing slash)
 * @param forceRefresh When true, ignores cache and fetches fresh info
 * @returns The provider info object, or null on failure
 */
export const getOrFetchProviderInfo = async (
  providerBaseUrl: string,
  forceRefresh: boolean = false
): Promise<any | null> => {
  const base = providerBaseUrl.endsWith("/")
    ? providerBaseUrl
    : `${providerBaseUrl}/`;

  if (!forceRefresh) {
    const cachedAll = loadInfoFromAllProviders();
    const cached = cachedAll[base];
    if (cached) {
      return cached;
    }
  }

  try {
    const res = await fetch(`${base}v1/info`);
    if (!res.ok) throw new Error(`Failed ${res.status}`);
    const json = await res.json();

    // Cache into INFO_FROM_ALL_PROVIDERS
    const allInfo = loadInfoFromAllProviders();
    allInfo[base] = json;
    saveInfoFromAllProviders(allInfo);

    return json;
  } catch (error) {
    console.warn(`Failed to fetch provider info from ${base}:`, error);
    return null;
  }
};

/**
 * Load the timestamps of the last models update from localStorage
 * @returns Record mapping provider base URL to timestamp in milliseconds
 */
export const loadLastModelsUpdate = (): Record<string, number> => {
  return getStorageItem<Record<string, number>>(
    STORAGE_KEYS.LAST_MODELS_UPDATE,
    {}
  );
};

/**
 * Save the timestamps of the last models update to localStorage
 * @param timestampsMap Record mapping provider base URL to timestamp in milliseconds
 */
export const saveLastModelsUpdate = (
  timestampsMap: Record<string, number>
): void => {
  setStorageItem(STORAGE_KEYS.LAST_MODELS_UPDATE, timestampsMap);
};

/**
 * Get the last update timestamp for a specific provider
 * @param providerBaseUrl Provider base URL
 * @returns Timestamp in milliseconds or null if never updated
 */
export const getProviderLastUpdate = (
  providerBaseUrl: string
): number | null => {
  const allTimestamps = loadLastModelsUpdate();
  const normalized = providerBaseUrl.endsWith("/")
    ? providerBaseUrl
    : `${providerBaseUrl}/`;
  return allTimestamps[normalized] || null;
};

/**
 * Set the last update timestamp for a specific provider
 * @param providerBaseUrl Provider base URL
 * @param timestamp Timestamp in milliseconds
 */
export const setProviderLastUpdate = (
  providerBaseUrl: string,
  timestamp: number
): void => {
  const allTimestamps = loadLastModelsUpdate();
  const normalized = providerBaseUrl.endsWith("/")
    ? providerBaseUrl
    : `${providerBaseUrl}/`;
  allTimestamps[normalized] = timestamp;
  saveLastModelsUpdate(allTimestamps);
};

// ============================================
// Auto-Refill Settings
// ============================================

/**
 * Settings for NWC (Nostr Wallet Connect) auto-refill
 */
export interface AutoRefillNWCSettings {
  enabled: boolean;
  threshold: number; // sats - refill when balance drops below this
  amount: number; // sats - amount to refill each time
  lastRefillAt?: number; // timestamp of last refill (for cooldown)
}

/**
 * Settings for API key auto-topup
 */
export interface AutoTopupAPISettings {
  enabled: boolean;
  apiKey: string | null; // which API key to auto-topup (the key string)
  threshold: number; // mSats - topup when balance drops below this
  amount: number; // sats - amount to topup each time
  lastTopupAt?: number; // timestamp of last topup (for cooldown)
}

/**
 * Default NWC auto-refill settings
 */
export const DEFAULT_AUTO_REFILL_NWC_SETTINGS: AutoRefillNWCSettings = {
  enabled: false,
  threshold: 500, // refill when below 500 sats
  amount: 1000, // refill with 1000 sats
};

/**
 * Default API auto-topup settings
 */
export const DEFAULT_AUTO_TOPUP_API_SETTINGS: AutoTopupAPISettings = {
  enabled: false,
  apiKey: null,
  threshold: 500000, // 500 sats in mSats (API balances are in mSats)
  amount: 1000, // topup with 1000 sats
};

/**
 * Load NWC auto-refill settings from localStorage
 * @returns NWC auto-refill settings
 */
export const loadAutoRefillNWCSettings = (): AutoRefillNWCSettings => {
  return getStorageItem<AutoRefillNWCSettings>(
    "auto_refill_nwc_settings",
    DEFAULT_AUTO_REFILL_NWC_SETTINGS
  );
};

/**
 * Save NWC auto-refill settings to localStorage
 * @param settings NWC auto-refill settings
 */
export const saveAutoRefillNWCSettings = (
  settings: AutoRefillNWCSettings
): void => {
  setStorageItem("auto_refill_nwc_settings", settings);
};

/**
 * Load API auto-topup settings from localStorage
 * @returns API auto-topup settings
 */
export const loadAutoTopupAPISettings = (): AutoTopupAPISettings => {
  return getStorageItem<AutoTopupAPISettings>(
    "auto_topup_api_settings",
    DEFAULT_AUTO_TOPUP_API_SETTINGS
  );
};

/**
 * Save API auto-topup settings to localStorage
 * @param settings API auto-topup settings
 */
export const saveAutoTopupAPISettings = (
  settings: AutoTopupAPISettings
): void => {
  setStorageItem("auto_topup_api_settings", settings);
};

/**
 * Update the last refill timestamp for NWC auto-refill
 * @param timestamp Timestamp in milliseconds
 */
export const updateNWCLastRefillTime = (
  timestamp: number = Date.now()
): void => {
  const settings = loadAutoRefillNWCSettings();
  saveAutoRefillNWCSettings({ ...settings, lastRefillAt: timestamp });
};

/**
 * Update the last topup timestamp for API auto-topup
 * @param timestamp Timestamp in milliseconds
 */
export const updateAPILastTopupTime = (
  timestamp: number = Date.now()
): void => {
  const settings = loadAutoTopupAPISettings();
  saveAutoTopupAPISettings({ ...settings, lastTopupAt: timestamp });
};

// ============================================
// Sats Spent Storage (per message)
// ============================================

const SATS_SPENT_STORAGE_KEY = "sats_spent_by_event";

/**
 * Load sats spent map from localStorage
 * @returns Map of eventId -> satsSpent
 */
export const loadSatsSpentMap = (): Record<string, number> => {
  return getStorageItem<Record<string, number>>(SATS_SPENT_STORAGE_KEY, {});
};

/**
 * Save sats spent for a specific event
 * @param eventId The event ID of the message
 * @param satsSpent The amount of sats spent
 */
export const saveSatsSpent = (eventId: string, satsSpent: number): void => {
  const map = loadSatsSpentMap();
  map[eventId] = satsSpent;
  setStorageItem(SATS_SPENT_STORAGE_KEY, map);
};

/**
 * Get sats spent for a specific event
 * @param eventId The event ID of the message
 * @returns The sats spent or undefined if not found
 */
export const getSatsSpent = (eventId: string): number | undefined => {
  const map = loadSatsSpentMap();
  return map[eventId];
};
