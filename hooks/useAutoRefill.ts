"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  loadAutoRefillNWCSettings,
  loadAutoTopupAPISettings,
  updateNWCLastRefillTime,
  updateAPILastTopupTime,
  AutoRefillNWCSettings,
  AutoTopupAPISettings,
} from "@/utils/storageUtils";
import { payWithNWC, isNWCConnected } from "@/lib/nwcPayment";
import { useCashuStore } from "@/features/wallet/state/cashuStore";
import { useCashuWallet, useCashuToken } from "@/features/wallet";
import { useApiKeysSync } from "@/hooks/useApiKeysSync";
import { toast } from "sonner";
import { Proof } from "@cashu/cashu-ts";

// Cooldown period between auto-refills (5 minutes)
const AUTO_REFILL_COOLDOWN_MS = 5 * 60 * 1000;

// Minimum interval between balance checks (5 seconds for testing, can increase later)
const BALANCE_CHECK_INTERVAL_MS = 5 * 1000;

export interface AutoRefillStatus {
  nwcAutoRefillEnabled: boolean;
  apiAutoTopupEnabled: boolean;
  isProcessingNWCRefill: boolean;
  isProcessingAPITopup: boolean;
  lastNWCRefillAt: number | null;
  lastAPITopupAt: number | null;
}

interface UseAutoRefillProps {
  balance: number;
  onProofsReceived?: (proofs: Proof[]) => void;
}

/**
 * Hook that monitors wallet balances and triggers auto-refills when needed.
 *
 * Features:
 * - Monitors Cashu wallet balance
 * - Triggers NWC payment when Cashu balance < threshold
 * - Implements cooldown to prevent rapid successive refills
 */
export function useAutoRefill({
  balance,
  onProofsReceived,
}: UseAutoRefillProps): AutoRefillStatus {
  const cashuStore = useCashuStore();
  const { updateProofs } = useCashuWallet();
  const { sendToken } = useCashuToken();

  // Get synced API keys for balance monitoring
  const { syncedApiKeys } = useApiKeysSync();

  // Track processing states
  const isProcessingNWCRef = useRef(false);
  const isProcessingAPIRef = useRef(false);
  const lastCheckTimeRef = useRef(0);
  const lastAPICheckTimeRef = useRef(0);

  // Track settings for status return
  const settingsRef = useRef<{
    nwc: AutoRefillNWCSettings;
    api: AutoTopupAPISettings;
  }>({
    nwc: loadAutoRefillNWCSettings(),
    api: loadAutoTopupAPISettings(),
  });

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
   * Execute API auto-topup
   */
  const executeAPITopup = useCallback(
    async (
      settings: AutoTopupAPISettings,
      _apiKeyBalance: number,
      apiKeyBaseUrl: string
    ) => {
      if (isProcessingAPIRef.current) return;
      if (!settings.apiKey) return;
      if (!cashuStore.activeMintUrl) return;

      try {
        isProcessingAPIRef.current = true;

        toast.info(`Auto-topping up API key with ${settings.amount} sats...`);

        // Generate Cashu token for topup using sendToken
        const cashuToken = await sendToken(
          cashuStore.activeMintUrl,
          settings.amount
        );

        if (!cashuToken) {
          throw new Error("Failed to generate token for topup");
        }

        // Make topup request to API
        const response = await fetch(
          `${apiKeyBaseUrl}v1/wallet/topup?cashu_token=${encodeURIComponent(
            cashuToken
          )}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${settings.apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.detail || `Topup failed with status ${response.status}`
          );
        }

        updateAPILastTopupTime();
        toast.success(`Auto-topped up API key with ${settings.amount} sats!`);
      } catch (error) {
        console.error("[useAutoRefill] API topup error:", error);
        toast.error(
          `API auto-topup failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      } finally {
        isProcessingAPIRef.current = false;
      }
    },
    [cashuStore.activeMintUrl, sendToken]
  );

  /**
   * Main balance check and auto-refill logic
   */
  useEffect(() => {
    const checkAndRefill = async () => {
      // Throttle checks
      const now = Date.now();
      const timeSinceLastCheck = now - lastCheckTimeRef.current;

      if (timeSinceLastCheck < BALANCE_CHECK_INTERVAL_MS) {
        return;
      }
      lastCheckTimeRef.current = now;

      // Load current settings
      const nwcSettings = loadAutoRefillNWCSettings();
      const apiSettings = loadAutoTopupAPISettings();
      settingsRef.current = { nwc: nwcSettings, api: apiSettings };

      // Check NWC auto-refill
      if (nwcSettings.enabled && !isProcessingNWCRef.current) {
        if (!isInCooldown(nwcSettings.lastRefillAt)) {
          // Check if balance is below threshold
          if (balance < nwcSettings.threshold) {
            await executeNWCRefill(nwcSettings);
          }
        }
      }

      // Check API auto-topup
      if (
        apiSettings.enabled &&
        apiSettings.apiKey &&
        !isProcessingAPIRef.current
      ) {
        if (!isInCooldown(apiSettings.lastTopupAt)) {
          // Find the configured API key in synced keys
          const targetApiKey = syncedApiKeys.find(
            (k) => k.key === apiSettings.apiKey
          );

          if (targetApiKey) {
            // API key balance is in msats, threshold is also in msats
            const apiKeyBalanceMsats = targetApiKey.balance ?? 0;

            if (apiKeyBalanceMsats < apiSettings.threshold) {
              // Check if we have enough in Cashu wallet to topup
              if (balance >= apiSettings.amount) {
                await executeAPITopup(
                  apiSettings,
                  apiKeyBalanceMsats,
                  targetApiKey.baseUrl || ""
                );
              }
            }
          }
        }
      }
    };

    // Run check when balance or API keys change
    checkAndRefill();
  }, [balance, syncedApiKeys, isInCooldown, executeNWCRefill, executeAPITopup]);

  return {
    nwcAutoRefillEnabled: settingsRef.current.nwc.enabled,
    apiAutoTopupEnabled: settingsRef.current.api.enabled,
    isProcessingNWCRefill: isProcessingNWCRef.current,
    isProcessingAPITopup: isProcessingAPIRef.current,
    lastNWCRefillAt: settingsRef.current.nwc.lastRefillAt || null,
    lastAPITopupAt: settingsRef.current.api.lastTopupAt || null,
  };
}
