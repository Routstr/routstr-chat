import { useCashuStore } from "@/features/wallet";
import {
  Mint,
  Wallet,
  MeltQuoteResponse,
  MeltQuoteState,
  Proof,
} from "@cashu/cashu-ts";

export interface MeltQuote {
  mintUrl: string;
  amount: number;
  paymentRequest: string;
  quoteId: string;
  state: MeltQuoteState;
  expiresAt?: number;
}

/**
 * Create a melt quote for a Lightning invoice
 * @param mintUrl The URL of the mint to use
 * @param paymentRequest The Lightning invoice to pay
 * @returns The melt quote
 */
export async function createMeltQuote(
  mintUrl: string,
  paymentRequest: string
): Promise<MeltQuoteResponse> {
  try {
    const mint = new Mint(mintUrl);
    const keysets = await mint.getKeySets();

    // Get preferred unit: msat over sat if both are active
    const activeKeysets = keysets.keysets.filter((k) => k.active);
    const units = [...new Set(activeKeysets.map((k) => k.unit))];
    const preferredUnit = units.includes("msat")
      ? "msat"
      : units.includes("sat")
        ? "sat"
        : "not supported";

    const wallet = new Wallet(mint, { unit: preferredUnit });

    // Load mint keysets
    await wallet.loadMint();

    // Create a melt quote
    const meltQuote = await wallet.createMeltQuote(paymentRequest);
    useCashuStore.getState().addMeltQuote(mintUrl, meltQuote);

    return meltQuote;
  } catch (error) {
    console.error("Error creating melt quote:", error);
    throw error;
  }
}

/** What a melt quote asks, in whole sats rounded up: a mint that offers msat
 *  quotes in msat, and the screens count sats. */
export function quoteInSats(
  quote: Pick<MeltQuoteResponse, "amount" | "fee_reserve" | "unit">
) {
  const sats = (n: number) => (quote.unit === "msat" ? Math.ceil(n / 1000) : n);
  return { amount: sats(quote.amount), feeReserve: sats(quote.fee_reserve) };
}

/**
 * Calculate total amount in a list of proofs
 * @param proofs List of proofs
 * @returns Total amount
 */
export function getProofsAmount(proofs: Proof[]): number {
  return proofs.reduce((total, proof) => total + proof.amount, 0);
}

/**
 * Parse a Lightning invoice to extract the amount
 * @param paymentRequest The Lightning invoice to parse
 * @returns The amount in satoshis or null if not found
 */
export function parseInvoiceAmount(paymentRequest: string): number | null {
  try {
    // Simple regex to extract amount from BOLT11 invoice
    // This is a basic implementation - a proper decoder would be better
    const match = paymentRequest.match(/lnbc(\d+)([munp])/i);

    if (!match) return null;

    let amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    // Convert to satoshis based on unit
    switch (unit) {
      case "p": // pico
        amount = Math.floor(amount / 10); // 1 pico-btc = 0.1 satoshi
        break;
      case "n": // nano
        amount = Math.floor(amount); // 1 nano-btc = 1 satoshi
        break;
      case "u": // micro
        amount = amount * 100; // 1 micro-btc = 100 satoshis
        break;
      case "m": // milli
        amount = amount * 100; // 1 milli-btc = 100,000 satoshis
        break;
      default: // btc
        amount = amount * 100000000; // 1 btc = 100,000,000 satoshis
    }

    return amount;
  } catch (error) {
    console.error("Error parsing invoice amount:", error);
    return null;
  }
}
