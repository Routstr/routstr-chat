"use client";

import React, { useState, useEffect } from "react";
import { Zap, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  loadAutoRefillNWCSettings,
  saveAutoRefillNWCSettings,
  AutoRefillNWCSettings,
  DEFAULT_AUTO_REFILL_NWC_SETTINGS,
} from "@/utils/storageUtils";
import { isNWCConnected, getNWCBalance } from "@/lib/nwcPayment";

/**
 * Settings component for configuring NWC auto-refill
 */
const AutoRefillSettings: React.FC = () => {
  // NWC Auto-Refill State
  const [nwcSettings, setNwcSettings] = useState<AutoRefillNWCSettings>(
    DEFAULT_AUTO_REFILL_NWC_SETTINGS
  );
  const [isNwcConnected, setIsNwcConnected] = useState(false);
  const [nwcBalance, setNwcBalance] = useState<number | null>(null);

  // Tooltip state
  const [showNwcTooltip, setShowNwcTooltip] = useState(false);

  // Load settings from storage on mount
  useEffect(() => {
    setNwcSettings(loadAutoRefillNWCSettings());

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
  }, []);

  // Save NWC settings when changed
  const updateNwcSettings = (updates: Partial<AutoRefillNWCSettings>) => {
    const newSettings = { ...nwcSettings, ...updates };
    setNwcSettings(newSettings);
    saveAutoRefillNWCSettings(newSettings);
  };

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
                  ({nwcBalance.toLocaleString()} sats)
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
                    <span className="text-xs text-muted-foreground">sats</span>
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
                    <span className="text-xs text-muted-foreground">sats</span>
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
