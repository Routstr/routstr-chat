"use client";

import React from "react";
import { ArrowLeft, Settings } from "lucide-react";

interface BalancePopoverHeaderProps {
  title: string;
  showBackButton: boolean;
  onBack: () => void;
  mintSelector?: React.ReactNode;
  showSettings: boolean;
  onOpenSettings: () => void;
}

const BalancePopoverHeader: React.FC<BalancePopoverHeaderProps> = ({
  title,
  showBackButton,
  onBack,
  mintSelector,
  showSettings,
  onOpenSettings,
}) => {
  return (
    <div className="flex items-center justify-between p-3 border-b border-border sticky top-0 z-10 bg-card">
      {showBackButton ? (
        <div className="flex items-center gap-3 flex-1">
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 cursor-pointer"
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {mintSelector && <div className="ml-auto">{mintSelector}</div>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
      )}

      {showSettings && (
        <button
          onClick={onOpenSettings}
          className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
          title="Wallet Settings"
          type="button"
        >
          <Settings className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default BalancePopoverHeader;
