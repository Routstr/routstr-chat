/**
 * Formatting utilities for wallet amounts and displays
 */

/**
 * Add thousands separator to a number
 */
export function addThousandsSeparator(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
 * Normalize mint URL (remove trailing slashes)
 */
export function normalizeMintUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
