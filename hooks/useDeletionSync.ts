import { relayPool, eventStore } from "@/lib/applesauce-core";
import { useAppContext } from "@/hooks/useAppContext";
import { SyncDirection } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";

/**
 * Hook to handle deletion sync for kind 5 events
 * This function syncs deletion events from relays
 */
export function useDeletionSync() {
  const { config } = useAppContext();

  /**
   * Perform deletion sync for kind 5 events
   */
  const performDeletionSync = async (event: NostrEvent) => {
    const relayUrls = config.relayUrls;
    console.log("[useChatSync1081] Syncing deleted PNS events for pubkeys:");

    try {
      const responses = await relayPool.publish(relayUrls, event);
      console.log(
        "[useDeletionSync] Synced deleted PNS event:",
        event.id,
        "from:",
        event.pubkey.slice(0, 8),
      );
      console.log("[useDeletionSync] Publish responses:", responses);
    } catch (err: any) {
      // Handle EmptyError which can happen when sync completes with no events
      if (
        err?.name === "EmptyError" ||
        err?.message === "no elements in sequence"
      ) {
        console.log(
          "[useDeletionSync] Deletion sync complete - no events to sync",
        );
      } else {
        console.error("[useDeletionSync] Deletion sync error:", err);
      }
    }
  };

  return {
    performDeletionSync,
  };
}
