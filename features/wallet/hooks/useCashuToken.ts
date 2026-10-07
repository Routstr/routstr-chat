import { useWalletStore } from "../state/walletStore";
import { useCashuWallet } from "./useCashuWallet";
import type { Proof } from "@cashu/cashu-ts";
import { normalizeMintUrl } from "@/features/book/mint";
import { currentOwner } from "@/features/session/owned";
import { MintService } from "../core/services/MintService";
import { dropSpent } from "../spent";
import { walletCoins } from "./purseBridge";

export function useCashuToken() {
  const cashuStore = useWalletStore();
  const { wallet, createWallet } = useCashuWallet();

  const ensureMintInitialized = async (mintUrl: string) => {
    const normalizedMintUrl = normalizeMintUrl(mintUrl);
    const existingMint = cashuStore.mints.find(
      (mint) => mint.url === normalizedMintUrl
    );
    const needsActivation =
      !existingMint ||
      !existingMint.mintInfo ||
      !existingMint.keysets?.length ||
      !existingMint.keys?.length ||
      !existingMint.keysets[0].id;

    if (!existingMint) {
      cashuStore.addMint(normalizedMintUrl);
    }

    if (needsActivation) {
      try {
        const mintService = new MintService();
        const { mintInfo, keysets, keys } =
          await mintService.activateMint(normalizedMintUrl);
        cashuStore.setMintInfo(normalizedMintUrl, mintInfo);
        cashuStore.setKeysets(normalizedMintUrl, keysets);
        cashuStore.setKeys(normalizedMintUrl, keys);
      } catch (err) {
        console.error("Failed to initialize mint data:", err);
      }
    }

    return normalizedMintUrl;
  };

  const addMintIfNotExists = async (mintUrl: string) => {
    const normalizedMintUrl = await ensureMintInitialized(mintUrl);

    try {
      new URL(normalizedMintUrl);
    } catch (err) {
      throw new Error("Invalid mint URL: " + mintUrl);
    }

    if (!wallet) {
      console.warn(
        "Wallet not loaded when trying to add mint URL:",
        normalizedMintUrl
      );
      return normalizedMintUrl;
    }

    if (!wallet.mints.includes(normalizedMintUrl)) {
      try {
        await createWallet({
          ...wallet,
          mints: [...wallet.mints, normalizedMintUrl],
        });
      } catch (err) {
        console.error("Failed to persist mint URL to wallet:", err);
      }
    }

    return normalizedMintUrl;
  };

  const removeMint = async (mintUrl: string) => {
    if (!wallet) {
      throw new Error(
        "Wallet not found, trying to remove mint URL: " + mintUrl
      );
    }
    // Check if mint exists in wallet
    if (!wallet.mints.includes(mintUrl)) {
      throw new Error("Mint URL not found in wallet: " + mintUrl);
    }
    // Remove mint from wallet
    createWallet({
      ...wallet,
      mints: wallet.mints.filter((mint) => mint !== mintUrl),
    });
  };

  /** The account's coins at this mint that the mint says are spent leave
   *  the wallet; resolves with them. */
  const cleanSpentProofs = async (mintUrl: string): Promise<Proof[]> => {
    const owner = currentOwner();
    const locks = globalThis.navigator?.locks;
    if (!owner || !locks) return [];
    return dropSpent(owner, normalizeMintUrl(mintUrl), {
      coins: walletCoins(),
      locks,
    });
  };

  return {
    cleanSpentProofs,
    addMintIfNotExists,
    removeMint,
  };
}
