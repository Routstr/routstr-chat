/**
 * Price utilities for BTC/USD conversion
 */

let btcPriceUsd: number | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

/**
 * Fetch BTC price in USD from a public API
 */
export async function fetchBtcPrice(): Promise<number | null> {
  const now = Date.now();
  if (btcPriceUsd && now - lastFetchTime < CACHE_DURATION) {
    return btcPriceUsd;
  }

  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const data = await response.json();
    const price = parseFloat(data.data.amount);
    if (!isNaN(price)) {
      btcPriceUsd = price;
      lastFetchTime = now;
      return price;
    }
  } catch (error) {
    console.error("Failed to fetch BTC price:", error);
  }

  return btcPriceUsd; // Return cached price even if expired if fetch fails
}

/**
 * Get current cached BTC price synchronously
 */
export function getCachedBtcPrice(): number | null {
  return btcPriceUsd;
}

/**
 * Convert sats to USD based on cached price
 */
export function satsToUsd(sats: number): number | null {
  if (btcPriceUsd === null) return null;
  return (sats / 100_000_000) * btcPriceUsd;
}

/**
 * Convert USD to sats based on cached price
 */
export function usdToSats(usd: number): number | null {
  if (btcPriceUsd === null) return null;
  return Math.round((usd / btcPriceUsd) * 100_000_000);
}

