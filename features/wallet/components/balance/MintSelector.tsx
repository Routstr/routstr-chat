"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { formatBalance } from "@/features/wallet";
import { truncateMintUrl } from "@/utils/walletUtils";

interface MintSelectorProps {
  availableMints: string[];
  activeMintUrl?: string | null;
  isCurrentMintValid: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (mintUrl: string) => void;
  mintBalances: Record<string, number>;
  mintUnits: Record<string, string>;
}

const MintSelector: React.FC<MintSelectorProps> = ({
  availableMints,
  activeMintUrl,
  isCurrentMintValid,
  isOpen,
  onToggle,
  onSelect,
  mintBalances,
  mintUnits,
}) => {
  if (availableMints.length === 0) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md px-2 py-1">
        <div className="text-yellow-600 dark:text-yellow-200 text-xs">
          No mints
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`bg-muted/50 border rounded-md px-2 py-1 text-foreground text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 flex items-center gap-1 cursor-pointer min-w-[120px] ${
          !isCurrentMintValid ? "border-red-500/50" : "border-border"
        }`}
        title={activeMintUrl || "Select a mint"}
        type="button"
      >
        <span className="truncate flex-1 text-left">
          {activeMintUrl ? truncateMintUrl(activeMintUrl) : "Select mint"}
        </span>
        <ChevronDown
          className={`h-3 w-3 transition-transform shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto min-w-[200px]">
          {availableMints.map((mintUrl) => (
            <button
              key={mintUrl}
              onClick={() => onSelect(mintUrl)}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors cursor-pointer ${
                activeMintUrl === mintUrl
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground"
              }`}
              type="button"
            >
              <div className="truncate">{truncateMintUrl(mintUrl)}</div>
              <div className="text-xs text-muted-foreground">
                {formatBalance(mintBalances[mintUrl] || 0, mintUnits[mintUrl] || "sat")}
                s
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MintSelector;
