/**
 * Wallet Domain Model
 * Represents a user's Cashu wallet
 */
export interface Wallet {
  /** Private key for P2PK locked proofs */
  privkey: string;
  /** List of mint URLs this wallet uses */
  mints: string[];
}
