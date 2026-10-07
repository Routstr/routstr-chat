"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  loadAutoRefillNWCSettings,
  updateNWCLastRefillTime,
  AutoRefillNWCSettings,
} from "@/utils/storageUtils";
import { payWithNWC, isNWCConnected } from "@/lib/nwcPayment";
import { useCashuStore } from "@/features/wallet/state/cashuStore";
import { currentOwner } from "@/features/session/owned";
import { useCashuWallet } from "@/features/wallet";
import { toast } from "sonner";

// Cooldown period between auto-refills (5 minutes)
const AUTO_REFILL_COOLDOWN_MS = 5 * 60 * 1000;

// Minimum interval between balance checks (5 seconds for testing, can increase later)
const BALANCE_CHECK_INTERVAL_MS = 5 * 1000;

interface UseAutoRefillProps {
  balance: number;
  isWalletLoaded: boolean;
}

/**
 * Hook that monitors wallet balances and triggers auto-refills when needed.
 *
 * Features:
 * - Monitors Cashu wallet balance
 * - Triggers NWC payment when Cashu balance < threshold
 * - Implements cooldown to prevent rapid successive refills
 * - Only triggers when wallet is fully loaded
 */
export function useAutoRefill({
  balance,
  isWalletLoaded,
}: UseAutoRefillProps): void {
  const cashuStore = useCashuStore();
  const { updateProofs } = useCashuWallet();

  // Track processing states
  const isProcessingNWCRef = useRef(false);
  const lastCheckTimeRef = useRef(0);

  /**
   * Check if we're within the cooldown period
   */
  const isInCooldown = useCallback(
    (lastRefillAt: number | undefined): boolean => {
      if (!lastRefillAt) return false;
      return Date.now() - lastRefillAt < AUTO_REFILL_COOLDOWN_MS;
    },
    []
  );

  /**
   * Execute NWC auto-refill
   */
  const executeNWCRefill = useCallback(
    async (settings: AutoRefillNWCSettings) => {
      if (isProcessingNWCRef.current) return;
      if (!cashuStore.activeMintUrl) return;
      const owner = currentOwner();

      try {
        isProcessingNWCRef.current = true;

        // Double-check NWC connection
        const connected = await isNWCConnected();
        if (!connected) {
          return;
        }

        toast.info(`Auto-refilling ${settings.amount} sats from NWC wallet...`);

        const result = await payWithNWC(
          settings.amount,
          cashuStore.activeMintUrl,
          owner,
          {
            onPaymentSuccess: async (proofs, amount) => {
              // Add proofs to wallet
              if (proofs.length > 0 && cashuStore.activeMintUrl) {
                await updateProofs({
                  mintUrl: cashuStore.activeMintUrl,
                  proofsToAdd: proofs,
                  proofsToRemove: [],
                });
              }
              updateNWCLastRefillTime();
              toast.success(`Auto-refilled ${amount} sats from NWC wallet!`);
            },
            onPaymentError: (error) => {
              console.error("[useAutoRefill] NWC payment error:", error);
              toast.error(`Auto-refill failed: ${error.message}`);
            },
          }
        );

        if (result.success) {
          // Update last refill time even if proofs are empty (they might come later)
          updateNWCLastRefillTime();
        }
      } catch (error) {
        console.error("[useAutoRefill] Auto-refill error:", error);
      } finally {
        isProcessingNWCRef.current = false;
      }
    },
    [cashuStore.activeMintUrl, updateProofs]
  );

  /**
   * Main balance check and auto-refill logic
   */
  useEffect(() => {
    const checkAndRefill = async () => {
      // Skip if wallet is not fully loaded yet
      if (!isWalletLoaded) {
        return;
      }

      // Throttle checks
      const now = Date.now();
      const timeSinceLastCheck = now - lastCheckTimeRef.current;

      if (timeSinceLastCheck < BALANCE_CHECK_INTERVAL_MS) {
        return;
      }
      lastCheckTimeRef.current = now;

      // Load current settings
      const nwcSettings = loadAutoRefillNWCSettings();

      // Check NWC auto-refill
      if (nwcSettings.enabled && !isProcessingNWCRef.current) {
        if (!isInCooldown(nwcSettings.lastRefillAt)) {
          // Check if balance is below threshold
          if (balance < nwcSettings.threshold) {
            await executeNWCRefill(nwcSettings);
          }
        }
      }
    };

    // Run check when balance changes (only when wallet is loaded)
    checkAndRefill();
  }, [
    balance,
    isWalletLoaded,
    isInCooldown,
    executeNWCRefill,
  ]);
}
