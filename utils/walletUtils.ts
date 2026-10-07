// Shared wallet utilities for balance display and settings wallet views

import { formatBalance } from "@/features/wallet";

export type MintBalances = Record<string, number> | undefined;
export type MintUnits = Record<string, string> | undefined;

/**
 * Truncate a mint URL to a short, readable domain or substring
 */
export function truncateMintUrl(
  url: string,
  maxDomainLen = 20,
  shortLen = 15
): string {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    if (domain.length <= maxDomainLen) return domain;
    return `${domain.slice(0, shortLen)}...`;
  } catch {
    return url.length <= maxDomainLen ? url : `${url.slice(0, shortLen)}...`;
  }
}

/**
 * Return the list of available mint URLs from a `mintBalances` map
 */
export function getAvailableMints(mintBalances: MintBalances): string[] {
  return Object.keys(mintBalances || {});
}

/**
 * Determine if the currently selected mint exists in the available list
 */
export function isMintValid(
  activeMintUrl: string | null | undefined,
  availableMints: string[]
): boolean {
  return !!activeMintUrl && availableMints.includes(activeMintUrl);
}

/**
 * Compute total balance across mints in sats, converting msats -> sats
 */
export function computeTotalBalanceSats(
  mintBalances: MintBalances,
  mintUnits: MintUnits
): number {
  let total = 0;
  if (!mintBalances) return total;
  for (const mintUrl of Object.keys(mintBalances)) {
    const amount = mintBalances[mintUrl] || 0;
    const unit = (mintUnits && mintUnits[mintUrl]) || "sat";
    total += unit === "msat" ? amount / 1000 : amount;
  }
  return total;
}

/**
 * Format an amount with pluralized units (e.g., "sats" or "msats")
 */
export function formatAmountWithPlural(amount: number, unit: string): string {
  // formatBalance returns strings like "1.2k sat"; convert to plural form
  const formatted = formatBalance(amount, unit);
  if (formatted.endsWith(" sat")) return formatted.replace(/ sat$/, " sats");
  if (formatted.endsWith(" msat")) return formatted.replace(/ msat$/, " msats");
  return formatted;
}

/**
 * Format sats without abbreviation, with thousands separators (e.g., 12,345 sats)
 */
export function formatSatsVerbose(amount: number): string {
  try {
    const whole = Math.round(amount);
    return `${new Intl.NumberFormat("en-US").format(whole)} sats`;
  } catch {
    return `${amount} sats`;
  }
}

/**
 * Wallet mint data interface for shared mint information
 */
export interface WalletMintData {
  /** List of available mint URLs */
  availableMints: string[];
  /** Balance per mint URL */
  mintBalances: Record<string, number>;
  /** Unit per mint URL (e.g., "sat", "msat") */
  mintUnits: Record<string, string>;
}

/**
 * Mint store interface (subset of CashuStore needed for this function)
 */
export interface MintStoreData {
  mints: Array<{
    url: string;
    keysets?: { id: string; unit: string; active: boolean }[];
  }>;
  proofs: Array<{ id: string; amount: number }>;
}

/**
 * Wallet data interface (subset of Wallet from useCashuWallet)
 */
export interface WalletData {
  mints?: string[];
}

/**
 * Get unified wallet mint data for display in both floating wallet and settings
 * This function ensures both SixtyWallet and BalanceDisplay show identical data
 *
 * @param wallet - Wallet data from useCashuWallet hook (may be null/undefined)
 * @param cashuStore - CashuStore data (mints and proofs)
 * @param calculateBalanceByMint - Function to calculate balances (from features/wallet)
 * @returns WalletMintData with availableMints, mintBalances, and mintUnits
 */
export function getWalletMintData<
  TProofs extends Array<{ id: string; amount: number }>,
  TMints extends Array<{ url: string; keysets?: unknown[] }>,
>(
  wallet: WalletData | null | undefined,
  cashuStore: { mints: TMints; proofs: TProofs },
  calculateBalanceByMint: (
    proofs: TProofs,
    mints: TMints
  ) => { balances: Record<string, number>; units: Record<string, string> }
): WalletMintData {
  // Get available mints from wallet.mints (same as SixtyWallet.tsx line 920)
  let availableMints: string[];
  if (wallet?.mints && wallet.mints.length > 0) {
    availableMints = wallet.mints;
  } else {
    // Fallback to cashuStore.mints if wallet is not loaded yet
    availableMints = cashuStore.mints.map((m) => m.url);
  }

  // Compute mintBalances and mintUnits (same as SixtyWallet.tsx lines 366-369)
  const { balances: mintBalances, units: mintUnits } = cashuStore.proofs
    ? calculateBalanceByMint(cashuStore.proofs, cashuStore.mints)
    : { balances: {}, units: {} };

  return { availableMints, mintBalances, mintUnits };
}
