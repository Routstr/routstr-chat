"use client";

import React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TransactionHistory } from "@/types/chat";

interface BalanceOverviewTabProps {
  usingNip60: boolean;
  mintSelector?: React.ReactNode;
  truncatedNpub: string;
  displayBalance: string;
  transactionHistory: TransactionHistory[];
  onNavigate: (tab: "receive" | "send" | "activity") => void;
}

const BalanceOverviewTab: React.FC<BalanceOverviewTabProps> = ({
  usingNip60,
  mintSelector,
  truncatedNpub,
  displayBalance,
  transactionHistory,
  onNavigate,
}) => {
  return (
    <div className="p-4">
      {/* Mint Selector for Overview - Top Right */}
      {usingNip60 && mintSelector && (
        <div className="flex justify-end mb-3">{mintSelector}</div>
      )}

      {/* Balance Display */}
      <div className="text-center mb-4">
        <div className="text-muted-foreground text-sm font-medium mb-1">
          {truncatedNpub}
        </div>
        <div className="text-muted-foreground text-sm mb-2">Balance</div>
        <div className="text-foreground text-2xl font-bold">
          {displayBalance}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => onNavigate("receive")}
          className="flex flex-col items-center justify-center gap-2 bg-muted/50 hover:bg-muted border border-border rounded-lg p-6 transition-colors cursor-pointer"
          type="button"
        >
          <ArrowDownLeft className="h-6 w-6 text-muted-foreground" />
          <span className="text-muted-foreground text-sm font-medium">
            Receive
          </span>
        </button>

        <button
          onClick={() => onNavigate("send")}
          className="flex flex-col items-center justify-center gap-2 bg-muted/50 hover:bg-muted border border-border rounded-lg p-6 transition-colors cursor-pointer"
          type="button"
        >
          <ArrowUpRight className="h-6 w-6 text-muted-foreground" />
          <span className="text-muted-foreground text-sm font-medium">Send</span>
        </button>
      </div>

      {/* Quick Activity Preview */}
      <div className="bg-muted/50 border border-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted-foreground text-sm font-medium">
            Recent Activity
          </span>
          <button
            onClick={() => onNavigate("activity")}
            className="text-muted-foreground hover:text-foreground/70 text-xs cursor-pointer"
            type="button"
          >
            View All
          </button>
        </div>
        <div className="space-y-2">
          {transactionHistory
            .slice(-3)
            .reverse()
            .map((tx) => (
              <div
                key={`${tx.timestamp}-${tx.type}-${tx.amount}`}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      tx.type === "send" || tx.type === "spent"
                        ? "bg-red-500"
                        : "bg-green-500"
                    }`}
                  />
                  <span className="text-muted-foreground text-xs capitalize">
                    {tx.type}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs font-mono">
                  {tx.type === "send" || tx.type === "spent" ? "-" : "+"}
                  {tx.amount} sats
                </span>
              </div>
            ))}
          {transactionHistory.length === 0 && (
            <div className="text-muted-foreground text-xs text-center py-2">
              No transactions yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BalanceOverviewTab;
