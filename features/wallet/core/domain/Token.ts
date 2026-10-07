import { Proof } from "./Proof";

/**
 * Cashu Token Domain Model
 * Represents a token that can be sent/received
 */
export interface CashuToken {
  /** Mint URL where these proofs are valid */
  mint: string;
  /** List of proofs that make up this token */
  proofs: Proof[];
  /** Optional: IDs of token events this token replaces (for NIP-60) */
  del?: string[];
  /** Optional: unit (sat, msat, usd, etc.) */
  unit?: string;
}
