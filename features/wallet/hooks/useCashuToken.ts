import { useState, useEffect } from 'react';
import { useCashuStore } from '../state/cashuStore';
import { useCashuWallet } from './useCashuWallet';
import { useCashuHistory } from './useCashuHistory';
import { CashuMint, CashuWallet, Proof, getDecodedToken, CheckStateEnum, getEncodedTokenV4 } from '@cashu/cashu-ts';
import { selectProofsAdvanced } from '../core/utils/change-making';
import { calculateFees } from '../core/utils/fees';
import { MintService } from '../core/services/MintService';
import { hashToCurve } from "@cashu/crypto/modules/common";

// Global flag to track if recovery has been initiated in this session
let recoveryInitiated = false;
let recoveryPromise: Promise<void> | null = null;

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
      const keys = Object.keys(localStorage).filter(key => key.startsWith('pending_send_proofs_'));
      
      for (const key of keys) {
        try {
          // Check if this specific proof has already been processed
          const recoveryKey = `recovery_processed_${key}`;
          if (sessionStorage.getItem(recoveryKey)) {
            console.log('rdlogs: Skipping already processed pending proof:', key);
            continue;
          }
          
          const pendingData = JSON.parse(localStorage.getItem(key) || '{}');
          const { mintUrl, proofsToSend, timestamp } = pendingData;
          
          // Only recover proofs that are less than 1 hour old to avoid stale data
          if (Date.now() - timestamp < 60 * 60 * 1000 && mintUrl && proofsToSend) {
            console.log('rdlogs: Recovering pending proofs:', key);
            
            // Mark this proof as being processed
            sessionStorage.setItem(recoveryKey, 'true');
            
            // Add the proofs back to the wallet
            await updateProofs({
              mintUrl,
              proofsToAdd: proofsToSend,
              proofsToRemove: []
            });
          }
          
          // Clean up the pending entry regardless
          localStorage.removeItem(key);
        } catch (error) {
          console.error('Error recovering pending proofs for key:', key, error);
          // Clean up corrupted entries
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error('Error during pending proofs recovery:', error);
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
  const sendToken = async (mintUrl: string, amount: number, p2pkPubkey?: string): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      const mint = new CashuMint(mintUrl);
      const keysets = await mint.getKeySets();
      
      // Get preferred unit: msat over sat if both are active
      const activeKeysets = keysets.keysets.filter(k => k.active);
      const units = [...new Set(activeKeysets.map(k => k.unit))];
      const preferredUnit = units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : 'not supported');
      
      const wallet = new CashuWallet(mint, { unit: preferredUnit });

      // Load mint keysets
      await wallet.loadMint();

      // Get all proofs from store
      let proofs = await cashuStore.getMintProofs(mintUrl);
      
      const proofsAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
      const denominationCounts = proofs.reduce((acc, p) => {
        acc[p.amount] = (acc[p.amount] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      // console.log('rdlogs: Proof denomination groups:', denominationCounts);
      if (proofsAmount < amount) {
        throw new Error(`Not enough funds on mint ${mintUrl}`);
      }

      let proofsToKeep: Proof[], proofsToSend: Proof[];

      try {
        const result = await wallet.send(amount, proofs, { pubkey: p2pkPubkey, privkey: cashuStore.privkey});
        proofsToKeep = result.keep;
        proofsToSend = result.send;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if(message.includes("Not enough funds available") || message.includes("Token already spent")) {
          console.log('rdlogs: wallet.send() failed with insufficient funds, trying exact change with tolerance');
          
          // Clean spent proofs
          await cleanSpentProofs(mintUrl);

          // Get fresh proofs after cleanup
          proofs = await cashuStore.getMintProofs(mintUrl);
          
          // Check if we still have enough funds after cleanup
          const newProofsAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
          if (newProofsAmount < amount) {
            throw new Error(`Not enough funds on mint ${mintUrl} after cleaning spent proofs`);
          }

          // Use advanced proof selection with tolerance fallback
          const result = selectProofsAdvanced(amount, proofs, activeKeysets, mintUrl);
          proofsToKeep = result.proofsToKeep;
          proofsToSend = result.proofsToSend;
        } else {
          // Re-throw the error if it's not a "Token already spent" error
          throw error;
        }
      }

      // Store proofs temporarily before updating wallet state
      const pendingProofsKey = `pending_send_proofs_${Date.now()}`;
      localStorage.setItem(pendingProofsKey, JSON.stringify({
        mintUrl,
        proofsToSend: proofsToSend.map(p => ({
          id: p.id || '',
          amount: p.amount,
          secret: p.secret || '',
          C: p.C || ''
        })),
        timestamp: Date.now()
      }));
      const sendFees = calculateFees(proofsToSend, activeKeysets);
      // console.log('rdlogs: fees to send ', amount, ' is ', sendFees)

      // Create new token for the proofs we're keeping
      if (proofsToKeep.length > 0) {
        // update proofs
        await updateProofs({ mintUrl, proofsToAdd: proofsToKeep, proofsToRemove: [...proofsToSend, ...proofs] });

        // Create history event
        await createHistory({
          direction: 'out',
          amount: amount.toString(),
        });
      }
      
      // Create encoded token from proofs
      const token = getEncodedTokenV4({
        mint: mintUrl,
        proofs: proofsToSend.map((p) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
        unit: preferredUnit
      });
      
      // Clean up pending proofs after successful token creation
      localStorage.removeItem(pendingProofsKey);
      
      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to generate token: ${message}`);
      console.log('rdlogs: amount adn error', amount, message)
      throw error;
    } finally {
      setIsLoading(false);
    }

  };

  const normalizeMintUrl = (url: string) => url.replace(/\/+$/, '');

  const ensureMintInitialized = async (mintUrl: string) => {
    const normalizedMintUrl = normalizeMintUrl(mintUrl);
    const existingMint = cashuStore.mints.find((mint) => mint.url === normalizedMintUrl);
    const needsActivation = !existingMint || !existingMint.mintInfo || !existingMint.keysets?.length || !existingMint.keys?.length;

    if (!existingMint) {
      cashuStore.addMint(normalizedMintUrl);
    }

      if (needsActivation) {
      try {
        const mintService = new MintService();
        const { mintInfo, keysets } = await mintService.activateMint(normalizedMintUrl);
        cashuStore.setMintInfo(normalizedMintUrl, mintInfo);
        cashuStore.setKeysets(normalizedMintUrl, keysets);
        const { keys } = await mintService.updateMintKeys(normalizedMintUrl, keysets);
        cashuStore.setKeys(normalizedMintUrl, keys);
      } catch (err) {
        console.error('Failed to initialize mint data:', err);
      }
    }

    return normalizedMintUrl;
  };

  const addMintIfNotExists = async (mintUrl: string) => {
    const normalizedMintUrl = await ensureMintInitialized(mintUrl);

    try {
      new URL(normalizedMintUrl);
    } catch (err) {
      throw new Error('Invalid mint URL: ' + mintUrl);
    }

    if (!wallet) {
      console.warn('Wallet not loaded when trying to add mint URL:', normalizedMintUrl);
      return normalizedMintUrl;
    }

    if (!wallet.mints.includes(normalizedMintUrl)) {
      try {
        await createWallet({
          ...wallet,
          mints: [...wallet.mints, normalizedMintUrl],
        });
      } catch (err) {
        console.error('Failed to persist mint URL to wallet:', err);
      }
    }

    return normalizedMintUrl;
  };

  const removeMint = async (mintUrl: string) => {
    // Validate URL
    new URL(mintUrl);
    if (!wallet) {
      throw new Error('Wallet not found, trying to remove mint URL: ' + mintUrl);
    }
    // Check if mint exists in wallet
    if (!wallet.mints.includes(mintUrl)) {
      throw new Error('Mint URL not found in wallet: ' + mintUrl);
    }
    // Remove mint from wallet
    createWallet({
      ...wallet,
      mints: wallet.mints.filter(mint => mint !== mintUrl),
    });
  }

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
        throw new Error('Invalid token format');
      }

      const { mint: mintUrl, proofs: tokenProofs, unit: unit } = decodedToken;

      // if we don't have the mintUrl yet, add it
      const normalizedMintUrl = await addMintIfNotExists(mintUrl);

      // Setup wallet for receiving
      const mint = new CashuMint(normalizedMintUrl);
      const keysets = await mint.getKeySets();
      
      // Get preferred unit: msat over sat if both are active
      const activeKeysets = keysets.keysets.filter(k => k.active);
      const units = [...new Set(activeKeysets.map(k => k.unit))];
      const preferredUnit = units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : 'not supported');
      
      const wallet = new CashuWallet(mint, { unit: preferredUnit });

      // Load mint keysets
      await wallet.loadMint();

      // Receive proofs from token
      const receivedProofs = await wallet.receive(token);
      // Create token event in Nostr
      try {
        // Attempt to create token in Nostr, but don't rely on the return value
        await updateProofs({ mintUrl: normalizedMintUrl, proofsToAdd: receivedProofs, proofsToRemove: [] });
      } catch (err) {
        console.error('Error storing token in Nostr:', err);
      }

      // Create history event
      const totalAmount = receivedProofs.reduce((sum, p) => sum + p.amount, 0);
      await createHistory({
        direction: 'in',
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
      }
      else if (message.includes("Wallet not found")) {
        if (error instanceof Error) {
          (error as any).token = token;
        } 
      }
      
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const cleanSpentProofs = async (mintUrl: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const mint = new CashuMint(mintUrl);
      
      // Get preferred unit: msat over sat if both are active
      const keysets = await mint.getKeySets();
      const activeKeysets = keysets.keysets.filter(k => k.active);
      const units = [...new Set(activeKeysets.map(k => k.unit))];
      const preferredUnit = units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : units[0]);
      
      const wallet = new CashuWallet(mint, { unit: preferredUnit });

      await wallet.loadMint();

      const proofs = await cashuStore.getMintProofs(mintUrl);

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

      await updateProofs({ mintUrl, proofsToAdd: [], proofsToRemove: spentProofs });

      return spentProofs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to clean spent proofs: ${message}`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Clean up pending proofs after successful token creation
   * @param pendingProofsKey The key used to store pending proofs
   */
  const cleanupPendingProofs = (pendingProofsKey: string) => {
    try {
      localStorage.removeItem(pendingProofsKey);
    } catch (error) {
      console.error('Error cleaning up pending proofs:', error);
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
    const keys = Object.keys(sessionStorage).filter(key => key.startsWith('recovery_processed_'));
    keys.forEach(key => sessionStorage.removeItem(key));
  };

  return {
    sendToken,
    receiveToken,
    cleanSpentProofs,
    cleanupPendingProofs,
    addMintIfNotExists,
    removeMint,
    resetRecoveryState,
    isLoading,
    error
  };
}
