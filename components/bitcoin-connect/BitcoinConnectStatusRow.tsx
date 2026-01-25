"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { BitcoinConnectStatus } from "@/hooks/useBitcoinConnect";

interface BitcoinConnectStatusRowProps {
  status: BitcoinConnectStatus;
  balance?: number | null;
  onConnect: () => void | Promise<void>;
  label?: string;
  connectedLabel?: string;
  showBalance?: boolean;
  className?: string;
  buttonClassName?: string;
}

const BitcoinConnectStatusRow: React.FC<BitcoinConnectStatusRowProps> = ({
  status,
  balance = null,
  onConnect,
  label = "Wallet (NWC)",
  connectedLabel = "Connected",
  showBalance = true,
  className,
  buttonClassName,
}) => {
  return (
    <div
      className={cn(
        "bg-muted/50 border border-border rounded-lg p-2 flex items-center justify-between gap-3",
        className
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      {status === "connected" ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-600 dark:text-green-400">
            {connectedLabel}
          </span>
          {showBalance && balance !== null && (
            <span className="text-muted-foreground">
              • {balance.toLocaleString()} sats
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={onConnect}
          className={cn(
            "px-3 py-1.5 text-xs bg-muted border border-border rounded-md text-foreground hover:bg-muted/80",
            buttonClassName
          )}
          type="button"
        >
          {status === "connecting" ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
};

export default BitcoinConnectStatusRow;
