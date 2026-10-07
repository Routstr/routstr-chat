import { useAccountManager } from "@/features/session/view";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { filter } from "rxjs";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { Wallet as CashuWalletStruct } from "../core/domain/Wallet";
import { MintService, defaultMints } from "../core/services/MintService";
import { getPublicKey } from "nostr-tools";
import { useWalletStore, type WalletStore } from "../state/walletStore";
import { useWalletCopy } from "../view";
import { z } from "zod";
import { useNutzaps } from "./useNutzaps";
import { hexToBytes } from "@noble/hashes/utils.js";
import { relayPool } from "@/lib/applesauce-core";
import {
  cashuUserPubkey$,
  syncCashuWallet$,
  walletEose$,
  getCashuWalletEvents,
} from "./cashuSync";

/**
 * Initialize mints by fetching mint info and keysets
 */
async function initiateMints(
  mints: string[],
  mintService: MintService,
  cashuStore: WalletStore
) {
  await Promise.all(
    mints.map(async (mint) => {
      try {
        const lastUpdate = cashuStore.getLastUpdate(mint);
        if (lastUpdate && lastUpdate > Date.now() - 60 * 60 * 1000) {
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
  const walletStore = useWalletStore();
  const { createNutzapInfo } = useNutzaps();

  // Activate cashu sync when activeAccount changes
  useEffect(() => {
    if (activeAccount?.pubkey) {
      cashuUserPubkey$.next(activeAccount.pubkey);
      const sub = syncCashuWallet$.subscribe();
      return () => sub.unsubscribe();
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
          return null;
        }


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
        const data = z.string().array().array().parse(JSON.parse(decrypted));

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
        await initiateMints(walletData.mints, mintService, walletStore);

        // the active mint is useWalletBinder's: set only when there is none
        walletStore.setPrivkey(walletData.privkey);

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

  // relays that did not answer the read of the wallet copy: App's notice,
  // until the person closes it (useWalletCopy is the wallet's own signal)
  const copy = useWalletCopy();
  // closed for this read only: the next one that goes unanswered shows again
  const [closed, setClosed] = useState<object | null>(null);
  const unanswered = copy.status === "unanswered" && closed !== copy;
  const close = (open: boolean) => {
    if (!open) setClosed(copy);
  };

  return {
    owner: activeAccount?.pubkey,
    wallet: walletQuery.data?.wallet,
    walletId: walletQuery.data?.id,
    isLoading: walletQuery.isLoading,
    createWallet: createWalletMutation.mutate,
    // resolves once the wallet event is published
    createWalletAsync: createWalletMutation.mutateAsync,
    showQueryTimeoutModal: unanswered,
    setShowQueryTimeoutModal: close,
    didRelaysTimeout: unanswered,
    setDidRelaysTimeout: close,
  };
}
