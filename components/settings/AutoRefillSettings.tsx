"use client";

import React, { useState, useEffect } from "react";
import { Zap, RefreshCw, Info } from "lucide-react";
import {
  loadAutoRefillNWCSettings,
  saveAutoRefillNWCSettings,
  loadAutoTopupAPISettings,
  saveAutoTopupAPISettings,
  AutoRefillNWCSettings,
  AutoTopupAPISettings,
  DEFAULT_AUTO_REFILL_NWC_SETTINGS,
  DEFAULT_AUTO_TOPUP_API_SETTINGS,
} from "@/utils/storageUtils";
import { isNWCConnected, getNWCBalance } from "@/lib/nwcPayment";
import { useApiKeysSync } from "@/hooks/useApiKeysSync";

interface StoredApiKey {
  key: string;
  balance: number | null;
  label?: string;
  baseUrl?: string;
  isInvalid?: boolean;
}

interface AutoRefillSettingsProps {
  apiKeys?: StoredApiKey[];
}

/**
 * Settings component for configuring NWC auto-refill and API auto-topup
 */
const AutoRefillSettings: React.FC<AutoRefillSettingsProps> = ({
  apiKeys = [],
}) => {
  // Get cloud-synced API keys
  const { syncedApiKeys, isLoadingApiKeys } = useApiKeysSync();

  // NWC Auto-Refill State
  const [nwcSettings, setNwcSettings] = useState<AutoRefillNWCSettings>(
    DEFAULT_AUTO_REFILL_NWC_SETTINGS
  );
  const [isNwcConnected, setIsNwcConnected] = useState(false);
  const [nwcBalance, setNwcBalance] = useState<number | null>(null);

  // API Auto-Topup State
  const [apiSettings, setApiSettings] = useState<AutoTopupAPISettings>(
    DEFAULT_AUTO_TOPUP_API_SETTINGS
  );

  // Tooltip states
  const [showNwcTooltip, setShowNwcTooltip] = useState(false);
  const [showApiTooltip, setShowApiTooltip] = useState(false);

  // Loaded API keys state (load from localStorage if not passed as prop and not cloud synced)
  const [loadedApiKeys, setLoadedApiKeys] = useState<StoredApiKey[]>([]);

  // Load settings from storage on mount
  useEffect(() => {
    setNwcSettings(loadAutoRefillNWCSettings());
    setApiSettings(loadAutoTopupAPISettings());

    // Check NWC connection status
    const checkNwcStatus = async () => {
      const connected = await isNWCConnected();
      setIsNwcConnected(connected);
      if (connected) {
        const balance = await getNWCBalance();
        setNwcBalance(balance);
      }
    };

    checkNwcStatus();

    // Load API keys from localStorage if not passed as prop
    if (apiKeys.length === 0) {
      try {
        // Try multiple possible storage keys
        const possibleKeys = ["api_keys", "stored_api_keys"];
        let foundKeys: StoredApiKey[] = [];

        for (const key of possibleKeys) {
          const storedKeys = localStorage.getItem(key);
          console.log(
            `[AutoRefillSettings] Checking localStorage key '${key}':`,
            storedKeys ? "found" : "not found"
          );
          if (storedKeys) {
            foundKeys = JSON.parse(storedKeys);
            console.log(
              `[AutoRefillSettings] Loaded ${foundKeys.length} API keys from '${key}'`
            );
            break;
          }
        }

        if (foundKeys.length > 0) {
          setLoadedApiKeys(foundKeys);
        } else {
          console.log("[AutoRefillSettings] No API keys found in localStorage");
        }
      } catch (e) {
        console.error(
          "[AutoRefillSettings] Error loading API keys from localStorage:",
          e
        );
      }
    } else {
      console.log(
        `[AutoRefillSettings] Using ${apiKeys.length} API keys from props`
      );
    }
  }, [apiKeys.length]);

  // Save NWC settings when changed
  const updateNwcSettings = (updates: Partial<AutoRefillNWCSettings>) => {
    const newSettings = { ...nwcSettings, ...updates };
    setNwcSettings(newSettings);
    saveAutoRefillNWCSettings(newSettings);
  };

  // Save API settings when changed
  const updateApiSettings = (updates: Partial<AutoTopupAPISettings>) => {
    const newSettings = { ...apiSettings, ...updates };
    setApiSettings(newSettings);
    saveAutoTopupAPISettings(newSettings);
  };

  // Get valid API keys for the dropdown
  // Priority: 1) Props, 2) Cloud-synced, 3) localStorage
  const effectiveApiKeys =
    apiKeys.length > 0
      ? apiKeys
      : syncedApiKeys.length > 0
      ? syncedApiKeys
      : loadedApiKeys;
  const validApiKeys = effectiveApiKeys.filter((k) => !k.isInvalid);

  console.log("[AutoRefillSettings] API keys:", {
    propsCount: apiKeys.length,
    syncedCount: syncedApiKeys.length,
    localCount: loadedApiKeys.length,
    effectiveCount: effectiveApiKeys.length,
    isLoadingApiKeys,
  });

  return (
    <div className="mb-6 space-y-4">
      <h3 className="text-sm font-medium text-white/80 mb-2">
        Auto-Refill Settings
      </h3>

      {/* NWC Auto-Refill Section */}
      <div className="bg-white/5 border border-white/10 rounded-md p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            <span className="text-sm font-medium text-white/80">
              NWC Auto-Refill
            </span>
            <div
              className="relative inline-block"
              onMouseEnter={() => setShowNwcTooltip(true)}
              onMouseLeave={() => setShowNwcTooltip(false)}
            >
              <Info className="h-3.5 w-3.5 text-white/40 hover:text-white/60 cursor-pointer" />
              {showNwcTooltip && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 p-2 bg-black border border-white/20 rounded-md text-xs text-white/70 w-56 z-50">
                  Automatically pay from your connected NWC wallet when your
                  Cashu balance drops below the threshold.
                </div>
              )}
            </div>
          </div>
          {isNwcConnected ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-400">Connected</span>
              {nwcBalance !== null && (
                <span className="text-xs text-white/50">
                  ({nwcBalance.toLocaleString()} sats)
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-white/40">Not connected</span>
          )}
        </div>

        {!isNwcConnected ? (
          <p className="text-xs text-white/40">
            Connect an NWC wallet in the Lightning Wallet section above to
            enable auto-refill.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/70">Enable Auto-Refill</span>
              <button
                type="button"
                role="switch"
                aria-checked={nwcSettings.enabled}
                onClick={() =>
                  updateNwcSettings({ enabled: !nwcSettings.enabled })
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                  nwcSettings.enabled ? "bg-blue-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    nwcSettings.enabled ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {nwcSettings.enabled && (
              <>
                {/* Threshold Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-white/50 shrink-0">
                    When balance drops below
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      value={nwcSettings.threshold}
                      onChange={(e) =>
                        updateNwcSettings({
                          threshold: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-xs text-white/50">sats</span>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-white/50 shrink-0">
                    Refill with
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      value={nwcSettings.amount}
                      onChange={(e) =>
                        updateNwcSettings({
                          amount: parseInt(e.target.value) || 100,
                        })
                      }
                      className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-xs text-white/50">sats</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* API Auto-Topup Section */}
      <div className="bg-white/5 border border-white/10 rounded-md p-3">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-white/80">
            API Auto-Topup
          </span>
          <div
            className="relative inline-block"
            onMouseEnter={() => setShowApiTooltip(true)}
            onMouseLeave={() => setShowApiTooltip(false)}
          >
            <Info className="h-3.5 w-3.5 text-white/40 hover:text-white/60 cursor-pointer" />
            {showApiTooltip && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 p-2 bg-black border border-white/20 rounded-md text-xs text-white/70 w-56 z-50">
                Automatically topup your API key from your Cashu wallet when its
                balance drops below the threshold.
              </div>
            )}
          </div>
        </div>

        {validApiKeys.length === 0 ? (
          <p className="text-xs text-white/40">
            Create an API key in the API Keys tab to enable auto-topup.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/70">Enable Auto-Topup</span>
              <button
                type="button"
                role="switch"
                aria-checked={apiSettings.enabled}
                onClick={() =>
                  updateApiSettings({ enabled: !apiSettings.enabled })
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                  apiSettings.enabled ? "bg-blue-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    apiSettings.enabled ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {apiSettings.enabled && (
              <>
                {/* API Key Selector */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-white/50 shrink-0">
                    API Key
                  </label>
                  <select
                    value={apiSettings.apiKey || ""}
                    onChange={(e) =>
                      updateApiSettings({ apiKey: e.target.value || null })
                    }
                    className="flex-1 max-w-[180px] bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select API Key</option>
                    {validApiKeys.map((key) => (
                      <option key={key.key} value={key.key}>
                        {key.label || "Unnamed"} (
                        {key.balance !== null
                          ? `${(key.balance / 1000).toFixed(0)} sats`
                          : "N/A"}
                        )
                      </option>
                    ))}
                  </select>
                </div>

                {/* Threshold Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-white/50 shrink-0">
                    When balance drops below
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      value={Math.floor(apiSettings.threshold / 1000)} // Convert mSats to sats for display
                      onChange={(e) =>
                        updateApiSettings({
                          threshold: (parseInt(e.target.value) || 0) * 1000,
                        })
                      }
                      className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-xs text-white/50">sats</span>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-white/50 shrink-0">
                    Topup with
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      value={apiSettings.amount}
                      onChange={(e) =>
                        updateApiSettings({
                          amount: parseInt(e.target.value) || 100,
                        })
                      }
                      className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-xs text-white/50">sats</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AutoRefillSettings;
