/**
 * Formatting utilities for wallet amounts and displays
 */

/**
 * Add thousands separator to a number
 */
export function addThousandsSeparator(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format balance with appropriate units and abbreviations
 */
export function formatBalance(balance: number, unit: string): string {
  if (balance >= 1000000) {
    return `${(balance / 1000000).toFixed(1)}M ${unit}`;
  } else if (balance >= 100000) {
    return `${(balance / 1000).toFixed(1)}k ${unit}`;
  } else {
    return `${addThousandsSeparator(balance)} ${unit}`;
  }
}

/**
 * Format amount with pluralized units (e.g., "sats" or "msats")
 */
export function formatAmountWithPlural(amount: number, unit: string): string {
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
 * Normalize mint URL (remove trailing slashes)
 */
export function normalizeMintUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

