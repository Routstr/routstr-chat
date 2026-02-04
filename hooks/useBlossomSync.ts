import { useState, useCallback, useSyncExternalStore } from "react";
import {
  uploadBlobToMultiple,
  getBlob,
  fileToUint8Array,
  DEFAULT_BLOSSOM_SERVERS,
  BlossomSigner,
} from "@/lib/blossom";
import { encryptBlob, decryptBlob } from "@/utils/blobEncryption";
import { PnsKeys } from "@/lib/pns";
import { getStorageItem, setStorageItem } from "@/utils/storageUtils";
import { finalizeEvent } from "nostr-tools";

// ============================================================================
// Storage Keys & State Management
// ============================================================================

const BLOSSOM_SYNC_ENABLED_KEY = "blossomSyncEnabled";
const BLOSSOM_SERVERS_KEY = "blossomServers";

// Subscribers for storage changes
const blossomSyncSubscribers = new Set<() => void>();

// Cached values for useSyncExternalStore (arrays need stable references)
let cachedBlossomServers: string[] = DEFAULT_BLOSSOM_SERVERS;
let cachedBlossomServersJson: string = JSON.stringify(DEFAULT_BLOSSOM_SERVERS);

// Subscribe function for useSyncExternalStore
const subscribeToBlossomSync = (callback: () => void) => {
  blossomSyncSubscribers.add(callback);

  const handleStorage = (e: StorageEvent) => {
    if (e.key === BLOSSOM_SYNC_ENABLED_KEY || e.key === BLOSSOM_SERVERS_KEY) {
      callback();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    blossomSyncSubscribers.delete(callback);
    window.removeEventListener("storage", handleStorage);
  };
};

// Get current enabled value from localStorage
const getBlossomSyncEnabledSnapshot = (): boolean => {
  return getStorageItem<boolean>(BLOSSOM_SYNC_ENABLED_KEY, true);
};

// Get current servers from localStorage (with stable reference)
const getBlossomServersSnapshot = (): string[] => {
  const servers = getStorageItem<string[]>(
    BLOSSOM_SERVERS_KEY,
    DEFAULT_BLOSSOM_SERVERS
  );
  const serversJson = JSON.stringify(servers);

  // Only return a new reference if the value actually changed
  if (serversJson !== cachedBlossomServersJson) {
    cachedBlossomServers = servers;
    cachedBlossomServersJson = serversJson;
  }

  return cachedBlossomServers;
};

// Server snapshots (for SSR)
const getBlossomSyncEnabledServerSnapshot = (): boolean => true;
const getBlossomServersServerSnapshot = (): string[] => DEFAULT_BLOSSOM_SERVERS;

// Global setters that notify subscribers
const setBlossomSyncEnabledGlobal = (enabled: boolean): void => {
  setStorageItem(BLOSSOM_SYNC_ENABLED_KEY, enabled);
  blossomSyncSubscribers.forEach((callback) => callback());
};

const setBlossomServersGlobal = (servers: string[]): void => {
  setStorageItem(BLOSSOM_SERVERS_KEY, servers);
  // Update cache immediately to ensure consistency
  cachedBlossomServers = servers;
  cachedBlossomServersJson = JSON.stringify(servers);
  blossomSyncSubscribers.forEach((callback) => callback());
};

// ============================================================================
// Types
// ============================================================================

export interface BlossomUploadResult {
  hash: string;
  servers: string[];
}

export interface BlossomSyncHook {
  // Enable/disable sync
  blossomSyncEnabled: boolean;
  setBlossomSyncEnabled: (enabled: boolean) => void;

  // Server configuration
  blossomServers: string[];
  setBlossomServers: (servers: string[]) => void;

  // Upload a file to Blossom (encrypted)
  uploadToBlossomAsync: (
    file: File,
    pnsKeys: PnsKeys
  ) => Promise<BlossomUploadResult | null>;

  // Fetch and decrypt from Blossom
  fetchFromBlossom: (
    blossomHash: string,
    pnsKeys: PnsKeys,
    servers?: string[]
  ) => Promise<{ data: Uint8Array; mimeType: string } | null>;

  // Upload progress tracking
  uploadProgress: Map<string, number>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export const useBlossomSync = (): BlossomSyncHook => {
  const [uploadProgress] = useState<Map<string, number>>(new Map());

  // Use useSyncExternalStore to share state across all hook instances
  const blossomSyncEnabled = useSyncExternalStore(
    subscribeToBlossomSync,
    getBlossomSyncEnabledSnapshot,
    getBlossomSyncEnabledServerSnapshot
  );

  const blossomServers = useSyncExternalStore(
    subscribeToBlossomSync,
    getBlossomServersSnapshot,
    getBlossomServersServerSnapshot
  );

  const setBlossomSyncEnabled = useCallback((enabled: boolean) => {
    setBlossomSyncEnabledGlobal(enabled);
  }, []);

  const setBlossomServers = useCallback((servers: string[]) => {
    setBlossomServersGlobal(servers);
  }, []);

  /**
   * Upload a file to Blossom with encryption
   */
  const uploadToBlossomAsync = useCallback(
    async (
      file: File,
      pnsKeys: PnsKeys
    ): Promise<BlossomUploadResult | null> => {
      try {
        // Convert file to Uint8Array
        const fileData = await fileToUint8Array(file);

        // Encrypt the file data
        const encryptedData = encryptBlob(fileData, file.type, pnsKeys.pnsKey);

        // Create a signer adapter for the Blossom upload using PNS private key
        const blossomSigner: BlossomSigner = {
          getPublicKey: async () => pnsKeys.pnsKeypair.pubKey,
          signEvent: async (event) => {
            return finalizeEvent(event, pnsKeys.pnsKeypair.privKey);
          },
        };

        // Upload to multiple servers for redundancy
        const result = await uploadBlobToMultiple(
          encryptedData,
          "application/octet-stream", // Encrypted blobs are always binary
          blossomSigner,
          blossomServers
        );

        if (result) {
          console.log(
            `Blossom upload success: ${result.hash} to ${result.servers.length} server(s)`
          );
        }

        return result;
      } catch (error) {
        console.error("Blossom upload failed:", error);
        return null;
      }
    },
    [blossomServers]
  );

  /**
   * Fetch and decrypt a blob from Blossom
   */
  const fetchFromBlossom = useCallback(
    async (
      blossomHash: string,
      pnsKeys: PnsKeys,
      servers?: string[]
    ): Promise<{ data: Uint8Array; mimeType: string } | null> => {
      try {
        // Try to fetch from provided servers or defaults
        const serversToTry =
          servers && servers.length > 0 ? servers : blossomServers;
        const encryptedData = await getBlob(blossomHash, serversToTry);

        if (!encryptedData) {
          console.warn(`Blob ${blossomHash} not found on any server`);
          return null;
        }

        // Decrypt the blob
        const decrypted = decryptBlob(encryptedData, pnsKeys.pnsKey);
        if (!decrypted) {
          console.error(`Failed to decrypt blob ${blossomHash}`);
          return null;
        }

        console.log(
          `Blossom fetch success: ${blossomHash} (${decrypted.data.length} bytes)`
        );
        return decrypted;
      } catch (error) {
        console.error("Blossom fetch failed:", error);
        return null;
      }
    },
    [blossomServers]
  );

  return {
    blossomSyncEnabled,
    setBlossomSyncEnabled,
    blossomServers,
    setBlossomServers,
    uploadToBlossomAsync,
    fetchFromBlossom,
    uploadProgress,
  };
};
