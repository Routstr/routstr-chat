import {
  Mint,
  Wallet,
  MintQuoteState,
  MeltQuoteState,
  MeltQuoteResponse,
  Proof,
} from "@cashu/cashu-ts";
import { MintQuote, MeltQuote } from "../domain/Mint";
import { normalizeMintUrl } from "../utils/formatting";

/**
 * LightningService
 * Handles Lightning Network operations (mint/melt)
 */
export class LightningService {
  /**
   * Create a Lightning invoice to receive funds (mint quote)
   */
  async createMintQuote(mintUrl: string, amount: number): Promise<MintQuote> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new Mint(normalizedUrl);
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
    await wallet.loadMint();

    const mintQuote = await wallet.createMintQuote(amount);

    return {
      mintUrl: normalizedUrl,
      amount,
      paymentRequest: mintQuote.request,
      quoteId: mintQuote.quote,
      state: mintQuote.state,
      expiresAt: mintQuote.expiry ? mintQuote.expiry * 1000 : undefined,
    };
  }

  /**
   * Mint tokens after a Lightning invoice has been paid
   */
  async mintTokensFromPaidInvoice(
    mintUrl: string,
    quoteId: string,
    amount: number,
    maxAttempts: number = 40
  ): Promise<Proof[]> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new Mint(normalizedUrl);
    const keysets = await mint.getKeySets();

    const activeKeysets = keysets.keysets.filter((k) => k.active);
    const units = [...new Set(activeKeysets.map((k) => k.unit))];
    const preferredUnit = units.includes("msat")
      ? "msat"
      : units.includes("sat")
        ? "sat"
        : "not supported";

    const wallet = new Wallet(mint, { unit: preferredUnit });
    await wallet.loadMint();

    let attempts = 0;
    let mintQuoteChecked;

    // Poll until the invoice is paid
    while (attempts < maxAttempts) {
      try {
        mintQuoteChecked = await wallet.checkMintQuote(quoteId);

        if (mintQuoteChecked.state === MintQuoteState.PAID) {
          break;
        }

        attempts++;
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        console.error("Error checking mint quote:", error);
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    if (attempts === maxAttempts) {
      throw new Error("Failed to confirm payment after multiple attempts");
    }

    // Mint proofs using the paid quote
    const proofs = await wallet.mintProofs(amount, quoteId);
    return proofs as Proof[];
  }

  /**
   * Create a melt quote for a Lightning invoice (prepare to pay)
   */
  async createMeltQuote(
    mintUrl: string,
    paymentRequest: string
  ): Promise<MeltQuoteResponse> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new Mint(normalizedUrl);
    const keysets = await mint.getKeySets();

    const activeKeysets = keysets.keysets.filter((k) => k.active);
    const units = [...new Set(activeKeysets.map((k) => k.unit))];
    const preferredUnit = units.includes("msat")
      ? "msat"
      : units.includes("sat")
        ? "sat"
        : "not supported";

    const wallet = new Wallet(mint, { unit: preferredUnit });
    await wallet.loadMint();

    const meltQuote = await wallet.createMeltQuote(paymentRequest);
    return meltQuote;
  }

  /**
   * Parse a Lightning invoice to extract the amount
   */
  parseInvoiceAmount(paymentRequest: string): number | null {
    try {
      // Simple regex to extract amount from BOLT11 invoice
      const match = paymentRequest.match(/lnbc(\d+)([munp])/i);

      if (!match) return null;

      let amount = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      // Convert to satoshis based on unit
      switch (unit) {
        case "p": // pico
          amount = Math.floor(amount / 10);
          break;
        case "n": // nano
          amount = Math.floor(amount);
          break;
        case "u": // micro
          amount = amount * 100;
          break;
        case "m": // milli
          amount = amount * 100000;
          break;
        default:
          amount = amount * 100000000;
      }

      return amount;
    } catch (error) {
      console.error("Error parsing invoice amount:", error);
      return null;
    }
  }
}
