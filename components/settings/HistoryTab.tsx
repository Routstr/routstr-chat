import React, { useEffect, useState, useMemo } from "react";
import { TransactionHistory } from "@/types/chat";
import {
  getPendingCashuTokenAmount,
  getPendingCashuTokenDistribution,
} from "../../utils/cashuUtils";
import { useTransactionHistoryStore } from "@/features/wallet/state/transactionHistoryStore";

type ViewMode = "combined" | "separate";

interface HistoryTabProps {
  setTransactionHistory: (
    transactionHistory:
      | TransactionHistory[]
      | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])
  ) => void;
  clearConversations: () => void;
  onClose: () => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({
  setTransactionHistory,
  clearConversations,
  onClose,
}) => {
  const [pendingCashuAmount, setPendingCashuAmount] = useState<number | null>(
    null
  );
  const [pendingDistribution, setPendingDistribution] = useState<
    { baseUrl: string; amount: number }[]
  >([]);
  const [viewMode, setViewMode] = useState<ViewMode>("combined");

  // Get transaction history from the store
  const getHistoryEntries = useTransactionHistoryStore(
    (state) => state.getHistoryEntries
  );
  const clearHistory = useTransactionHistoryStore(
    (state) => state.clearHistory
  );
  const historyEntries = getHistoryEntries();

  // Process entries to pair received with sent for "combined" view
  const processedEntries = useMemo(() => {
    // Sort by timestamp oldest first for pairing
    const sorted = [...historyEntries].sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    );

    const paired = new Set<string>(); // Track paired entry IDs
    const result: Array<{
      id: string;
      type: "received" | "sent" | "spent";
      amount: string;
      timestamp?: number;
      receivedAmount?: string;
      sentAmount?: string;
    }> = [];

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];

      if (paired.has(entry.id)) continue; // Skip already paired

      if (entry.direction === "in") {
        // Look for the next unpaired 'out' to pair with
        let foundPair = false;
        for (let j = i + 1; j < sorted.length; j++) {
          const nextEntry = sorted[j];
          if (nextEntry.direction === "out" && !paired.has(nextEntry.id)) {
            // Pair them as "spent"
            paired.add(entry.id);
            paired.add(nextEntry.id);

            result.push({
              id: `${entry.id}-${nextEntry.id}`,
              type: "spent",
              amount: nextEntry.amount,
              timestamp: nextEntry.timestamp,
              receivedAmount: entry.amount,
              sentAmount: nextEntry.amount,
            });

            foundPair = true;
            break;
          }
        }

        if (!foundPair) {
          // No pair found, keep as received
          result.push({
            id: entry.id,
            type: "received",
            amount: entry.amount,
            timestamp: entry.timestamp,
          });
        }
      } else if (entry.direction === "out") {
        // Unpaired sent transaction
        result.push({
          id: entry.id,
          type: "sent",
          amount: entry.amount,
          timestamp: entry.timestamp,
        });
      }
    }

    // Sort result by timestamp newest first for display
    return result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [historyEntries]);

  useEffect(() => {
    const checkPendingCashuToken = () => {
      const amount = getPendingCashuTokenAmount();
      setPendingCashuAmount(amount > 0 ? amount : null);

      const distArray = getPendingCashuTokenDistribution();
      setPendingDistribution(distArray);
    };

    checkPendingCashuToken();
    window.addEventListener("storage", checkPendingCashuToken);
    return () => {
      window.removeEventListener("storage", checkPendingCashuToken);
    };
  }, []);

  const handleClearTransactions = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all transaction history? This cannot be undone."
      )
    ) {
      setTransactionHistory([]);
      clearHistory();
      localStorage.removeItem("transaction_history");
      localStorage.removeItem("current_cashu_token"); // Also clear pending token
      setPendingCashuAmount(null); // Clear pending amount state
      onClose();
    }
  };

  const handleClearConversations = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all conversations? This cannot be undone."
      )
    ) {
      clearConversations();
      onClose();
    }
  };

  return (
    <div className="space-y-6">
      {/* Transaction History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground/80">
            Transaction History
          </h3>
          <span className="text-xs text-muted-foreground">
            {viewMode === "combined"
              ? processedEntries.length
              : historyEntries.length}{" "}
            transactions
          </span>
        </div>

        {/* View Mode Tabs */}
        <div className="inline-flex items-center gap-1 mb-3 p-1 rounded-full border border-border bg-muted/40 text-[11px] leading-none">
          <button
            type="button"
            onClick={() => setViewMode("combined")}
            className={`min-w-[92px] px-3 py-1.5 font-medium rounded-full transition-colors ${
              viewMode === "combined"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Combined
          </button>
          <button
            type="button"
            onClick={() => setViewMode("separate")}
            className={`min-w-[92px] px-3 py-1.5 font-medium rounded-full transition-colors ${
              viewMode === "separate"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Separate
          </button>
        </div>

        <div className="bg-muted/50 border border-border rounded-md">
          {pendingCashuAmount !== null && (
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Pending
                  </div>
                  {pendingDistribution.length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {pendingDistribution.map((item) => (
                        <div
                          key={item.baseUrl}
                          className="text-xs text-muted-foreground flex items-center gap-2"
                        >
                          <span
                            className="truncate max-w-[200px]"
                            title={item.baseUrl}
                          >
                            {item.baseUrl}
                          </span>
                          <span className="text-muted-foreground font-mono">
                            +{item.amount} sats
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono text-foreground">
                  +{pendingCashuAmount} sats
                </div>
              </div>
            </div>
          )}

          {/* Combined View */}
          {viewMode === "combined" && (
            <>
              {processedEntries.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  No transactions yet
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {processedEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between p-4 border-b border-border last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            entry.type === "sent" || entry.type === "spent"
                              ? "bg-red-500"
                              : "bg-green-500"
                          }`}
                        />
                        <div>
                          <div className="text-sm font-medium text-foreground capitalize">
                            {entry.type}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {entry.timestamp
                              ? new Date(
                                  entry.timestamp * 1000
                                ).toLocaleString()
                              : "N/A"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-foreground">
                          {entry.type === "received" ? "+" : "-"}
                          {entry.type === "spent" && entry.receivedAmount
                            ? Number(entry.amount) -
                              Number(entry.receivedAmount)
                            : entry.amount}{" "}
                          sats
                        </div>
                        {entry.type === "spent" && entry.receivedAmount && (
                          <div className="text-xs text-muted-foreground">
                            Pair: {entry.receivedAmount} - {entry.amount} sats
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Separate View */}
          {viewMode === "separate" && (
            <>
              {historyEntries.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  No transactions yet
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {historyEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between p-4 border-b border-border last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            entry.direction === "out"
                              ? "bg-red-500"
                              : "bg-green-500"
                          }`}
                        />
                        <div>
                          <div className="text-sm font-medium text-foreground capitalize">
                            {entry.direction === "in" ? "Received" : "Sent"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {entry.timestamp
                              ? new Date(
                                  entry.timestamp * 1000
                                ).toLocaleString()
                              : "N/A"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-foreground">
                          {entry.direction === "out" ? "-" : "+"}
                          {entry.amount} sats
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Data Management */}
      <div>
        <h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-3">
          Danger Zone
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/20 rounded-md">
            <div>
              <div className="text-sm text-foreground">Clear Conversations</div>
              <div className="text-xs text-muted-foreground">
                Remove all chat history
              </div>
            </div>
            <button
              onClick={handleClearConversations}
              className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
              type="button"
            >
              Clear
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/20 rounded-md">
            <div>
              <div className="text-sm text-foreground">Clear Transactions</div>
              <div className="text-xs text-muted-foreground">
                Remove all payment records
              </div>
            </div>
            <button
              onClick={handleClearTransactions}
              className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryTab;
