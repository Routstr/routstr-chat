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
          console.log(
            "[useAutoRefill] NWC not connected, skipping auto-refill"
          );
          return;
        }

        console.log(
          `[useAutoRefill] Triggering NWC auto-refill: ${settings.amount} sats`
        );
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

        console.log(
          `[useAutoRefill] Triggering API auto-topup: ${settings.amount} sats`
        );
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

      console.log(
        `[useAutoRefill] Balance check triggered. Balance: ${balance}, Time since last check: ${timeSinceLastCheck}ms`
      );

      if (timeSinceLastCheck < BALANCE_CHECK_INTERVAL_MS) {
        console.log(
          `[useAutoRefill] Skipping - throttled (need ${
            BALANCE_CHECK_INTERVAL_MS - timeSinceLastCheck
          }ms more)`
        );
        return;
      }
      lastCheckTimeRef.current = now;

      // Load current settings
      const nwcSettings = loadAutoRefillNWCSettings();
      const apiSettings = loadAutoTopupAPISettings();
      settingsRef.current = { nwc: nwcSettings, api: apiSettings };

      console.log(`[useAutoRefill] Settings loaded:`, {
        nwcEnabled: nwcSettings.enabled,
        nwcThreshold: nwcSettings.threshold,
        nwcAmount: nwcSettings.amount,
        isProcessing: isProcessingNWCRef.current,
        lastRefillAt: nwcSettings.lastRefillAt,
        inCooldown: isInCooldown(nwcSettings.lastRefillAt),
      });

      // Check NWC auto-refill
      if (nwcSettings.enabled && !isProcessingNWCRef.current) {
        if (!isInCooldown(nwcSettings.lastRefillAt)) {
          // Check if balance is below threshold
          if (balance < nwcSettings.threshold) {
            console.log(
              `[useAutoRefill] Balance ${balance} below threshold ${nwcSettings.threshold} - TRIGGERING REFILL`
            );
            await executeNWCRefill(nwcSettings);
          } else {
            console.log(
              `[useAutoRefill] Balance ${balance} >= threshold ${nwcSettings.threshold} - no refill needed`
            );
          }
        } else {
          console.log(`[useAutoRefill] In cooldown, skipping refill`);
        }
      } else if (!nwcSettings.enabled) {
        console.log(`[useAutoRefill] NWC auto-refill is disabled`);
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

            console.log(
              `[useAutoRefill] API key balance: ${apiKeyBalanceMsats} msats, threshold: ${apiSettings.threshold} msats`
            );

            if (apiKeyBalanceMsats < apiSettings.threshold) {
              // Check if we have enough in Cashu wallet to topup
              if (balance >= apiSettings.amount) {
                console.log(
                  `[useAutoRefill] API key balance ${apiKeyBalanceMsats} msats below threshold ${apiSettings.threshold} msats - TRIGGERING TOPUP`
                );
                await executeAPITopup(
                  apiSettings,
                  apiKeyBalanceMsats,
                  targetApiKey.baseUrl || ""
                );
              } else {
                console.log(
                  `[useAutoRefill] API key needs topup but Cashu balance (${balance}) < topup amount (${apiSettings.amount})`
                );
              }
            } else {
              console.log(
                `[useAutoRefill] API key balance sufficient - no topup needed`
              );
            }
          } else {
            console.log(
              `[useAutoRefill] Configured API key not found in synced keys`
            );
          }
        } else {
          console.log(`[useAutoRefill] API topup in cooldown, skipping`);
        }
      } else if (!apiSettings.enabled) {
        // Only log this occasionally to avoid spam
        if (Math.random() < 0.1) {
          console.log(`[useAutoRefill] API auto-topup is disabled`);
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
