import { useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useObservableState } from "applesauce-react/hooks";
import { hexToBytes } from "@noble/hashes/utils.js";
import { getPublicKey } from "nostr-tools";
import { RelaysContext } from "@/features/relays/view";
import { useAccountManager } from "@/features/session/view";
import { MintService } from "../core/services/MintService";
import { signerOf } from "../signer";
import { useWalletStore, type WalletStore } from "../state/walletStore";
import { publishWallet, readWallet, type WalletEvent } from "../walletEvent";
import { useNutzaps } from "./useNutzaps";

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
 * The active account's NIP-60 wallet event, read once from its relays: its
 * mints go in the wallet's list and its key in the store. `publish` writes a
 * new one (and the nutzap info event), resolving once a relay took it.
 */
export function useWalletEvent() {
  const relays = useContext(RelaysContext);
  const { manager } = useAccountManager();
  const account = useObservableState(manager.active$);
  const queryClient = useQueryClient();
  const walletStore = useWalletStore();
  const { createNutzapInfo } = useNutzaps();
  const owner = account?.pubkey;

  const query = useQuery({
    queryKey: ["cashu", "wallet", owner],
    queryFn: async (): Promise<WalletEvent | null> => {
      if (!account || !relays) return null;
      try {
        const wallet = await readWallet(account.pubkey, {
          signer: signerOf(account),
          relays: relays.of(account.pubkey),
        });
        if (!wallet) return null;
        await initiateMints(wallet.mints, new MintService(), walletStore);
        // the active mint is useWalletBinder's: set only when there is none
        walletStore.setPrivkey(wallet.privkey);
        return wallet;
      } catch (error) {
        console.error("Could not read the wallet event:", error);
        return null;
      }
    },
    enabled: !!account && !!relays,
    staleTime: Infinity, // Prevent refetching on window focus or component re-mount
    retry: false, // Do not retry on failure, as the connection issue is persistent
  });

  const publish = useMutation({
    mutationFn: async (wallet: { privkey: string; mints: string[] }) => {
      if (!account || !relays) throw new Error("User not logged in");
      const event = await publishWallet(
        { signer: signerOf(account), relays: relays.of(account.pubkey) },
        wallet
      );
      try {
        await createNutzapInfo({
          mintOverrides: wallet.mints.map((mint) => ({
            url: mint,
            units: ["sat"],
          })),
          p2pkPubkey: "02" + getPublicKey(hexToBytes(wallet.privkey)),
        });
      } catch (error) {
        console.error("Failed to create nutzap informational event:", error);
        // Continue even if nutzap info creation fails
      }
      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cashu", "wallet", owner] });
      queryClient.invalidateQueries({ queryKey: ["nutzap", "info", owner] });
    },
  });

  return {
    owner,
    wallet: query.data ?? undefined,
    isLoading: query.isLoading,
    publish: publish.mutateAsync,
  };
}
