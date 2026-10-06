import { useCashuStore } from "@/features/wallet";
import {
  Mint,
  Wallet,
  MeltQuoteResponse,
  MeltQuoteState,
  MintQuoteState,
  Proof,
} from "@cashu/cashu-ts";
import { claimPaidMintQuote } from "./mintQuoteRecovery";

export interface MintQuote {
  mintUrl: string;
  amount: number;
  paymentRequest: string;
  quoteId: string;
  state: MintQuoteState;
  expiresAt?: number;
}

export interface MeltQuote {
  mintUrl: string;
  amount: number;
  paymentRequest: string;
  quoteId: string;
  state: MeltQuoteState;
  expiresAt?: number;
}

/**
 * Create a Lightning invoice to receive funds
 * @param mintUrl The URL of the mint to use
 * @param amount Amount in satoshis
 * @returns Object containing the invoice and information needed to process it
 */
export async function createLightningInvoice(
  mintUrl: string,
  amount: number
): Promise<MintQuote> {
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

    // Create a mint quote
    const mintQuote = await wallet.createMintQuote(amount);
    useCashuStore.getState().addMintQuote(mintUrl, mintQuote);

    // Return the invoice and quote information
    return {
      mintUrl,
      amount,
      paymentRequest: mintQuote.request,
      quoteId: mintQuote.quote,
      state: MintQuoteState.UNPAID,
      expiresAt: mintQuote.expiry ? mintQuote.expiry * 1000 : undefined,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes(
        "NetworkError when attempting to fetch resource"
      ) ||
        error.message.includes("Failed to fetch") ||
        error.message.includes("Load failed"))
    ) {
      throw new Error(
        `Mint connection error ${mintUrl}. The mint is blocking your IP or is down.`
      );
    }
    console.error("Error creating Lightning invoice:", error);
    throw error;
  }
}

/**
 * Mint tokens after a Lightning invoice has been paid
 * @param mintUrl The URL of the mint to use
 * @param quoteId The quote ID from the invoice
 * @param amount Amount in satoshis
 * @param owner The account the invoice was made for; the active one if left out or a guest
 * @returns The minted proofs
 */
export async function mintTokensFromPaidInvoice(
  mintUrl: string,
  quoteId: string,
  amount: number,
  maxAttempts: number = 40,
  owner?: string | null
): Promise<Proof[]> {
  try {
    return await claimPaidMintQuote(
      mintUrl,
      quoteId,
      amount,
      maxAttempts,
      owner
    );
  } catch (error) {
    console.error("Error minting tokens from paid invoice:", error);
    throw error;
  }
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
