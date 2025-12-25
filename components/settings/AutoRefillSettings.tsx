"use client";

import React, { useState, useEffect } from "react";
import { Zap, RefreshCw, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
import { useAppContext } from "@/hooks/useAppContext";
import { formatSats } from "@/features/wallet";

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
  const { config } = useAppContext();
  const unit = config.unit || "₿";
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
        const possibleKeys = ["api_keys", "stored_api_keys"];
        let foundKeys: StoredApiKey[] = [];

        for (const key of possibleKeys) {
          const storedKeys = localStorage.getItem(key);
          if (storedKeys) {
            foundKeys = JSON.parse(storedKeys);
            break;
          }
        }

        if (foundKeys.length > 0) {
          setLoadedApiKeys(foundKeys);
        }
      } catch (e) {
        console.error(
          "[AutoRefillSettings] Error loading API keys from localStorage:",
          e
        );
      }
    } else {
      // API keys passed via props, no need to load from localStorage
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

  return (
    <div className="mb-6 space-y-4">
      <h3 className="text-sm font-medium text-foreground/80 mb-2">
        Auto-Refill Settings
      </h3>

      {/* NWC Auto-Refill Section */}
      <div className="bg-muted/50 border border-border rounded-md p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            <span className="text-sm font-medium text-foreground/80">
              NWC Auto-Refill
            </span>
            <div
              className="relative inline-block"
              onMouseEnter={() => setShowNwcTooltip(true)}
              onMouseLeave={() => setShowNwcTooltip(false)}
            >
              <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-pointer" />
              {showNwcTooltip && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 p-2 bg-card border border-border rounded-md text-xs text-muted-foreground w-56 z-50">
                  Automatically pay from your connected NWC wallet when your
                  Cashu balance drops below the threshold.
                </div>
              )}
            </div>
          </div>
          {isNwcConnected ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-600 dark:text-green-400">
                Connected
              </span>
              {nwcBalance !== null && (
                <span className="text-xs text-muted-foreground">
                  ({formatSats(nwcBalance, unit)})
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Not connected</span>
          )}
        </div>

        {!isNwcConnected ? (
          <p className="text-xs text-muted-foreground">
            Connect an NWC wallet in the Lightning Wallet section above to
            enable auto-refill.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Enable Auto-Refill
              </span>
              <Switch
                checked={nwcSettings.enabled}
                onCheckedChange={(checked) =>
                  updateNwcSettings({ enabled: checked })
                }
              />
            </div>

            {nwcSettings.enabled && (
              <>
                {/* Threshold Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground shrink-0">
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
                      className="w-20 bg-muted/50 border border-border rounded px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">
                      {unit === "₿" ? "bitcoin" : "sats"}
                    </span>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground shrink-0">
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
                      className="w-20 bg-muted/50 border border-border rounded px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">
                      {unit === "₿" ? "bitcoin" : "sats"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* API Auto-Topup Section */}
      <div className="bg-muted/50 border border-border rounded-md p-3">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-foreground/80">
            API Auto-Topup
          </span>
          <div
            className="relative inline-block"
            onMouseEnter={() => setShowApiTooltip(true)}
            onMouseLeave={() => setShowApiTooltip(false)}
          >
            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-pointer" />
            {showApiTooltip && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 p-2 bg-card border border-border rounded-md text-xs text-muted-foreground w-56 z-50">
                Automatically topup your API key from your Cashu wallet when its
                balance drops below the threshold.
              </div>
            )}
          </div>
        </div>

        {validApiKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Create an API key in the API Keys tab to enable auto-topup.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Enable Auto-Topup
              </span>
              <Switch
                checked={apiSettings.enabled}
                onCheckedChange={(checked) =>
                  updateApiSettings({ enabled: checked })
                }
              />
            </div>

            {apiSettings.enabled && (
              <>
                {/* API Key Selector */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground shrink-0">
                    API Key
                  </label>
                  <select
                    value={apiSettings.apiKey || ""}
                    onChange={(e) =>
                      updateApiSettings({ apiKey: e.target.value || null })
                    }
                    className="flex-1 max-w-[180px] bg-muted/50 border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Select API Key</option>
                    {validApiKeys.map((key) => (
                      <option key={key.key} value={key.key}>
                        {key.label || "Unnamed"} (
                        {key.balance !== null
                          ? formatSats(key.balance / 1000, unit)
                          : "N/A"}
                        )
                      </option>
                    ))}
                  </select>
                </div>

                {/* Threshold Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground shrink-0">
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
                      className="w-20 bg-muted/50 border border-border rounded px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">
                      {unit === "₿" ? "bitcoin" : "sats"}
                    </span>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground shrink-0">
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
                      className="w-20 bg-muted/50 border border-border rounded px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">
                      {unit === "₿" ? "bitcoin" : "sats"}
                    </span>
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
