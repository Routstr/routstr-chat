import {
  GetInfoResponse,
  MintKeys,
  MintQuoteState as CashuMintQuoteState,
  MeltQuoteState as CashuMeltQuoteState,
  Keyset,
} from "@cashu/cashu-ts";

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
  keysets?: Keyset[];
  /** Keys for each keyset */
  keys?: Record<string, MintKeys>[];
  /** Whether this mint is currently active/selected */
  active?: boolean;
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
export {
  CashuMintQuoteState as MintQuoteState,
  CashuMeltQuoteState as MeltQuoteState,
};
