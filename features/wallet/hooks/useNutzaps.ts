import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { relayPool } from "@/lib/applesauce-core";
import { useNutzapStore, NutzapInformationalEvent } from "../state/nutzapStore";
import { useCashuStore } from "../state/cashuStore";
import { fetchNutzapInfo, getNutzapInfoEvent } from "./cashuSync";
import { relayUrls$ } from "@/hooks/useChatSync1081";

/**
 * Hook to fetch a nutzap informational event for a specific pubkey
 */

export function useNutzapInfo(pubkey?: string) {
  const nutzapStore = useNutzapStore();
  const { config } = useAppContext();

  return useQuery({
    queryKey: ["nutzap", "info", pubkey],
    queryFn: async () => {
      if (!pubkey) throw new Error("Pubkey is required");

      // First check if we have it in the store
      const storedInfo = nutzapStore.getNutzapInfo(pubkey);
      if (storedInfo) {
        return storedInfo;
      }

      // Check eventStore cache
      let event = getNutzapInfoEvent(pubkey);

      // If not cached, fetch from relays using applesauce
      if (!event) {
        const relays = relayUrls$.getValue();
        // Use relayUrls$ if available, otherwise fall back to config
        const relayUrlsToUse = relays.length > 0 ? relays : config.relayUrls;
        event = await fetchNutzapInfo(pubkey, relayUrlsToUse);
      }

      if (!event) {
        return null;
      }

      // Parse the nutzap informational event
      const eventRelays = event.tags
        .filter((tag) => tag[0] === "relay")
        .map((tag) => tag[1]);

      const mints = event.tags
        .filter((tag) => tag[0] === "mint")
        .map((tag) => {
          const url = tag[1];
          const units = tag.slice(2); // Get additional unit markers if any
          return { url, units: units.length > 0 ? units : undefined };
        });

      const p2pkPubkeyTag = event.tags.find((tag) => tag[0] === "pubkey");
      if (!p2pkPubkeyTag) {
        throw new Error(
          "No pubkey tag found in the nutzap informational event"
        );
      }

      const p2pkPubkey = p2pkPubkeyTag[1];

      const nutzapInfo: NutzapInformationalEvent = {
        event,
        relays: eventRelays,
        mints,
        p2pkPubkey,
      };

      // Store the info for future use
      nutzapStore.setNutzapInfo(pubkey, nutzapInfo);

      return nutzapInfo;
    },
    enabled: !!pubkey,
  });
}

/**
 * Hook to manage Nutzap informational events (NIP-61)
 */
export function useNutzaps() {
  const { config } = useAppContext();
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const queryClient = useQueryClient();
  const nutzapStore = useNutzapStore();
  const cashuStore = useCashuStore();

  // Create or update nutzap informational event
  const createNutzapInfoMutation = useMutation({
    mutationFn: async ({
      relays,
      mintOverrides,
      p2pkPubkey,
    }: {
      relays?: string[];
      mintOverrides?: Array<{ url: string; units?: string[] }>;
      p2pkPubkey: string;
    }) => {
      if (!activeAccount) throw new Error("User not logged in");

      // Get mints from store or override
      const mintsToUse =
        mintOverrides ||
        cashuStore.mints.map((mint) => ({
          url: mint.url,
          units: ["sat"], // Default unit
        }));

      // Create tags
      const tags = [
        // Add relay tags
        ...(relays || []).map((relay) => ["relay", relay]),

        // Add mint tags
        ...mintsToUse.map((mint) => {
          if (mint.units && mint.units.length > 0) {
            return ["mint", mint.url, ...mint.units];
          }
          return ["mint", mint.url];
        }),

        // Add pubkey tag for P2PK locking
        ["pubkey", p2pkPubkey],
      ];

      // Create nutzap informational event
      const event = await activeAccount.signEvent({
        kind: CASHU_EVENT_KINDS.ZAPINFO,
        content: "",
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      // Publish event
      await relayPool.publish(config.relayUrls, event);

      // Create nutzap info object
      const nutzapInfo: NutzapInformationalEvent = {
        event,
        relays: relays || [],
        mints: mintsToUse,
        p2pkPubkey,
      };

      // Store in nutzapStore
      nutzapStore.setNutzapInfo(activeAccount.pubkey, nutzapInfo);

      console.log("Nutzap info created", nutzapInfo);

      return event;
    },
    onSuccess: () => {
      if (activeAccount) {
        queryClient.invalidateQueries({
          queryKey: ["nutzap", "info", activeAccount.pubkey],
        });
      }
    },
  });

  return {
    createNutzapInfo: createNutzapInfoMutation.mutate,
    isCreatingNutzapInfo: createNutzapInfoMutation.isPending,
  };
}
