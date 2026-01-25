/**
 * Hook to fetch and manage user's API keys synced with the cloud
 *
 * Uses the generic config sync system with applesauce relayPool.
 */

import { toast } from "sonner";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { StoredApiKey } from "@/components/settings/ApiKeysTab";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  apiKeys$,
  configSyncLoading$,
  genericConfigSync$,
  publishConfig,
  CONFIG_TYPES,
  relayUrls$,
  userPubkey$,
  userSigner$,
  type UserSignerInfo,
} from "@/hooks/sync";

/**
 * Hook to fetch and manage user's API keys synced with the cloud
 */
export function useApiKeysSync() {
  const { config } = useAppContext();
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const hasActiveAccount = activeAccount !== undefined;

  // Subscribe to the generic config sync
  const syncedApiKeys = useObservableState(apiKeys$, []);
  const isLoadingApiKeys = useObservableState(configSyncLoading$, true);

  // Pending state for mutations
  const [isPending, setIsPending] = useState(false);

  // Cloud sync enabled state (persisted to localStorage)
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("api_keys_cloud_sync_enabled") !== "false";
    }
    return true;
  });

  // Persist cloud sync enabled to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "api_keys_cloud_sync_enabled",
        String(cloudSyncEnabled)
      );
    }
  }, [cloudSyncEnabled]);

  // Update reactive inputs when account/config changes
  useEffect(() => {
    if (config.relayUrls.length > 0) {
      relayUrls$.next(config.relayUrls);
    }
  }, [config.relayUrls]);

  useEffect(() => {
    if (activeAccount?.pubkey) {
      userPubkey$.next(activeAccount.pubkey);
    } else {
      userPubkey$.next(null);
    }
  }, [activeAccount?.pubkey]);

  useEffect(() => {
    if (activeAccount && activeAccount.nip44 && activeAccount.signEvent) {
      const signerInfo: UserSignerInfo = {
        signer: {
          nip44: {
            encrypt: activeAccount.nip44.encrypt.bind(activeAccount.nip44),
            decrypt: activeAccount.nip44.decrypt.bind(activeAccount.nip44),
          },
          signEvent: activeAccount.signEvent.bind(activeAccount),
        },
        pubkey: activeAccount.pubkey,
      };
      userSigner$.next(signerInfo);
    } else {
      userSigner$.next(null);
    }
  }, [activeAccount]);

  // Subscribe to generic config sync to keep it active
  useEffect(() => {
    if (!cloudSyncEnabled || !activeAccount) return;

    const subscription = genericConfigSync$.subscribe({
      error: (err) => {
        console.error("[useApiKeysSync] Sync error:", err);
      },
    });

    return () => subscription.unsubscribe();
  }, [cloudSyncEnabled, activeAccount]);

  // Get current signer info for publishing
  const getSignerInfo = useCallback((): UserSignerInfo | null => {
    return userSigner$.getValue();
  }, []);

  // Create or update API keys
  const createOrUpdateApiKeys = useCallback(
    async (apiKeys: StoredApiKey[]): Promise<void> => {
      if (!activeAccount) {
        throw new Error("User not logged in");
      }

      const signerInfo = getSignerInfo();
      if (!signerInfo) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      setIsPending(true);
      try {
        await publishConfig(
          CONFIG_TYPES.API_KEYS,
          apiKeys,
          signerInfo,
          config.relayUrls
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("invalid MAC")) {
          toast.error(
            "Nostr Extension: invalid MAC. Please switch to your previously connected account on the extension OR sign out and login."
          );
        }
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [activeAccount, config.relayUrls, getSignerInfo]
  );

  // Delete a single API key
  const deleteApiKey = useCallback(
    async (keyToDelete: string): Promise<void> => {
      if (!activeAccount) {
        throw new Error("User not logged in");
      }

      const signerInfo = getSignerInfo();
      if (!signerInfo) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      // Get current keys and filter out the one to delete
      const currentKeys = syncedApiKeys;
      const updatedKeys = currentKeys.filter(
        (k: StoredApiKey) => k.key !== keyToDelete
      );

      setIsPending(true);
      try {
        await publishConfig(
          CONFIG_TYPES.API_KEYS,
          updatedKeys,
          signerInfo,
          config.relayUrls
        );
      } finally {
        setIsPending(false);
      }
    },
    [activeAccount, config.relayUrls, getSignerInfo, syncedApiKeys]
  );

  return {
    syncedApiKeys,
    isLoadingApiKeys,
    isSyncingApiKeys: isPending,
    createOrUpdateApiKeys,
    deleteApiKey,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    hasActiveAccount,
  };
}
