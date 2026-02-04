import { useState, useEffect } from "react";
import { useCashuStore } from "../state/cashuStore";
import { useCashuWallet } from "./useCashuWallet";
import { useCashuHistory } from "./useCashuHistory";
import {
  Mint,
  Wallet,
  Proof,
  getDecodedToken,
  CheckStateEnum,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import { calculateInactiveKeysetBalances } from "../core/utils/balance";
import { MintService } from "../core/services/MintService";
import { hashToCurve } from "@cashu/crypto/modules/common";

// Global flag to track if recovery has been initiated in this session
let recoveryInitiated = false;
let recoveryPromise: Promise<void> | null = null;

// Global map to track active cleanSpentProofs operations per mint
const activeCleanupPromises = new Map<string, Promise<Proof[]>>();

export function useCashuToken() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cashuStore = useCashuStore();
  const { wallet, createWallet, updateProofs, tokens } = useCashuWallet();

  const { createHistory } = useCashuHistory();

  /**
   * Recover any pending proofs that were interrupted during token creation
   * This should be called on app startup
   */
  const recoverPendingProofs = async () => {
    try {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith("pending_send_proofs_")
      );

      for (const key of keys) {
        try {
          // Check if this specific proof has already been processed
          const recoveryKey = `recovery_processed_${key}`;
          if (sessionStorage.getItem(recoveryKey)) {
            console.log(
              "rdlogs: Skipping already processed pending proof:",
              key
            );
            continue;
          }

          const pendingData = JSON.parse(localStorage.getItem(key) || "{}");
          const { mintUrl, proofsToSend, timestamp } = pendingData;

          // Only recover proofs that are less than 1 hour old to avoid stale data
          if (
            Date.now() - timestamp < 60 * 60 * 1000 &&
            mintUrl &&
            proofsToSend
          ) {
            console.log("rdlogs: Recovering pending proofs:", key);

            // Mark this proof as being processed
            sessionStorage.setItem(recoveryKey, "true");

            // Add the proofs back to the wallet
            await updateProofs({
              mintUrl,
              proofsToAdd: proofsToSend,
              proofsToRemove: [],
            });
          }

          // Clean up the pending entry regardless
          localStorage.removeItem(key);
        } catch (error) {
          console.error("Error recovering pending proofs for key:", key, error);
          // Clean up corrupted entries
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error("Error during pending proofs recovery:", error);
    }
  };

  // Recover pending proofs on hook initialization - ensure it only runs once globally
  useEffect(() => {
    const initRecovery = async () => {
      // If recovery is already in progress, wait for it to complete
      if (recoveryPromise) {
        await recoveryPromise;
        return;
      }

      // If recovery has already been initiated in this session, skip
      if (recoveryInitiated) {
        return;
      }

      // Mark recovery as initiated and create the promise
      recoveryInitiated = true;
      recoveryPromise = recoverPendingProofs();

      try {
        await recoveryPromise;
      } finally {
        recoveryPromise = null;
      }
    };

    initRecovery();
  }, []);

  /**
   * Generate a send token
   * @param mintUrl The URL of the mint to use
   * @param amount Amount to send in satoshis
   * @param p2pkPubkey The P2PK pubkey to lock the proofs to
   * @returns Encoded token string
   */
  const sendToken = async (
    mintUrl: string,
    amount: number,
    p2pkPubkey?: string,
    unit?: string
  ): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const mint = new Mint(mintUrl);
      const normalizedMintUrl = await addMintIfNotExists(mintUrl);
      const mintDetails = cashuStore.getMint(normalizedMintUrl);
      const keysets = mintDetails?.keysets;

      // Get preferred unit: msat over sat if both are active
      const activeKeysets = keysets?.filter((k) => k.active);
      if (!activeKeysets)
        throw new Error("No active keysets found for mint: " + mintUrl);
      let preferredUnit = "not supported";
      if (unit) {
        preferredUnit = unit as "sat" | "msat";
      } else {
        const units = [...new Set(activeKeysets.map((k) => k.unit))];
        preferredUnit = units.includes("msat")
          ? "msat"
          : ((units.includes("sat") ? "sat" : "not supported") as
              | "sat"
              | "msat");
      }

      const wallet = new Wallet(mint, { unit: preferredUnit });

      // Load mint keysets
      await wallet.loadMint();

      // Get all proofs from store
      let proofs = await cashuStore.getMintProofs(normalizedMintUrl);

      const proofsAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

      // console.log('rdlogs: Proof denomination groups:', denominationCounts);
      amount = preferredUnit == "msat" ? amount * 1000 : amount;
      console.log("amount being sent", amount);
      if (proofsAmount < amount) {
        throw new Error(`Not enough funds on mint ${normalizedMintUrl}`);
      }

      let proofsToKeep: Proof[], proofsToSend: Proof[];

      try {
        // Pass keysetId to force swap and skip offline send functionality
        const result = await wallet.send(amount, proofs, {
          keysetId: activeKeysets[0]?.id,
          includeFees: true,
        });
        proofsToKeep = result.keep;
        proofsToSend = result.send;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (
          message.includes("Not enough funds available") ||
          message.includes("Token already spent") ||
          message.includes("Not enough balance to send")
        ) {
          console.log(
            "rdlogs: wallet.send() failed with insufficient funds, trying exact change with tolerance"
          );

          // Clean spent proofs
          await cleanSpentProofs(normalizedMintUrl);

          // Get fresh proofs after cleanup
          proofs = await cashuStore.getMintProofs(normalizedMintUrl);

          // Check if we still have enough funds after cleanup
          const newProofsAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
          if (newProofsAmount < amount) {
            throw new Error(
              `Not enough funds on mint ${normalizedMintUrl} after cleaning spent proofs`
            );
          }

          try {
            // Pass keysetId to force swap and skip offline send functionality
            const result = await wallet.send(amount, proofs, {
              keysetId: activeKeysets[0]?.id,
            });
            proofsToKeep = result.keep;
            proofsToSend = result.send;
          } catch (error2) {
            throw new Error(
              `Having issues with the mint ${normalizedMintUrl}, please refresh your app try again. `
            );
          }
        } else {
          // Re-throw the error if it's not a "Token already spent" error
          throw error;
        }
      }

      // Store proofs temporarily before updating wallet state
      const pendingProofsKey = `pending_send_proofs_${Date.now()}`;
      localStorage.setItem(
        pendingProofsKey,
        JSON.stringify({
          normalizedMintUrl,
          proofsToSend: proofsToSend.map((p) => ({
            id: p.id || "",
            amount: p.amount,
            secret: p.secret || "",
            C: p.C || "",
          })),
          timestamp: Date.now(),
          tokenAmount: amount,
        })
      );
      // Create new token for the proofs we're keeping
      if (proofsToKeep.length > 0) {
        // update proofs
        await updateProofs({
          mintUrl: normalizedMintUrl,
          proofsToAdd: proofsToKeep,
          proofsToRemove: [...proofsToSend, ...proofs],
        });

        // Create history event
        await createHistory({
          direction: "out",
          amount: amount.toString(),
        });
      }

      // Create encoded token from proofs
      const token = getEncodedTokenV4({
        mint: normalizedMintUrl,
        proofs: proofsToSend.map((p) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
        unit: preferredUnit,
      });
      console.log("rdlogs: token", token);
      // Clean up pending proofs after successful token creation
      localStorage.removeItem(pendingProofsKey);

      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to generate token: ${message}`);
      console.log("rdlogs: amount adn error", amount, message);
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
   * @returns The received proofs
   */
  const receiveToken = async (token: string): Promise<Proof[]> => {
    setIsLoading(true);
    setError(null);

    try {
      // Decode token
      const decodedToken = getDecodedToken(token);
      if (!decodedToken) {
        throw new Error("Invalid token format");
      }

      const { mint: mintUrl, proofs: tokenProofs, unit: unit } = decodedToken;

      // if we don't have the mintUrl yet, add it
      const normalizedMintUrl = await addMintIfNotExists(mintUrl);
      const mintDetails = cashuStore.getMint(normalizedMintUrl);

      // Setup wallet for receiving
      const mint = new Mint(normalizedMintUrl);
      const keysets = mintDetails?.keysets;

      const activeKeysets = keysets?.filter((k) => (k as any)._active);
      const units = [...new Set(activeKeysets?.map((k) => (k as any)._unit))];
      const preferredUnit = units?.includes("msat")
        ? "msat"
        : units?.includes("sat")
          ? "sat"
          : units?.[0];

      console.log(activeKeysets, units, preferredUnit);

      const wallet = new Wallet(mint, { unit: preferredUnit });

      // Load mint keysets
      await wallet.loadMint();

      // Receive proofs from token
      const receivedProofs = await wallet.receive(token);
      // Create token event in Nostr
      try {
        // Attempt to create token in Nostr, but don't rely on the return value
        await updateProofs({
          mintUrl: normalizedMintUrl,
          proofsToAdd: receivedProofs,
          proofsToRemove: [],
        });
      } catch (err) {
        console.error("Error storing token in Nostr:", err);
      }

      // Create history event
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
        // Get the mintUrl from the decoded token
        const decodedToken = getDecodedToken(token);
        if (decodedToken && error instanceof Error) {
          (error as any).mintUrl = decodedToken.mint;
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

        const activeKeysets = keysets?.filter((k) => k.active);
        const units = [...new Set(activeKeysets?.map((k) => k.unit))];
        const preferredUnit = units?.includes("msat")
          ? "msat"
          : units?.includes("sat")
            ? "sat"
            : units?.[0];

        const wallet = new Wallet(mint, {
          unit: preferredUnit,
          keysets: keysets,
          mintInfo: mintDetails?.mintInfo,
          keys: Object.values(mintDetails?.keys || {}).flatMap((record) =>
            Object.values(record)
          ),
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

  /**
   * Migrate balances from inactive keysets to active keysets
   * For each mint with inactive keyset balances, creates a token with wallet.send
   * and receives it back with wallet.receive to swap into active keyset proofs
   */
  const migrateInactiveKeysetBalances = async () => {
    try {
      const proofs = await cashuStore.getAllProofs();
      const mints = cashuStore.mints;

      const inactiveBalances = calculateInactiveKeysetBalances(proofs, mints);

      // Check if there are any inactive balances to migrate
      const hasInactiveBalances = Object.values(inactiveBalances).some(
        (keysetBalances) => Object.keys(keysetBalances).length > 0
      );

      if (!hasInactiveBalances) {
        console.log("No inactive keyset balances to migrate");
        return;
      }

      console.log(
        "Found inactive keyset balances to migrate:",
        inactiveBalances
      );

      // Process each mint
      for (const mintUrl of Object.keys(inactiveBalances)) {
        const keysetBalances = inactiveBalances[mintUrl];

        if (Object.keys(keysetBalances).length === 0) {
          continue;
        }

        const normalizedMintUrl = mintUrl.replace(/\/+$/, "");
        const mintDetails = cashuStore.getMint(normalizedMintUrl);

        if (!mintDetails) {
          console.warn(`Mint details not found for ${normalizedMintUrl}`);
          continue;
        }

        const keysets = mintDetails.keysets;
        if (!keysets) {
          console.warn(`No keysets found for mint ${normalizedMintUrl}`);
          continue;
        }

        // Get active keysets for receiving
        const activeKeysets = keysets.filter(
          (k) => (k.active ?? (k as any)._active) === true
        );

        if (activeKeysets.length === 0) {
          console.warn(`No active keysets found for mint ${normalizedMintUrl}`);
          continue;
        }

        // Get preferred unit from active keysets
        const units = [
          ...new Set(activeKeysets.map((k) => k.unit ?? (k as any)._unit)),
        ];
        const preferredUnit = units?.includes("msat")
          ? "msat"
          : units?.includes("sat")
            ? "sat"
            : units?.[0];

        // Process each inactive keyset
        for (const keysetId of Object.keys(keysetBalances)) {
          const balance = keysetBalances[keysetId];

          if (balance <= 0) {
            continue;
          }

          console.log(
            `Migrating ${balance} from inactive keyset ${keysetId} on mint ${normalizedMintUrl}`
          );

          // Get proofs for this specific keyset and remove duplicates by C and secret
          const keysetProofsRaw = proofs.filter((p) => p.id === keysetId);
          const seen = new Set<string>();
          const keysetProofs = keysetProofsRaw.filter((p) => {
            const key = `${p.C}:${p.secret}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          }); // Rare edge case where we have duplicate proofs. Only happened as I wasn't deleting evetns from evetnStore. Can be removed later. TODO.

          if (keysetProofs.length === 0) {
            console.warn(`No proofs found for keyset ${keysetId}`);
            continue;
          }

          try {
            // Create wallet instance
            const mint = new Mint(normalizedMintUrl);
            const walletInstance = new Wallet(mint, {
              unit: preferredUnit,
              keysets: keysets,
              mintInfo: mintDetails.mintInfo,
              keys: Object.values(mintDetails.keys || {}).flatMap((record) =>
                Object.values(record)
              ),
            });

            await walletInstance.loadMint();

            // Try to send (swap) the proofs - this creates a token
            const sendResult = await walletInstance.send(
              balance,
              keysetProofs,
              {
                keysetId: activeKeysets[0]?.id,
              }
            );

            console.log(
              `Successfully migrated keyset ${keysetId}: received ${sendResult.send.length} new proofs`
            );

            // Update proofs in store - remove old inactive keyset proofs, add new active ones
            await updateProofs({
              mintUrl: normalizedMintUrl,
              proofsToAdd: [...sendResult.keep, ...sendResult.send],
              proofsToRemove: keysetProofs,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);

            if (
              message.includes("Token already spent") ||
              message.includes("Not enough funds available")
            ) {
              console.log(
                `Proofs for keyset ${keysetId} appear to be spent, cleaning up...`
              );

              // Clean spent proofs for this specific keyset
              await cleanSpentProofs(normalizedMintUrl, keysetId);
            } else {
              console.error(`Failed to migrate keyset ${keysetId}: ${message}`);
            }
          }
        }
      }

      console.log("Inactive keyset balance migration completed");
    } catch (error) {
      console.error("Error during inactive keyset migration:", error);
    }
  };

  /**
   * Clean up pending proofs after successful token creation
   * @param pendingProofsKey The key used to store pending proofs
   */
  const cleanupPendingProofs = (pendingProofsKey: string) => {
    try {
      localStorage.removeItem(pendingProofsKey);
    } catch (error) {
      console.error("Error cleaning up pending proofs:", error);
    }
  };

  /**
   * Reset the recovery state to allow re-running recovery
   * Useful for testing or manual recovery triggers
   */
  const resetRecoveryState = () => {
    recoveryInitiated = false;
    recoveryPromise = null;
    // Clear all recovery processed flags from sessionStorage
    const keys = Object.keys(sessionStorage).filter((key) =>
      key.startsWith("recovery_processed_")
    );
    keys.forEach((key) => sessionStorage.removeItem(key));
  };

  return {
    sendToken,
    receiveToken,
    cleanSpentProofs,
    cleanupPendingProofs,
    addMintIfNotExists,
    removeMint,
    resetRecoveryState,
    migrateInactiveKeysetBalances,
    isLoading,
    error,
  };
}
