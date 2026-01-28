/**
 * LendaSwap API Service
 * Handles crypto-to-Lightning swaps via the LendaSwap REST API
 * @see https://lendasat.com/docs/lendaswap/api-sdk
 */

const LENDASWAP_API_BASE = "https://apilendaswap.lendasat.com";

// Token identifiers
export type TokenId =
  | "btc_lightning"
  | "btc_arkade"
  | "btc_onchain"
  | "wbtc_eth"
  | "wbtc_pol"
  | "wbtc_arb"
  | { coin: string };

// Supported chains
export type Chain =
  | "Polygon"
  | "Ethereum"
  | "Arbitrum"
  | "Lightning"
  | "Bitcoin"
  | "Arkade";

// Token info from API
export interface TokenInfo {
  token_id: TokenId;
  symbol: string;
  chain: Chain;
  name: string;
  decimals: number;
}

// Asset pair
export interface AssetPair {
  source: TokenInfo;
  target: TokenInfo;
}

// Quote response
export interface QuoteResponse {
  exchange_rate: string;
  network_fee: number;
  protocol_fee: number;
  protocol_fee_rate: number;
  min_amount: number;
  max_amount: number;
}

// Swap status
export type SwapStatus =
  | "pending"
  | "clientfundingseen"
  | "clientfunded"
  | "clientrefunded"
  | "serverfunded"
  | "clientredeeming"
  | "clientredeemed"
  | "serverredeemed"
  | "clientfundedserverrefunded"
  | "clientrefundedserverfunded"
  | "clientrefundedserverrefunded"
  | "expired"
  | "clientinvalidfunded"
  | "clientfundedtoolate"
  | "clientredeemedandclientrefunded";

// EVM to Lightning swap request
export interface EvmToLightningSwapRequest {
  bolt11_invoice: string;
  source_token: string;
  user_address: string;
  user_id: string;
  referral_code?: string;
}

// EVM to BTC swap response (used for EVM -> Lightning)
export interface EvmToBtcSwapResponse {
  id: string;
  status: SwapStatus;
  hash_lock: string;
  fee_sats: number;
  asset_amount: number;
  sender_pk: string;
  receiver_pk: string;
  server_pk: string;
  evm_refund_locktime: number;
  vhtlc_refund_locktime: number;
  unilateral_claim_delay: number;
  unilateral_refund_delay: number;
  unilateral_refund_without_receiver_delay: number;
  network: string;
  source_token: TokenId;
  target_token: TokenId;
  created_at: string;
  htlc_address_evm: string;
  htlc_address_arkade: string;
  user_address_evm: string;
  ln_invoice: string;
  sats_receive: number;
  source_token_address: string;
  target_amount: number;
  source_amount: number;
  approve_tx?: string;
  create_swap_tx?: string;
  gelato_forwarder_address?: string;
  gelato_user_deadline?: string;
  gelato_user_nonce?: string;
  evm_htlc_claim_txid?: string;
  evm_htlc_fund_txid?: string;
  bitcoin_htlc_claim_txid?: string;
  bitcoin_htlc_fund_txid?: string;
  user_address_arkade?: string;
}

// Get swap response (union type from API)
export interface GetSwapResponse extends EvmToBtcSwapResponse {
  direction: "evm_to_btc" | "btc_to_evm" | "btc_to_arkade" | "onchain_to_evm";
}

// Error response
export interface ErrorResponse {
  error: string;
}

// Supported stablecoins by chain
export const SUPPORTED_TOKENS: Record<
  string,
  { tokenId: string; symbol: string; name: string; decimals: number }[]
> = {
  Polygon: [
    { tokenId: "usdc_pol", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { tokenId: "usdt0_pol", symbol: "USDT", name: "Tether USD", decimals: 6 },
  ],
  Ethereum: [
    { tokenId: "usdc_eth", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { tokenId: "usdt_eth", symbol: "USDT", name: "Tether USD", decimals: 6 },
  ],
  Arbitrum: [
    { tokenId: "usdc_arb", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { tokenId: "usdt_arb", symbol: "USDT", name: "Tether USD", decimals: 6 },
  ],
};

// Chain endpoint mapping
const CHAIN_ENDPOINTS: Record<string, string> = {
  Polygon: "/swap/polygon/lightning",
  Ethereum: "/swap/ethereum/lightning",
  Arbitrum: "/swap/arbitrum/lightning",
};

/**
 * Get available tokens
 */
export async function getTokens(): Promise<TokenInfo[]> {
  const response = await fetch(`${LENDASWAP_API_BASE}/tokens`);
  if (!response.ok) {
    let errorMessage = "Failed to fetch tokens";
    try {
      const error: ErrorResponse = await response.json();
      if (error.error) errorMessage = error.error;
    } catch {
      const text = await response.text();
      if (text) errorMessage = text;
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

/**
 * Get supported asset pairs
 */
export async function getAssetPairs(): Promise<AssetPair[]> {
  const response = await fetch(`${LENDASWAP_API_BASE}/asset-pairs`);
  if (!response.ok) {
    let errorMessage = "Failed to fetch asset pairs";
    try {
      const error: ErrorResponse = await response.json();
      if (error.error) errorMessage = error.error;
    } catch {
      const text = await response.text();
      if (text) errorMessage = text;
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

const readErrorMessage = async (
  response: Response,
  fallback: string
): Promise<string> => {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { error?: string } | null;
    if (parsed?.error) return parsed.error;
  } catch {}
  return text;
};

/**
 * Get a quote for swapping
 * @param from Source token (e.g., "usdc_pol")
 * @param to Target token (e.g., "btc_lightning")
 * @param baseAmount Amount in satoshis (always BTC amount)
 */
export async function getQuote(
  from: string,
  to: string,
  baseAmount: number
): Promise<QuoteResponse> {
  const params = new URLSearchParams({
    from,
    to,
    base_amount: baseAmount.toString(),
  });

  const response = await fetch(`${LENDASWAP_API_BASE}/quote?${params}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to get quote"));
  }
  return response.json();
}

/**
 * Create an EVM to Lightning swap
 * @param chain The EVM chain (Polygon, Ethereum, Arbitrum)
 * @param request The swap request
 */
export async function createEvmToLightningSwap(
  chain: "Polygon" | "Ethereum" | "Arbitrum",
  request: EvmToLightningSwapRequest
): Promise<EvmToBtcSwapResponse> {
  // Convert chain name to lowercase for API endpoint
  const chainLower = chain.toLowerCase();
  
  const response = await fetch(`${LENDASWAP_API_BASE}/swap/${chainLower}/lightning`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create swap"));
  }

  return response.json();
}

/**
 * Get swap status by ID
 * @param id Swap ID
 */
export async function getSwapStatus(id: string): Promise<GetSwapResponse> {
  const response = await fetch(`${LENDASWAP_API_BASE}/swap/${id}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to get swap status"));
  }
  return response.json();
}

/**
 * Generate a random user ID for the swap
 * This is used by the API to group swaps, but we generate a new one if not persisted
 */
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function generateUserId(existing?: string | null): string {
  if (existing) {
    if (existing.length === 66 || existing.length === 130) return existing;
    if (existing.length === 64) return `02${existing}`;
  }
  const bytes = new Uint8Array(33);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(bytes);
}

/**
 * Check if swap is in a terminal state
 */
export function isSwapComplete(status: SwapStatus): boolean {
  return [
    "serverredeemed", // Success
    "expired",
    "clientrefunded",
    "clientrefundedserverfunded",
    "clientfundedserverrefunded",
    "clientfundedtoolate",
    "clientinvalidfunded",
  ].includes(status);
}

/**
 * Check if swap succeeded
 */
export function isSwapSucceeded(status: SwapStatus): boolean {
  return status === "serverredeemed";
}

/**
 * Check if swap failed
 */
export function isSwapFailed(status: SwapStatus): boolean {
  return [
    "expired",
    "clientrefunded",
    "clientrefundedserverfunded",
    "clientfundedserverrefunded",
    "clientfundedtoolate",
    "clientinvalidfunded",
  ].includes(status);
}

/**
 * Get user-friendly status message
 */
export function getStatusMessage(status: SwapStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for deposit...";
    case "clientfundingseen":
      return "Deposit detected...";
    case "clientfunded":
      return "Deposit confirmed. Processing...";
    case "serverfunded":
      return "Processing...";
    case "clientredeeming":
      return "Completing swap...";
    case "clientredeemed":
      return "Completing swap...";
    case "serverredeemed":
      return "Swap complete!";
    case "expired":
      return "Swap expired";
    case "clientrefunded":
      return "Refunded";
    default:
      if (status.includes("refunded")) return "Refunded";
      return "Processing...";
  }
}
