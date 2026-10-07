import { useAccountManager } from "@/features/session/view";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { relayPool } from "@/lib/applesauce-core";
import { useNutzapStore, NutzapInformationalEvent } from "../state/nutzapStore";
import { useWalletStore } from "../state/walletStore";

/**
 * Hook to manage Nutzap informational events (NIP-61)
 */
export function useNutzaps() {
  const { config } = useAppContext();
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const queryClient = useQueryClient();
  const nutzapStore = useNutzapStore();
  const cashuStore = useWalletStore();

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
