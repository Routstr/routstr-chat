import { useState } from "react";
import { useCashuStore } from "../state/cashuStore";
import { useCashuWallet } from "./useCashuWallet";
import { useCashuHistory } from "./useCashuHistory";
import { useBook } from "./useBook";
import {
  Mint,
  Wallet,
  Proof,
  getTokenMetadata,
  CheckStateEnum,
} from "@cashu/cashu-ts";
import { MintService } from "../core/services/MintService";
import { hashToCurve } from "@cashu/crypto/modules/common";

// Global map to track active cleanSpentProofs operations per mint
const activeCleanupPromises = new Map<string, Promise<Proof[]>>();

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

      // in the mint's unit, as received tokens are recorded
      await createHistory({
        direction: "out",
        amount: getTokenMetadata(token).amount.toString(),
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
        amount: totalAmount.toString(),
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

  const cleanSpentProofs = async (mintUrl: string, keysetId?: string) => {
    // Normalize the mint URL first to ensure consistent cache keys
    const normalizedMintUrl = mintUrl.replace(/\/+$/, "");

    // Create a unique cache key that includes keysetId if provided
    const cacheKey = keysetId
      ? `${normalizedMintUrl}:${keysetId}`
      : normalizedMintUrl;

    // If there's already an active cleanup for this mint/keyset, return that promise
    const existingPromise = activeCleanupPromises.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    // Create a new cleanup promise
    const cleanupPromise = (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const finalMintUrl = await addMintIfNotExists(normalizedMintUrl);
        const mintDetails = cashuStore.getMint(finalMintUrl);
        const mint = new Mint(finalMintUrl);

        // Get preferred unit: msat over sat if both are active
        let keysets = mintDetails?.keysets;

        const activeKeysets = keysets?.filter((k) => k.active || (k as any)._active);
        const units = [...new Set(activeKeysets?.map((k) => k.unit || (k as any)._unit))];
        const preferredUnit = units?.includes("msat")
          ? "msat"
          : units?.includes("sat")
            ? "sat"
            : (units?.[0] || "sat");

        const wallet = new Wallet(mint, {
          unit: preferredUnit,
        });

        try {
          await wallet.loadMint();
        } catch (err) {
          console.log(activeKeysets, units);
          console.log(err, finalMintUrl, keysets, preferredUnit);
        }

        let proofs = await cashuStore.getMintProofs(finalMintUrl);

        // If keysetId is provided, filter proofs to only those matching the keyset
        if (keysetId) {
          proofs = proofs.filter((p) => p.id === keysetId);
          console.log(
            `Cleaning spent proofs for keyset ${keysetId}: ${proofs.length} proofs`
          );
        }

        const proofStates = await wallet.checkProofsStates(proofs);
        const spentProofsStates = proofStates.filter(
          (p) => p.state == CheckStateEnum.SPENT
        );
        const enc = new TextEncoder();
        const spentProofs = proofs.filter((p) =>
          spentProofsStates.find(
            (s) => s.Y == hashToCurve(enc.encode(p.secret)).toHex(true)
          )
        );
        // console.log('rdlogs pd', spentProofs)

        await updateProofs({
          mintUrl: finalMintUrl,
          proofsToAdd: [],
          proofsToRemove: spentProofs,
        });

        return spentProofs;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setError(`Failed to clean spent proofs: ${message}`);
        throw error;
      } finally {
        setIsLoading(false);
        // Remove from active cleanups when done
        activeCleanupPromises.delete(cacheKey);
      }
    })();

    // Store the promise in the map
    activeCleanupPromises.set(cacheKey, cleanupPromise);

    return cleanupPromise;
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
