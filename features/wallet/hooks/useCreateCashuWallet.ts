import { useMutation } from "@tanstack/react-query";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useCashuWallet } from "./useCashuWallet";
import { useWalletStore } from "../state/walletStore";
import { defaultMints } from "../core/services/MintService";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Hook for creating a Cashu wallet using the user's Nostr identity
 *
 * @returns A mutation for creating a Cashu wallet
 */
export function useCreateCashuWallet() {
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const { createWalletAsync } = useCashuWallet();
  const cashuStore = useWalletStore();

  return useMutation({
    mutationFn: async () => {
      if (!activeAccount) {
        throw new Error("You must be logged in to create a wallet");
      }

      try {
        const privkey = bytesToHex(generateSecretKey());
        cashuStore.setPrivkey(privkey);

        // Create a new wallet with the default mint
        const mints = cashuStore.mints.map((m) => m.url);
        // add default mints
        mints.push(...defaultMints);

        // awaited: whoever made this call holds the account's lock until it is out
        await createWalletAsync({
          privkey,
          mints,
        });

        return { success: true };
      } catch (error) {
        console.error("Failed to derive private key:", error);
        throw new Error("Failed to create wallet. Please try again.");
      }
    },
  });
}
