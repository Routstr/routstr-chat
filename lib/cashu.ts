// Types and utilities for Cashu wallet (NIP-60)

import { useCashuStore } from "@/features/wallet/state/cashuStore";
import {
  Mint,
  Proof,
  Wallet,
  GetInfoResponse,
  MintKeys,
  getDecodedToken,
  Keyset,
} from "@cashu/cashu-ts";

export interface CashuProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
}

export interface CashuToken {
  mint: string;
  proofs: CashuProof[];
  del?: string[]; // token-ids that were destroyed by the creation of this token
}

export interface CashuWalletStruct {
  privkey: string; // Private key used to unlock P2PK ecash
  mints: string[]; // List of mint URLs
}

export interface SpendingHistoryEntry {
  direction: "in" | "out";
  amount: string;
  createdTokens?: string[];
  destroyedTokens?: string[];
  redeemedTokens?: string[];
  timestamp?: number;
}

// Event kinds as defined in NIP-60
export const CASHU_EVENT_KINDS = {
  WALLET: 17375, // Replaceable event for wallet info
  TOKEN: 7375, // Token events for unspent proofs
  HISTORY: 7376, // Spending history events
  QUOTE: 7374, // Quote events (optional)
  ZAPINFO: 10019, // ZAP info events
  ZAP: 9321, // ZAP events
};

export const defaultMints = ["https://mint.minibits.cash/Bitcoin"];

// Helper function to calculate total balance from tokens
export function calculateBalance(proofs: Proof[]): {
  balances: Record<string, number>;
  units: Record<string, string>;
} {
  const balances: { [mint: string]: number } = {};
  const units: { [mint: string]: string } = {};
  const mints = useCashuStore.getState().mints;
  for (const mint of mints) {
    balances[mint.url] = 0;
    units[mint.url] = "sat";
    const keysets = mint.keysets;
    if (!keysets) continue;
    for (const keyset of keysets) {
      // select all proofs with id == keyset.id
      const proofsForKeyset = proofs.filter((proof) => proof.id === keyset.id);
      if (proofsForKeyset.length) {
        balances[mint.url] += proofsForKeyset.reduce(
          (acc, proof) => acc + proof.amount,
          0
        );
        units[mint.url] = keyset.unit;
      }
    }
  }
  return { balances, units };
}

// Helper function to add thousands separator to a number
function addThousandsSeparator(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Helper function to format balance with appropriate units
export function formatBalance(balance: number, unit: string): string {
  if (balance >= 1000000) {
    return `${(balance / 1000000).toFixed(1)}M ${unit}`;
  } else if (balance >= 100000) {
    return `${(balance / 1000).toFixed(1)}k ${unit}`;
  } else {
    return `${addThousandsSeparator(balance)} ${unit}`;
  }
}

export function getTokenAmount(token: string): number {
  const tokenObj = getDecodedToken(token);
  return tokenObj.proofs.reduce(
    (acc: number, proof: Proof) => acc + proof.amount,
    0
  );
}

/**
 * Calculate fees using the Python reference implementation
 * @param inputProofs The proofs to calculate fees for
 * @param activeKeysets The active keysets from the mint
 * @returns The calculated fees in satoshis
 */
export function calculateFees(
  inputProofs: Proof[],
  activeKeysets: Keyset[]
): number {
  let sumFees = 0;
  for (const proof of inputProofs) {
    const keyset = activeKeysets.find((k) => k.id === proof.id);
    if (keyset && keyset.input_fee_ppk !== undefined) {
      sumFees += keyset.input_fee_ppk;
    }
  }
  return Math.floor((sumFees + 999) / 1000);
}
