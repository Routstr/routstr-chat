import { GetInfoResponse, MintKeyset, MintKeys, MintQuoteState as CashuMintQuoteState, MeltQuoteState as CashuMeltQuoteState } from '@cashu/cashu-ts';

/**
 * Mint Domain Model
 * Represents a Cashu mint server
 */
export interface Mint {
  /** Mint URL (normalized, without trailing slash) */
  url: string;
  /** Mint information from /info endpoint */
  info?: GetInfoResponse;
  /** Active keysets for this mint */
  keysets?: MintKeyset[];
  /** Keys for each keyset */
  keys?: Record<string, MintKeys>[];
  /** Whether this mint is currently active/selected */
  active?: boolean;
}

/**
 * Mint with balance information
 */
export interface MintWithBalance extends Mint {
  /** Current balance on this mint */
  balance: number;
  /** Unit of the balance (sat, msat, etc.) */
  unit: string;
}

/**
 * Mint quote for receiving (minting)
 */
export interface MintQuote {
  mintUrl: string;
  amount: number;
  paymentRequest: string;
  quoteId: string;
  state: CashuMintQuoteState;
  expiresAt?: number;
}

/**
 * Mint quote for sending (melting)
 */
export interface MeltQuote {
  mintUrl: string;
  amount: number;
  paymentRequest: string;
  quoteId: string;
  state: CashuMeltQuoteState;
  fee: number;
  expiresAt?: number;
}

// Re-export the enums from cashu-ts for convenience
export { CashuMintQuoteState as MintQuoteState, CashuMeltQuoteState as MeltQuoteState };

