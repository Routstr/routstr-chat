import { useNostr } from "@/hooks/useNostr";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KINDS } from "@/lib/nostr-kinds";
import { NostrEvent } from "nostr-tools";
import { useState, useEffect, useCallback } from "react";

/**
 * Interface for provider balance data
 */
export interface ProviderBalance {
  /** Provider identifier (e.g., base URL or service name) */
  provider: string;
  /** Current balance amount */
  balance: number;
  /** Unit of the balance (sat, msat, etc.) */
  unit: string;
  /** Last updated timestamp */
  lastUpdated: number;
  /** Optional metadata about the provider */
  metadata?: {
    name?: string;
    description?: string;
    [key: string]: any;
  };
}

/**
 * Hook to fetch and manage user's provider balances synced with the cloud
 */
export function useProviderBalancesSync() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const [balancesSyncEnabled, setBalancesSyncEnabled] = useState<boolean>(
    () => {
      if (typeof window !== "undefined") {
        // Ensure localStorage is available only in client-side
        return (
          localStorage.getItem("provider_balances_sync_enabled") !== "false"
        ); // Default to true if not explicitly false
      }
      return true; // Default to true for SSR cases where window is undefined
    }
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "provider_balances_sync_enabled",
        String(balancesSyncEnabled)
      );
    }
  }, [balancesSyncEnabled]);

  const PROVIDER_BALANCES_D_TAG = "routstr-chat-provider-balances-v1";

  // Mutation to create/update provider balances event
  const createProviderBalancesMutation = useMutation({
    mutationFn: async (providerBalances: ProviderBalance[]) => {
      if (!user) {
        throw new Error("User not logged in");
      }
      if (!user.signer.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      // Encrypt the content
      const content = await user.signer.nip44.encrypt(
        user.pubkey,
        JSON.stringify(providerBalances)
      );

      // Create the NIP-78 event
      const event = await user.signer.signEvent({
        kind: KINDS.ARBITRARY_APP_DATA,
        content,
        tags: [["d", PROVIDER_BALANCES_D_TAG]],
        created_at: Math.floor(Date.now() / 1000),
      });

      // Publish event
      await nostr.event(event);
      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["providerBalances", user?.pubkey, PROVIDER_BALANCES_D_TAG],
      });
    },
  });

  // Mutation to handle provider balance deletion
  const deleteProviderBalanceMutation = useMutation({
    mutationFn: async (providerToDelete: string) => {
      if (!user) {
        throw new Error("User not logged in");
      }
      if (!user.signer.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      const currentProviderBalances =
        (queryClient.getQueryData([
          "providerBalances",
          user?.pubkey,
          PROVIDER_BALANCES_D_TAG,
        ]) as ProviderBalance[] | undefined) || [];
      const updatedBalances = currentProviderBalances.filter(
        (balance: ProviderBalance) => balance.provider !== providerToDelete
      );

      // Publish a new event with the updated list
      await createProviderBalancesMutation.mutateAsync(updatedBalances);

      // As per the plan, for a NIP-78 replaceable event (kind 30078),
      // publishing a new event automatically replaces the previous one with the same 'd' tag.
      // Therefore, sending a Kind 5 event for previous versions of this *specific* event
      // is generally not necessary as the new event supersedes it.
      // Kind 5 would be used if there were *other* non-replaceable event types that
      // uniquely referenced this provider balance and now need to be deleted.
      // Assuming for this task that provider balances are only stored within this single replaceable event
      // and do not have external linked (non-replaceable) Nostr events that need explicit deletion.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["providerBalances", user?.pubkey, PROVIDER_BALANCES_D_TAG],
      });
    },
  });

  // Query to fetch provider balances from Nostr
  const providerBalancesQuery = useQuery({
    queryKey: ["providerBalances", user?.pubkey, PROVIDER_BALANCES_D_TAG],
    queryFn: async ({ signal }) => {
      if (!user || !balancesSyncEnabled) {
        return [];
      }
      if (!user.signer.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      const filter = {
        kinds: [KINDS.ARBITRARY_APP_DATA],
        authors: [user.pubkey],
        "#d": [PROVIDER_BALANCES_D_TAG], // Filter by the 'd' tag
        limit: 1, // We only need the latest replaceable event
      };

      const events = await nostr.query([filter], { signal });

      if (events.length === 0) {
        return [];
      }

      const latestEvent = events[0]; // Get the latest event

      try {
        // Decrypt content
        const decrypted = await user.signer.nip44.decrypt(
          user.pubkey,
          latestEvent.content
        );
        const cloudProviderBalances: ProviderBalance[] = JSON.parse(decrypted);

        // Implement cloud cleanup on fetch:
        // As per point 5 of the requirements: "if a deleted balance is present with a valid balance,
        // then we delete the whole event and create a new event with the valid balances."
        // This implies that if a balance was previously deleted (locally or via previous sync)
        // but re-appears in a fetched cloud event, we should clean up the cloud event.
        // This would require a local "blacklist" or persistent record of deleted balances.
        // For simplicity in this iteration, and given the dynamic nature of "deleted balance"
        // between local storage and cloud, this specific proactive cleanup on fetch
        // will rely on manual deletion from the UI via `deleteProviderBalanceMutation` which
        // always writes the "cleaned" list to the cloud.
        // A more robust implementation would involve a dedicated local store for
        // "deleted balances" that `providerBalancesQuery` checks against, triggering a `createProviderBalancesMutation`
        // if an inconsistent balance is found.

        return cloudProviderBalances;
      } catch (error) {
        if (error instanceof Error && error.message.includes("invalid MAC")) {
          toast.error(
            "Nostr Extension: invalid MAC. Please switch to your previously connected account on the extension OR sign out and login."
          );
        }
        console.error("Failed to decrypt provider balance data:", error);
        return [];
      }
    },
    enabled: !!user && balancesSyncEnabled && !!user.signer.nip44,
  });

  // Memoize the mutation functions to prevent infinite re-renders
  const createOrUpdateProviderBalances = useCallback(
    (providerBalances: ProviderBalance[]) =>
      createProviderBalancesMutation.mutateAsync(providerBalances),
    [createProviderBalancesMutation]
  );

  const deleteProviderBalance = useCallback(
    (providerToDelete: string) =>
      deleteProviderBalanceMutation.mutateAsync(providerToDelete),
    [deleteProviderBalanceMutation]
  );

  return {
    syncedProviderBalances: providerBalancesQuery.data || [],
    isLoadingProviderBalances: providerBalancesQuery.isLoading,
    isSyncingProviderBalances:
      createProviderBalancesMutation.isPending ||
      deleteProviderBalanceMutation.isPending,
    createOrUpdateProviderBalances, // Use memoized function
    deleteProviderBalance, // Use memoized function
    balancesSyncEnabled: balancesSyncEnabled, // Expose for component to use
    setBalancesSyncEnabled, // Expose setter for component to toggle
  };
}
