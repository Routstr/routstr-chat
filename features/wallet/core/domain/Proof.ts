/**
 * Cashu Proof Domain Model
 * Represents a cryptographic proof that can be spent at a mint
 */
export interface Proof {
  /** Keyset ID */
  id: string;
  /** Amount in sats or msats depending on mint */
  amount: number;
  /** Secret that proves ownership */
  secret: string;
  /** Curve point (commitment) */
  C: string;
}

/**
 * Proof with associated Nostr event ID (for NIP-60 tracking)
 */
export interface ProofWithEventId extends Proof {
  eventId: string;
}

/**
 * Proof state as returned by mint
 */
export enum ProofState {
  UNSPENT = 'UNSPENT',
  SPENT = 'SPENT',
  PENDING = 'PENDING',
}

/**
 * Proof with state information
 */
export interface ProofWithState extends Proof {
  state: ProofState;
  witness?: string;
}

