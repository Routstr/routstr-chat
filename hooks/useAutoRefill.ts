"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  loadAutoRefillNWCSettings,
  updateNWCLastRefillTime,
  AutoRefillNWCSettings,
} from "@/utils/storageUtils";
import { payWithNWC, isNWCConnected } from "@/lib/nwcPayment";
import { useDepositMint, usePurse } from "@/features/wallet/view";
import { toast } from "sonner";

// Cooldown period between auto-refills (5 minutes)
const AUTO_REFILL_COOLDOWN_MS = 5 * 60 * 1000;

// Minimum interval between balance checks (5 seconds for testing, can increase later)
const BALANCE_CHECK_INTERVAL_MS = 5 * 1000;

// one refill at a time on this device, whichever tab starts it
const REFILL_LOCK = "routstr-chat-auto-refill";

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
  const purse = usePurse();
  const depositTo = useDepositMint();

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
      // the account active now gets the refill, even if another is by the time it lands
      const from = purse();
      if (!from) return;

      try {
        // Double-check NWC connection
        const connected = await isNWCConnected();
        if (!connected) {
          return;
        }

        // where the provider about to be paid can take it, as Add does
        const balances = await from.balances();
        const mintUrl = depositTo(balances, settings.amount);

        toast.info(`Auto-refilling ${settings.amount} sats from NWC wallet...`);

        const result = await payWithNWC(
          settings.amount,
          mintUrl,
          from,
          {
            onPaymentSuccess: () => {
              updateNWCLastRefillTime();
              toast.success(`Auto-refilled ${settings.amount} sats from NWC wallet!`);
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
      }
    },
    [purse, depositTo]
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

      // a tab that finds a refill going on, here or in another tab, leaves it be; the settings are
      // read under the lock, so a refill that just landed elsewhere has started its cooldown
      await navigator.locks?.request(REFILL_LOCK, { ifAvailable: true }, async (lock) => {
        const nwcSettings = loadAutoRefillNWCSettings();
        if (lock && nwcSettings.enabled && !isInCooldown(nwcSettings.lastRefillAt) && balance < nwcSettings.threshold) {
          await executeNWCRefill(nwcSettings);
        }
      });
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
