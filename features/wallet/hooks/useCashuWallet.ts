import { toast } from "sonner";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { filter } from "rxjs";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { Wallet as CashuWalletStruct } from "../core/domain/Wallet";
import { CashuToken } from "../core/domain/Token";
import { MintService, defaultMints } from "../core/services/MintService";
import { NostrEvent, getPublicKey } from "nostr-tools";
import {
  useCashuStore,
  Nip60TokenEvent,
  type CashuStore,
} from "../state/cashuStore";
import { Proof } from "@cashu/cashu-ts";
import { NSchema as n } from "@nostrify/nostrify";
import { z } from "zod";
import { useNutzaps } from "./useNutzaps";
import { hexToBytes } from "@noble/hashes/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { eventDatabase, relayPool } from "@/lib/applesauce-core";
import {
  cashuUserPubkey$,
  syncCashuWallet$,
  syncCashuTokens$,
  walletEose$,
  tokensEose$,
  getCashuWalletEvents,
  getCashuTokenEvents,
} from "./cashuSync";

/**
 * Type for storing deleted events with timestamp
 */
export interface DeletedEvents {
  eventId: string;
  timestamp: number;
}

/**
 * Initialize mints by fetching mint info and keysets
 */
async function initiateMints(
  mints: string[],
  mintService: MintService,
  cashuStore: CashuStore
) {
  await Promise.all(
    mints.map(async (mint) => {
      try {
        const lastUpdate = cashuStore.getLastUpdate(mint);
        if (lastUpdate && lastUpdate > Date.now() - 60 * 60 * 1000) {
          console.log("mint already activated", mint);
          return;
        } else {
          const { mintInfo, keysets, keys } =
            await mintService.activateMint(mint);
          cashuStore.addMint(mint);
          cashuStore.setMintInfo(mint, mintInfo);
          cashuStore.setKeysets(mint, keysets);
          cashuStore.setKeys(mint, keys);
          cashuStore.setLastUpdate(mint, Date.now());
        }
      } catch (error) {
        console.error(`Failed to activate or update mint ${mint}:`, error);
        // Skip this mint and continue with others
      }
    })
  );
}

/**
 * Hook to fetch and manage the user's Cashu wallet
 */
export function useCashuWallet() {
  const { config } = useAppContext();
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const queryClient = useQueryClient();
  const cashuStore = useCashuStore();
  const { createNutzapInfo } = useNutzaps();
  const [showQueryTimeoutModal, setShowQueryTimeoutModal] = useState(false);
  const [didRelaysTimeout, setDidRelaysTimeout] = useState(false);
  const [deletedEvents, setDeletedEvents] = useLocalStorage<DeletedEvents[]>(
    "nip60-deleted-events",
    []
  );

  // Activate cashu sync when activeAccount changes
  useEffect(() => {
    if (activeAccount?.pubkey) {
      cashuUserPubkey$.next(activeAccount.pubkey);
      const sub1 = syncCashuWallet$.subscribe();
      const sub2 = syncCashuTokens$.subscribe();
      return () => {
        sub1.unsubscribe();
        sub2.unsubscribe();
      };
    }
  }, [activeAccount?.pubkey]);

  // Fetch wallet information (kind 17375)
  const walletQuery = useQuery<
    { id: string; wallet: CashuWalletStruct; createdAt: number } | null,
    Error,
    { id: string; wallet: CashuWalletStruct; createdAt: number } | null,
    any[]
  >({
    queryKey: ["cashu", "wallet", activeAccount?.pubkey],
    queryFn: async () => {
      if (!activeAccount) {
        return null;
      }
      try {
        // Wait for EOSE from applesauce sync or timeout
        const waitForEose = () =>
          new Promise<void>((resolve) => {
            if (walletEose$.getValue()) return resolve();
            const sub = walletEose$.pipe(filter(Boolean)).subscribe(() => {
              sub.unsubscribe();
              resolve();
            });
            setTimeout(() => {
              sub.unsubscribe();
              resolve();
            }, 10000);
          });

        await waitForEose();

        // Get events from eventStore (populated by cashuSync)
        const events = getCashuWalletEvents(activeAccount.pubkey);
        console.log(
          "rdlogs: Wallet Event Found from eventStore:",
          events.length
        );

        if (events.length === 0) {
          // No events found, but query completed successfully: clear timeout indicators
          try {
            localStorage.setItem("cashu_relays_timeout", "false");
          } catch {}
          setShowQueryTimeoutModal(false);
          setDidRelaysTimeout(false);
          return null;
        }

        try {
          localStorage.setItem("cashu_relays_timeout", "false");
        } catch {}
        setShowQueryTimeoutModal(false);
        setDidRelaysTimeout(false);

        // Sort by created_at descending to get latest (replaceable event)
        const event = events.sort((a, b) => b.created_at - a.created_at)[0];

        // Decrypt wallet content
        if (!activeAccount.nip44) {
          throw new Error("NIP-44 encryption not supported by your signer");
        }
        const decrypted = await activeAccount.nip44.decrypt(
          activeAccount.pubkey,
          event.content
        );
        const data = n.json().pipe(z.string().array().array()).parse(decrypted);

        const privkey = data.find(([key]) => key === "privkey")?.[1];

        if (!privkey) {
          throw new Error("Private key not found in wallet data");
        }

        const walletData: CashuWalletStruct = {
          privkey,
          mints: data.filter(([key]) => key === "mint").map(([, mint]) => mint),
        };

        // if the default mint is not in the wallet, add it
        for (const mint of defaultMints) {
          if (!walletData.mints.includes(mint)) {
            walletData.mints.push(mint);
          }
        }

        // remove trailing slashes from mints
        walletData.mints = walletData.mints.map((mint) =>
          mint.replace(/\/$/, "")
        );
        // reduce mints to unique values
        walletData.mints = [...new Set(walletData.mints)];

        // fetch the mint info and keysets for each mint
        const mintService = new MintService();
        await initiateMints(walletData.mints, mintService, cashuStore);

        cashuStore.setPrivkey(walletData.privkey);

        const currentActiveMintUrl = cashuStore.getActiveMintUrl();
        // Only set active mint URL if it's not already set or if current one is not in wallet mints
        if (
          !currentActiveMintUrl ||
          !walletData.mints?.includes(currentActiveMintUrl)
        ) {
          if (walletData.mints?.includes(DEFAULT_MINT_URL)) {
            cashuStore.setActiveMintUrl(DEFAULT_MINT_URL);
          } else if (walletData.mints && walletData.mints.length > 0) {
            cashuStore.setActiveMintUrl(walletData.mints[0]);
          }
        }

        // trigger getNip60TokensQuery refetch without awaiting to avoid circular dependency
        getNip60TokensQuery.refetch();
        return {
          id: event.id,
          wallet: walletData,
          createdAt: event.created_at,
        };
      } catch (error) {
        console.error("walletQuery: Error in queryFn", error);
        return null;
      }
    },
    enabled: !!activeAccount,
    staleTime: Infinity, // Prevent refetching on window focus or component re-mount
    retry: false, // Do not retry on failure, as the connection issue is persistent
  });

  // Create or update wallet
  const createWalletMutation = useMutation({
    mutationFn: async (walletData: CashuWalletStruct) => {
      if (!activeAccount) throw new Error("User not logged in");
      if (!activeAccount.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      // remove trailing slashes from mints
      walletData.mints = walletData.mints.map((mint) =>
        mint.replace(/\/$/, "")
      );
      // reduce mints to unique values
      walletData.mints = [...new Set(walletData.mints)];

      const tags = [
        ["privkey", walletData.privkey],
        ...walletData.mints.map((mint) => ["mint", mint]),
      ];

      // Encrypt wallet data
      const content = await activeAccount.nip44.encrypt(
        activeAccount.pubkey,
        JSON.stringify(tags)
      );

      // Create wallet event
      const event = await activeAccount.signEvent({
        kind: CASHU_EVENT_KINDS.WALLET,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });

      // Publish event
      await relayPool.publish(config.relayUrls, event);

      // Also create or update the nutzap informational event
      try {
        await createNutzapInfo({
          mintOverrides: walletData.mints.map((mint) => ({
            url: mint,
            units: ["sat"],
          })),
          p2pkPubkey: "02" + getPublicKey(hexToBytes(walletData.privkey)),
        });
      } catch (error) {
        console.error("Failed to create nutzap informational event:", error);
        // Continue even if nutzap info creation fails
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for event to be published

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cashu", "wallet", activeAccount?.pubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ["nutzap", "info", activeAccount?.pubkey],
      });
    },
  });

  // Fetch token events (kind 7375)
  const getNip60TokensQuery = useQuery<
    Nip60TokenEvent[],
    Error,
    Nip60TokenEvent[],
    any[]
  >({
    queryKey: ["cashu", "tokens", activeAccount?.pubkey],
    queryFn: async () => {
      if (!activeAccount) {
        return [];
      }
      try {
        // Wait for EOSE from applesauce sync or timeout
        const waitForEose = () =>
          new Promise<void>((resolve) => {
            if (tokensEose$.getValue()) return resolve();
            const sub = tokensEose$.pipe(filter(Boolean)).subscribe(() => {
              sub.unsubscribe();
              resolve();
            });
            setTimeout(() => {
              sub.unsubscribe();
              resolve();
            }, 15000);
          });

        await waitForEose();

        // Get events from eventStore (populated by cashuSync)
        const events = getCashuTokenEvents(activeAccount.pubkey);

        if (events.length === 0) {
          // No events found, but query completed successfully: clear timeout indicators
          try {
            localStorage.setItem("cashu_relays_timeout", "false");
          } catch {}
          setShowQueryTimeoutModal(false);
          setDidRelaysTimeout(false);
          return [];
        }

        try {
          localStorage.setItem("cashu_relays_timeout", "false");
        } catch {}
        setShowQueryTimeoutModal(false);
        setDidRelaysTimeout(false);

        const nip60TokenEvents: Nip60TokenEvent[] = [];
        const deletedEventsTemp = new Set<DeletedEvents>();
        const uniqueMints = new Set<string>();

        // First pass: collect all deleted event IDs from del arrays
        for (const event of events) {
          try {
            if (!activeAccount.nip44) {
              throw new Error("NIP-44 encryption not supported by your signer");
            }

            let decrypted: string;
            try {
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
            const tokenData = JSON.parse(decrypted) as CashuToken;

            uniqueMints.add(tokenData.mint);

            // Collect deleted event IDs
            if (tokenData.del && Array.isArray(tokenData.del)) {
              tokenData.del.forEach((id) =>
                deletedEventsTemp.add({
                  eventId: id,
                  timestamp: event.created_at,
                })
              );
            }

            nip60TokenEvents.push({
              id: event.id,
              token: tokenData,
              createdAt: event.created_at,
            });
          } catch (error) {
            console.error("Failed to decrypt token data:", error);
          }
        }
        const mintService = new MintService();
        await initiateMints(Array.from(uniqueMints), mintService, cashuStore);

        // Get existing deleted events from local storage
        const existingDeletedEvents = Array.isArray(deletedEvents)
          ? deletedEvents
          : [];

        const newDeletedEvents = Array.from(deletedEventsTemp);

        let allDeletedEvents = [...existingDeletedEvents, ...newDeletedEvents];

        // Remove deleted events older than 30 days
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
        allDeletedEvents = allDeletedEvents.filter(
          (e) => e.timestamp > thirtyDaysAgo
        );

        // Update local storage with combined events (existing + new)
        if (
          newDeletedEvents.length > 0 ||
          allDeletedEvents.length !== existingDeletedEvents.length
        ) {
          setDeletedEvents(allDeletedEvents);
        }

        // Second pass: filter out deleted events and add proofs to store
        const deletedEventIds = new Set(
          allDeletedEvents.map((deletedEvent) => deletedEvent.eventId)
        );
        const filteredEvents = nip60TokenEvents.filter(
          (event) => !deletedEventIds.has(event.id)
        );
        console.log("FILTER S ASJFKOSDGFMEVENTS", filteredEvents);

        // Add proofs to store only for non-deleted events
        filteredEvents.forEach((event) => {
          cashuStore.addProofs(event.token.proofs, event.id);
        });

        return filteredEvents;
      } catch (error) {
        console.error("getNip60TokensQuery: Error in queryFn", error);
        return [];
      }
    },
    enabled: !!activeAccount,
    staleTime: Infinity, // Prevent refetching on window focus or component re-mount
    retry: false, // Do not retry on failure, as the connection issue is persistent
  });

  const updateProofsMutation = useMutation({
    mutationFn: async ({
      mintUrl,
      proofsToAdd,
      proofsToRemove,
    }: {
      mintUrl: string;
      proofsToAdd: Proof[];
      proofsToRemove: Proof[];
    }): Promise<NostrEvent | null> => {
      if (!activeAccount) throw new Error("User not logged in");
      if (!activeAccount.nip44) {
        throw new Error("NIP-44 encryption not supported by your signer");
      }

      // get all event IDs of proofsToRemove
      const eventIdsToRemoveUnfiltered = proofsToRemove.map((proof) =>
        cashuStore.getProofEventId(proof)
      );
      const eventIdsToRemove = [
        ...new Set(
          eventIdsToRemoveUnfiltered.filter(
            (id) => id !== undefined
          ) as string[]
        ),
      ];

      // get all proofs with eventIdsToRemove
      const allProofsWithEventIds = eventIdsToRemove
        .map((id) => cashuStore.getProofsByEventId(id))
        .flat();

      // and filter out those that we want to keep to roll them over to a new event
      const proofsToKeepWithEventIds = allProofsWithEventIds.filter(
        (proof) => !proofsToRemove.includes(proof)
      );

      // combine proofsToAdd and proofsToKeepWithEventIds
      const newProofs = [...proofsToAdd, ...proofsToKeepWithEventIds];

      let eventToReturn: NostrEvent | null = null;

      if (newProofs.length) {
        // generate a new token event
        const newToken: CashuToken = {
          mint: mintUrl,
          proofs: newProofs,
          del: eventIdsToRemove,
        };

        // encrypt token event
        const newTokenEventContent = await activeAccount.nip44.encrypt(
          activeAccount.pubkey,
          JSON.stringify(newToken)
        );

        // create token event
        const newTokenEvent = await activeAccount.signEvent({
          kind: CASHU_EVENT_KINDS.TOKEN,
          content: newTokenEventContent,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        });

        // add proofs to store
        cashuStore.addProofs(newProofs, newTokenEvent?.id || "");

        // publish token event
        try {
          await relayPool.publish(config.relayUrls, newTokenEvent);
        } catch (error) {
          console.error("Failed to publish token event:", error);
        }

        // update local event IDs on all newProofs
        newProofs.forEach((proof) => {
          cashuStore.setProofEventId(proof, newTokenEvent.id);
        });

        eventToReturn = newTokenEvent;
      }

      // delete nostr events
      if (eventIdsToRemove.length) {
        // remove events from local eventStore/eventDatabase
        eventIdsToRemove.forEach((id) => {
          eventDatabase.remove(id);
        });

        // create deletion event
        const deletionEvent = await activeAccount.signEvent({
          kind: 5,
          content: "Deleted token event",
          tags: eventIdsToRemove.map((id) => ["e", id]),
          created_at: Math.floor(Date.now() / 1000),
        });

        // remove proofs from store
        const proofsToRemoveFiltered = proofsToRemove.filter(
          (proof) => !newProofs.map((p) => p.secret).includes(proof.secret)
        );
        cashuStore.removeProofs(proofsToRemoveFiltered);

        // publish deletion event
        try {
          await relayPool.publish(config.relayUrls, deletionEvent);
        } catch (error) {
          console.error("Failed to publish deletion event:", error);
        }
      }

      return eventToReturn;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["cashu", "tokens", activeAccount?.pubkey],
      });
    },
  });

  // Check localStorage for timeout status to ensure consistency across hook instances
  const hasTimedOut =
    didRelaysTimeout || localStorage.getItem("cashu_relays_timeout") === "true";

  return {
    wallet: walletQuery.data?.wallet,
    walletId: walletQuery.data?.id,
    tokens: getNip60TokensQuery.data || [],
    isLoading: walletQuery.isLoading || getNip60TokensQuery.isLoading,
    createWallet: createWalletMutation.mutate,
    updateProofs: updateProofsMutation.mutateAsync,
    showQueryTimeoutModal,
    setShowQueryTimeoutModal,
    didRelaysTimeout: hasTimedOut,
    setDidRelaysTimeout,
  };
}
