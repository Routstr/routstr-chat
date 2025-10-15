/**
 * Transaction Domain Model
 * Represents a wallet transaction (mint, melt, send, receive)
 */
export interface Transaction {
  /** Transaction type */
  type: TransactionType;
  /** Amount in sats */
  amount: number;
  /** Timestamp of transaction */
  timestamp: number;
  /** Transaction status */
  status: TransactionStatus;
  /** Optional message/description */
  message?: string;
  /** Balance after this transaction */
  balance?: number;
  /** Optional model used (for AI spending) */
  model?: string;
  /** Optional mint URL */
  mintUrl?: string;
}

export enum TransactionType {
  MINT = 'mint',
  MELT = 'melt',
  SEND = 'send',
  RECEIVE = 'receive',
  IMPORT = 'import',
  SPENT = 'spent',
}

export enum TransactionStatus {
  SUCCESS = 'success',
  PENDING = 'pending',
  FAILED = 'failed',
}

/**
 * Spending history entry (NIP-60)
 */
export interface SpendingHistoryEntry {
  direction: 'in' | 'out';
  amount: string;
  createdTokens?: string[];
  destroyedTokens?: string[];
  redeemedTokens?: string[];
  timestamp?: number;
}

