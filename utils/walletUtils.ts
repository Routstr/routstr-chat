// Shared wallet utilities for balance display and settings wallet views

import { formatBalance } from '@/features/wallet';

export type MintBalances = Record<string, number> | undefined;
export type MintUnits = Record<string, string> | undefined;

/**
 * Truncate a mint URL to a short, readable domain or substring
 */
export function truncateMintUrl(url: string, maxDomainLen = 20, shortLen = 15): string {
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
export function isMintValid(activeMintUrl: string | null | undefined, availableMints: string[]): boolean {
  return !!activeMintUrl && availableMints.includes(activeMintUrl);
}

/**
 * Get the active mint balance or 0 if not available
 */
export function getCurrentMintBalance(activeMintUrl: string | null | undefined, mintBalances: MintBalances): number {
  if (!activeMintUrl || !mintBalances) return 0;
  return mintBalances[activeMintUrl] || 0;
}

/**
 * Compute total balance across mints in sats, converting msats -> sats
 */
export function computeTotalBalanceSats(mintBalances: MintBalances, mintUnits: MintUnits): number {
  let total = 0;
  if (!mintBalances) return total;
  for (const mintUrl of Object.keys(mintBalances)) {
    const amount = mintBalances[mintUrl] || 0;
    const unit = (mintUnits && mintUnits[mintUrl]) || 'sat';
    total += unit === 'msat' ? amount / 1000 : amount;
  }
  return total;
}

/**
 * Format an amount with pluralized units (e.g., "sats" or "msats")
 */
export function formatAmountWithPlural(amount: number, unit: string): string {
  // formatBalance returns strings like "1.2k sat"; convert to plural form
  const formatted = formatBalance(amount, unit);
  if (formatted.endsWith(' sat')) return formatted.replace(/ sat$/, ' sats');
  if (formatted.endsWith(' msat')) return formatted.replace(/ msat$/, ' msats');
  return formatted;
}

/**
 * Format sats without abbreviation, with thousands separators (e.g., 12,345 sats)
 */
export function formatSatsVerbose(amount: number): string {
  try {
    const whole = Math.round(amount);
    return `${new Intl.NumberFormat('en-US').format(whole)} sats`;
  } catch {
    return `${amount} sats`;
  }
}

