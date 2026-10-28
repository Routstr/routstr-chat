/**
 * Spending history entry (NIP-60)
 */
export interface SpendingHistoryEntry {
  direction: "in" | "out";
  amount: string;
  createdTokens?: string[];
  destroyedTokens?: string[];
  redeemedTokens?: string[];
  timestamp?: number;
}
