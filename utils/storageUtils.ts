import { TransactionHistory } from '@/types/chat';
import { DEFAULT_BASE_URLS } from '../lib/utils';
import { useCashuStore } from '../stores/cashuStore';

/**
 * SSR-safe check for localStorage availability
 */
const canUseLocalStorage = (): boolean => {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
};

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
      if (typeof defaultValue === 'string') {
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
        console.error(`Error removing corrupted item with key "${key}":`, removeError);
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
    console.error('Error clearing storage:', error);
  }
};

/**
 * Migrate and fix corrupted storage items
 * This function checks for common storage keys and ensures they're properly JSON formatted
 */
export const migrateStorageItems = (): void => {
  if (!canUseLocalStorage()) return;
  const keysToMigrate = [
    { key: 'base_url', defaultValue: 'https://api.routstr.com/' },
    { key: 'mint_url', defaultValue: 'https://mint.minibits.cash/Bitcoin' },
    { key: 'lastUsedModel', defaultValue: null },
    { key: 'usingNip60', defaultValue: 'true' },
    // Initialize relays list if missing
    { key: 'nostr_relays', defaultValue: [] as string[] }
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
          console.log(`Migrating storage item "${key}" from raw value to JSON format`);
          if (typeof defaultValue === 'string') {
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
  return getStorageItem<TransactionHistory[]>('transaction_history', []);
};

/**
 * Save transaction history to localStorage
 * @param history Array of transaction history
 */
export const saveTransactionHistory = (history: TransactionHistory[]): void => {
  setStorageItem('transaction_history', history);
};

/**
 * Load favorite models from localStorage
 * @returns Array of favorite model IDs
 */
export const loadFavoriteModels = (): string[] => {
  return getStorageItem<string[]>('favorite_models', []);
};

/**
 * Save favorite models to localStorage
 * @param favoriteModels Array of favorite model IDs
 */
export const saveFavoriteModels = (favoriteModels: string[]): void => {
  setStorageItem('favorite_models', favoriteModels);
};

/**
 * Load configured ("My Models") from localStorage with migration from favorites
 * @returns Array of configured model IDs
 */
export const loadConfiguredModels = (): string[] => {
  // New key for configured models
  const configured = getStorageItem<string[]>('configured_models', []);
  if (configured.length > 0) return configured;
  // Migrate from legacy favorites if present
  const legacyFavorites = loadFavoriteModels();
  if (legacyFavorites.length > 0) {
    setStorageItem('configured_models', legacyFavorites);
    return legacyFavorites;
  }
  return [];
};

/**
 * Save configured ("My Models") to localStorage
 * @param configuredModels Array of model IDs
 */
export const saveConfiguredModels = (configuredModels: string[]): void => {
  setStorageItem('configured_models', configuredModels);
};

/**
 * Load mapping of modelId -> provider base URL
 */
export const loadModelProviderMap = (): Record<string, string> => {
  return getStorageItem<Record<string, string>>('model_provider_map', {});
};

/**
 * Save mapping of modelId -> provider base URL
 */
export const saveModelProviderMap = (map: Record<string, string>): void => {
  setStorageItem('model_provider_map', map);
};

/**
 * Load last used model ID from localStorage
 * @returns Last used model ID or null
 */
export const loadLastUsedModel = (): string | null => {
  return getStorageItem<string | null>('lastUsedModel', null);
};

/**
 * Save last used model ID to localStorage
 * @param modelId Model ID to save
 */
export const saveLastUsedModel = (modelId: string): void => {
  setStorageItem('lastUsedModel', modelId);
};

/**
 * Load mint URL from localStorage
 * @param defaultMintUrl Default mint URL to use if none stored
 * @returns Stored or default mint URL
 */
export const loadMintUrl = (defaultMintUrl: string): string => {
  return getStorageItem<string>('mint_url', defaultMintUrl);
};

/**
 * Save mint URL to localStorage
 * @param mintUrl Mint URL to save
 */
export const saveMintUrl = (mintUrl: string): void => {
  setStorageItem('mint_url', mintUrl);
};

/**
 * Load base URL from localStorage
 * @param defaultBaseUrl Default base URL to use if none stored
 * @returns Stored or default base URL (normalized with trailing slash)
 */
export const loadBaseUrl = (defaultBaseUrl: string): string => {
  const baseUrl = getStorageItem<string>('base_url', DEFAULT_BASE_URLS[0]); // Use first default if not set
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
};

/**
 * Save base URL to localStorage
 * @param baseUrl Base URL to save
 */
export const saveBaseUrl = (baseUrl: string): void => {
  setStorageItem('base_url', baseUrl);
};

/**
 * Load and manage the list of base URLs from localStorage.
 * Ensures default URLs are present and handles initialization.
 * @returns Array of base URLs
 */
export const loadBaseUrlsList = (): string[] => {
  let storedBaseUrls = getStorageItem<string[]>(STORAGE_KEYS.BASE_URLS_LIST, []);

  // If no URLs are stored, initialize with default URLs
  if (storedBaseUrls.length === 0) {
    storedBaseUrls = [...DEFAULT_BASE_URLS];
    setStorageItem(STORAGE_KEYS.BASE_URLS_LIST, storedBaseUrls);
  } else {
    // Ensure all default URLs are present in the stored list
    let updated = false;
    DEFAULT_BASE_URLS.forEach(defaultUrl => {
      if (!storedBaseUrls.includes(defaultUrl)) {
        storedBaseUrls.push(defaultUrl);
        updated = true;
      }
    });
    if (updated) {
      setStorageItem(STORAGE_KEYS.BASE_URLS_LIST, storedBaseUrls);
    }
  }
  return storedBaseUrls;
};

/**
 * Save the list of base URLs to localStorage
 * @param baseUrls Array of base URLs to save
 */
export const saveBaseUrlsList = (baseUrls: string[]): void => {
   setStorageItem(STORAGE_KEYS.BASE_URLS_LIST, baseUrls);
 };

 /**
  * Load and manage the list of Nostr relays from localStorage.
  * @returns Array of Nostr relay URLs
  */
 export const loadNostrRelaysList = (): string[] => {
   return getStorageItem<string[]>(STORAGE_KEYS.NOSTR_RELAYS_LIST, []);
 };

 /**
  * Save the list of Nostr relays to localStorage
  * @param relays Array of Nostr relay URLs to save
  */
 export const saveNostrRelaysList = (relays: string[]): void => {
   setStorageItem(STORAGE_KEYS.NOSTR_RELAYS_LIST, relays);
 };

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
  'wss://relay.chorus.community',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

/**
 * Load NIP-60 usage preference from localStorage
 * @returns True if using NIP-60, defaults to true if not set
 */
export const loadUsingNip60 = (): boolean => {
  if (!canUseLocalStorage()) return true;
  const storedValue = localStorage.getItem('usingNip60');
  if (storedValue === null) return true;
  try {
    // Stored value may be a JSON-encoded boolean or a raw string
    return JSON.parse(storedValue);
  } catch {
    // Fallback for legacy "stringified string" format
    return storedValue === 'true';
  }
};

/**
 * Save NIP-60 usage preference to localStorage
 * @param usingNip60 Whether to use NIP-60
 */
export const saveUsingNip60 = (usingNip60: boolean): void => {
  // Persist the raw boolean value to avoid double-encoding issues
  setStorageItem('usingNip60', usingNip60);
};

/**
 * Check if user has seen the tutorial
 * @returns True if tutorial has been seen
 */
export const hasSeenTutorial = (): boolean => {
  return hasStorageItem('hasSeenTutorial');
};

/**
 * Mark tutorial as seen
 */
export const markTutorialAsSeen = (): void => {
  setStorageItem('hasSeenTutorial', 'true');
};

/**
 * Load sidebar open state from localStorage
 * @returns Sidebar open state, defaults to false for first use
 */
export const loadSidebarOpen = (): boolean => {
  return getStorageItem<boolean>('sidebar_open', false);
};

/**
 * Save sidebar open state to localStorage
 * @param isOpen Whether the sidebar is open
 */
export const saveSidebarOpen = (isOpen: boolean): void => {
  setStorageItem('sidebar_open', isOpen);
};

/**
 * Load sidebar collapsed state from localStorage
 * @returns Sidebar collapsed state, defaults to false
 */
export const loadSidebarCollapsed = (): boolean => {
  return getStorageItem<boolean>('sidebar_collapsed', false);
};

/**
 * Save sidebar collapsed state to localStorage
 * @param isCollapsed Whether the sidebar is collapsed
 */
export const saveSidebarCollapsed = (isCollapsed: boolean): void => {
  setStorageItem('sidebar_collapsed', isCollapsed);
};

/**
 * Storage keys used throughout the application
 */
export const STORAGE_KEYS = {
  CONVERSATIONS: 'saved_conversations',
  TRANSACTION_HISTORY: 'transaction_history',
  FAVORITE_MODELS: 'favorite_models',
  CONFIGURED_MODELS: 'configured_models',
  MODEL_PROVIDER_MAP: 'model_provider_map',
  LAST_USED_MODEL: 'lastUsedModel',
  MINT_URL: 'mint_url',
  BASE_URL: 'base_url',
  BASE_URLS_LIST: 'base_urls_list',
  NOSTR_RELAYS_LIST: 'nostr_relays_list', // New key for Nostr relays
  USING_NIP60: 'usingNip60',
  TUTORIAL_SEEN: 'hasSeenTutorial',
  SIDEBAR_OPEN: 'sidebar_open',
  SIDEBAR_COLLAPSED: 'sidebar_collapsed',
  LOCAL_CASHU_TOKENS: 'local_cashu_tokens',
  CASHU_PROOFS: 'cashu_proofs',
  WRAPPED_CASHU_TOKENS: 'wrapped_cashu_tokens',
  RELAYS: 'nostr_relays'
} as const;

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
  const existingIndex = tokens.findIndex(entry => entry.baseUrl === baseUrl);

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
  const entry = tokens.find(entry => entry.baseUrl === baseUrl);
  return entry ? entry.token : null;
};

/**
 * Removes a Cashu token for a specific base URL.
 * @param baseUrl The base URL of the token to remove.
 */
export const removeLocalCashuToken = (baseUrl: string): void => {
  const tokens = getLocalCashuTokens();
  const updatedTokens = tokens.filter(entry => entry.baseUrl !== baseUrl);
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
    const currentToken = localStorage.getItem('current_cashu_token');
    if (currentToken) {
      console.log('Migrating current_cashu_token to local_cashu_tokens format...');
      setLocalCashuToken(baseUrl, currentToken);
      localStorage.removeItem('current_cashu_token');
      console.log('Migration complete: current_cashu_token moved to local_cashu_tokens.');
    }
  } catch (error) {
    console.error('Error migrating current_cashu_token:', error);
  }
};