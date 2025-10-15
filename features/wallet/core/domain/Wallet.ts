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

/**
 * Wallet with complete state
 */
export interface WalletState extends Wallet {
  /** Currently selected/active mint URL */
  activeMintUrl?: string;
  /** Total balance across all mints */
  totalBalance: number;
  /** Whether wallet data is currently loading */
  isLoading: boolean;
}

/**
 * Wallet configuration options
 */
export interface WalletConfig {
  /** Default mints to use when creating a new wallet */
  defaultMints: string[];
  /** Whether to use NIP-60 for storage */
  useNip60: boolean;
  /** Preferred unit (sat, msat, etc.) */
  preferredUnit?: 'sat' | 'msat';
}

