import { useState } from "react";
import { useCashuStore } from "../state/cashuStore";
import { useCashuWallet } from "./useCashuWallet";
import { useCashuHistory } from "./useCashuHistory";
import { useBook } from "./useBook";
import { peek, toSats } from "../purse";
import { Proof, getTokenMetadata } from "@cashu/cashu-ts";
import { normalizeMintUrl } from "@/features/book/mint";
import { currentOwner } from "@/features/session/owned";
import { MintService } from "../core/services/MintService";
import { dropSpent } from "../spent";
import { walletCoins } from "./purseBridge";

export function useCashuToken() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cashuStore = useCashuStore();
  const { wallet, createWallet, updateProofs } = useCashuWallet();
  const { activeExecutor } = useBook();

  const { createHistory } = useCashuHistory();

  /**
   * Generate a send token
   * @param mintUrl The URL of the mint to use
   * @param amount Amount to send in satoshis
   * @param p2pkPubkey The P2PK pubkey to lock the proofs to
   * @param unit Unused: the wallet book uses msat when the mint offers it, else sat
   * @param trackUnclaimed Keep the token listed (wallet UI sends) until the
   *   user takes it back or dismisses it
   * @returns Encoded token string
   */
  const sendToken = async (
    mintUrl: string,
    amount: number,
    p2pkPubkey?: string,
    unit?: string,
    trackUnclaimed = false
  ): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const executor = activeExecutor();
      if (!executor) throw new Error("User not logged in");
      const normalizedMintUrl = await addMintIfNotExists(mintUrl);
      let proofs = await cashuStore.getMintProofs(normalizedMintUrl);

      let token: string;
      try {
        token = await executor.send(normalizedMintUrl, amount, proofs, {
          track: trackUnclaimed,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !message.includes("Not enough funds available") &&
          !message.includes("Token already spent") &&
          !message.includes("proofs already spent") &&
          !message.includes("Not enough balance to send")
        ) {
          throw error;
        }
        // the wallet may list coins already spent: drop those and try once more
        await cleanSpentProofs(normalizedMintUrl);
        proofs = await cashuStore.getMintProofs(normalizedMintUrl);
        try {
          token = await executor.send(normalizedMintUrl, amount, proofs, {
            track: trackUnclaimed,
            includeFees: false,
          });
        } catch (retry) {
          // the chat path tries another mint on this one
          if (String(retry).includes("Not enough funds")) {
            throw new Error(
              `Not enough funds on mint ${normalizedMintUrl} after cleaning spent proofs`
            );
          }
          throw new Error(
            `Having issues with the mint ${normalizedMintUrl}, please refresh your app try again. `
          );
        }
      }

      // activity is in sats, whatever unit the mint counts in
      await createHistory({
        direction: "out",
        amount: peek(token).sats.toString(),
      });
      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to generate token: ${message}`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const normalizeMintUrl = (url: string) => url.replace(/\/+$/, "");

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

  /**
   * Receive a token
   * @param token The encoded token string
   * @param requirePersisted Throw if the received proofs could not be stored
   *   (instead of leaving them to the wallet book's recovery), so callers like reclaim
   *   don't report success on unpersisted funds
   * @returns The received proofs
   */
  const receiveToken = async (
    token: string,
    requirePersisted = false
  ): Promise<Proof[]> => {
    setIsLoading(true);
    setError(null);

    let tokenMintUrl: string | undefined;
    try {
      tokenMintUrl = getTokenMetadata(token).mint;
      const executor = activeExecutor();
      if (!executor) throw new Error("User not logged in");
      // if we don't have the mintUrl yet, add it
      await addMintIfNotExists(tokenMintUrl);

      const receivedProofs = await executor.receive(token, {
        requirePersisted,
      });

      const totalAmount = receivedProofs.reduce((sum, p) => sum + p.amount, 0);
      await createHistory({
        direction: "in",
        amount: toSats(totalAmount, getTokenMetadata(token).unit).toString(),
      });

      return receivedProofs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to receive token: ${message}`);

      // Check if it's a network error and add mintUrl to the error
      if (message.includes("NetworkError when attempting to fetch resource.")) {
        if (tokenMintUrl && error instanceof Error) {
          (error as any).mintUrl = tokenMintUrl;
        }
      } else if (message.includes("Wallet not found")) {
        if (error instanceof Error) {
          (error as any).token = token;
        }
      }

      throw error;
    } finally {
      setIsLoading(false);
    }
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
    sendToken,
    receiveToken,
    cleanSpentProofs,
    addMintIfNotExists,
    removeMint,
    isLoading,
    error,
  };
}
