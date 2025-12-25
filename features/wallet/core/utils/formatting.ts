/**
 * Formatting utilities for wallet amounts and displays
 */

import { satsToUsd } from "@/utils/priceUtils";

/**
 * Add thousands separator to a number
 */
export function addThousandsSeparator(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format balance with appropriate units and abbreviations
 */
export function formatBalance(
  balance: number,
  unit: string,
  displayUnit: "sats" | "₿" | "usd" = "₿",
  precision: number = 0
): string {
  const isSats = unit === "sat" || unit === "sats";

  if (isSats && displayUnit === "usd") {
    const usdAmount = satsToUsd(balance);
    if (usdAmount !== null) {
      const p = precision || 2;
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: p,
        maximumFractionDigits: p,
      }).format(usdAmount);
    }
  }

  let formatted = "";
  const p = displayUnit === "usd" ? precision : 0;

  if (balance >= 1000000 && p === 0) {
    formatted = `${(balance / 1000000).toFixed(1)}M`;
  } else if (balance >= 100000 && p === 0) {
    formatted = `${(balance / 1000).toFixed(1)}k`;
  } else {
    formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    }).format(balance);
  }

  if (isSats) {
    return displayUnit === "₿" ? `₿${formatted}` : `${formatted} sats`;
  }

  return `${formatted} ${unit}`;
}

/**
 * Format amount with pluralized units (e.g., "sats" or "msats")
 */
export function formatAmountWithPlural(
  amount: number,
  unit: string,
  displayUnit: "sats" | "₿" | "usd" = "₿",
  precision: number = 0
): string {
  if (unit === "sat" || unit === "sats") {
    return formatSats(amount, displayUnit, precision);
  }

  const formatted = formatBalance(amount, unit, displayUnit, precision);
  if (formatted.endsWith(" msat")) return formatted.replace(/ msat$/, " msats");
  return formatted;
}

/**
 * Format sats according to the ₿ symbol, legacy "sats" label, or USD
 */
export function formatSats(
  amount: number,
  unit: "sats" | "₿" | "usd" = "₿",
  precision: number = 0
): string {
  if (unit === "usd") {
    const usdAmount = satsToUsd(amount);
    if (usdAmount !== null) {
      const p = precision || 2;
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: p,
        maximumFractionDigits: p,
      }).format(usdAmount);
    }
  }

  const p = 0; // Force 0 for sats/₿ as they don't have float

  try {
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    }).format(amount);
    return unit === "₿" ? `₿${formatted}` : `${formatted} sats`;
  } catch {
    return unit === "₿" ? `₿${amount.toFixed(p)}` : `${amount.toFixed(p)} sats`;
  }
}

/**
 * Format sats without abbreviation, with thousands separators (e.g., 12,345 sats)
 * @deprecated Use formatSats instead which supports the ₿ unit
 */
export function formatSatsVerbose(amount: number, precision: number = 0): string {
  return formatSats(amount, "sats", precision);
}

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
 * Normalize mint URL (remove trailing slashes)
 */
export function normalizeMintUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
