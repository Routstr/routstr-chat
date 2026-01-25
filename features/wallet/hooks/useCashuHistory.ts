import { useEffect } from "react";
import { toast } from "sonner";
import { filter } from "rxjs";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { SpendingHistoryEntry } from "../core/domain/Transaction";
import { useTransactionHistoryStore } from "../state/transactionHistoryStore";
import { relayPool } from "@/lib/applesauce-core";
import {
  cashuUserPubkey$,
  syncCashuHistory$,
  historyEose$,
  getCashuHistoryEvents,
} from "./cashuSync";

/**
 * Hook to fetch and manage the user's Cashu spending history
 */
export function useCashuHistory() {
  const { config } = useAppContext();
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const queryClient = useQueryClient();
  const transactionHistoryStore = useTransactionHistoryStore();

  // Activate history sync when user changes
  useEffect(() => {
    if (activeAccount?.pubkey) {
      cashuUserPubkey$.next(activeAccount.pubkey);
      const sub = syncCashuHistory$.subscribe();
      return () => sub.unsubscribe();
    }
  }, [activeAccount?.pubkey]);

  // Create spending history event
  const createHistoryMutation = useMutation({
    mutationFn: async ({
      direction,
      amount,
      createdTokens = [],
      destroyedTokens = [],
      redeemedTokens = [],
    }: {
      direction: "in" | "out";
      amount: string;
      createdTokens?: string[];
      destroyedTokens?: string[];
      redeemedTokens?: string[];
    }) => {
      if (!activeAccount) throw new Error("User not logged in");
      if (!activeAccount.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      // Prepare content data
      const contentData = [
        ["direction", direction],
        ["amount", amount],
        ...createdTokens.map((id) => ["e", id, "", "created"]),
        ...destroyedTokens.map((id) => ["e", id, "", "destroyed"]),
      ];

      // Encrypt content
      const content = await activeAccount.nip44.encrypt(
        activeAccount.pubkey,
        JSON.stringify(contentData)
      );

      // Create history event with unencrypted redeemed tags
      const event = await activeAccount.signEvent({
        kind: CASHU_EVENT_KINDS.HISTORY,
        content,
        tags: redeemedTokens.map((id) => ["e", id, "", "redeemed"]),
        created_at: Math.floor(Date.now() / 1000),
      });

      // Publish event
      await relayPool.publish(config.relayUrls, event);

      // Add to transaction history store
      const historyEntry: SpendingHistoryEntry & { id: string } = {
        id: event.id,
        direction,
        amount,
        timestamp: event.created_at,
        createdTokens,
        destroyedTokens,
        redeemedTokens,
      };
      transactionHistoryStore.addHistoryEntry(historyEntry);

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cashu", "history", activeAccount?.pubkey],
      });
    },
  });

  const historyQuery = useQuery({
    queryKey: ["cashu", "history", activeAccount?.pubkey],
    queryFn: async () => {
      if (!activeAccount) throw new Error("User not logged in");
      if (!activeAccount.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      // Wait for EOSE or timeout
      const waitForEose = () =>
        new Promise<void>((resolve) => {
          if (historyEose$.getValue()) return resolve();
          const sub = historyEose$.pipe(filter(Boolean)).subscribe(() => {
            sub.unsubscribe();
            resolve();
          });
          setTimeout(() => {
            sub.unsubscribe();
            resolve();
          }, 15000);
        });

      await waitForEose();

      // Get events from eventStore
      const events = getCashuHistoryEvents(activeAccount.pubkey);

      if (events.length === 0) {
        return [];
      }

      const history: (SpendingHistoryEntry & { id: string })[] = [];

      for (const event of events) {
        try {
          let decrypted: string;
          try {
            // Decrypt content
            decrypted = await activeAccount.nip44.decrypt(
              activeAccount.pubkey,
              event.content
            );
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("invalid MAC")
            ) {
              toast.error(
                "Nostr Extention: invalid MAC. Please switch to your previously connected account on the extension OR sign out and login. ."
              );
            }
            throw error;
          }
          const contentData = JSON.parse(decrypted) as Array<string[]>;

          // Extract data from content
          const entry: SpendingHistoryEntry & { id: string } = {
            id: event.id,
            direction: "in",
            amount: "0",
            timestamp: event.created_at,
            createdTokens: [],
            destroyedTokens: [],
            redeemedTokens: [],
          };

          // Process content data
          for (const item of contentData) {
            const [key, value] = item;
            const marker = item.length >= 4 ? item[3] : undefined;

            if (key === "direction") {
              entry.direction = value as "in" | "out";
            } else if (key === "amount") {
              entry.amount = value;
            } else if (key === "e" && marker === "created") {
              entry.createdTokens?.push(value);
            } else if (key === "e" && marker === "destroyed") {
              entry.destroyedTokens?.push(value);
            }
          }

          // Process unencrypted tags
          for (const tag of event.tags) {
            if (tag[0] === "e" && tag[3] === "redeemed") {
              entry.redeemedTokens?.push(tag[1]);
            }
          }

          history.push(entry);

          // Add to transaction history store
          transactionHistoryStore.addHistoryEntry(entry);
        } catch (error) {
          console.error("Failed to decrypt history data:", error);
        }
      }

      // Sort by timestamp (newest first)
      return history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    },
    enabled: !!activeAccount && !!activeAccount.nip44,
  });

  return {
    history: historyQuery.data || [],
    isLoading: historyQuery.isLoading,
    createHistory: createHistoryMutation.mutate,
  };
}
