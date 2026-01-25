"use client";

import React from "react";
import { Trash2, ExternalLink } from "lucide-react";
import type { TransactionHistory } from "@/types/chat";

interface BalanceActivityTabProps {
  transactionHistory: TransactionHistory[];
  onClearHistory: () => void;
  onOpenSettings: () => void;
}

const BalanceActivityTab: React.FC<BalanceActivityTabProps> = ({
  transactionHistory,
  onClearHistory,
  onOpenSettings,
}) => {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm font-medium">
          Transaction History
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {transactionHistory.length} transactions
          </span>
          {transactionHistory.length > 0 && (
            <button
              onClick={onClearHistory}
              className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
              type="button"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="bg-muted/50 border border-border rounded-lg max-h-80 overflow-y-auto">
        {transactionHistory.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No transactions yet
          </div>
        ) : (
          <div className="divide-y divide-border">
            {[...transactionHistory].reverse().map((tx) => (
              <div
                key={`${tx.timestamp}-${tx.type}-${tx.amount}`}
                className="p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      tx.type === "send" || tx.type === "spent"
                        ? "bg-red-500"
                        : "bg-green-500"
                    }`}
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground capitalize">
                      {tx.type}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono text-foreground">
                    {tx.type === "send" || tx.type === "spent" ? "-" : "+"}
                    {tx.amount} sats
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Balance: {tx.balance}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="pt-2 border-t border-border">
        <button
          onClick={onOpenSettings}
          className="w-full bg-muted/50 hover:bg-muted border border-border text-muted-foreground hover:text-foreground py-2 px-3 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
          type="button"
        >
          <ExternalLink className="h-3 w-3" />
          Open Full Wallet Settings
        </button>
      </div>
    </div>
  );
};

export default BalanceActivityTab;
