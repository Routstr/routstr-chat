"use client";

import {
  createLightningInvoice,
  mintTokensFromPaidInvoice,
} from "@/lib/cashuLightning";
import { finalizeMintClaim } from "@/lib/mintQuoteRecovery";
import { MintQuoteState, Proof } from "@cashu/cashu-ts";

/**
 * Check if NWC (Nostr Wallet Connect) is connected
 * @returns Promise resolving to true if connected, false otherwise
 */
export async function isNWCConnected(): Promise<boolean> {
  try {
    const mod = await import("@getalby/bitcoin-connect-react");
    const cfg = mod.getConnectorConfig?.();
    return !!cfg;
  } catch {
    return false;
  }
}

/**
 * Get NWC wallet balance
 * @returns Promise resolving to balance in sats, or null if not available
 */
export async function getNWCBalance(): Promise<number | null> {
  try {
    const mod = await import("@getalby/bitcoin-connect-react");
    const provider = await mod.requestProvider();

    if (provider && typeof provider.getBalance === "function") {
      const res = await provider.getBalance();
      if (typeof res === "number") return res;
      if (res && typeof res === "object") {
        if ("balance" in res && typeof (res as any).balance === "number") {
          const unit = ((res as any).unit || "").toString().toLowerCase();
          const n = (res as any).balance as number;
          return unit.includes("msat") ? Math.floor(n / 1000) : n;
        }
        if (
          "balanceMsats" in res &&
          typeof (res as any).balanceMsats === "number"
        ) {
          return Math.floor((res as any).balanceMsats / 1000);
        }
      }
    }
  } catch {
    // NWC not connected or error fetching balance
  }
  return null;
}

export interface NWCPaymentCallbacks {
  onInvoiceCreated?: (invoice: string, quoteId: string) => void;
  onPaymentSuccess?: (proofs: Proof[], amount: number) => void | Promise<void>;
  onPaymentError?: (error: Error) => void;
}

export interface NWCPaymentResult {
  success: boolean;
  proofs?: Proof[];
  error?: string;
}

/**
 * Pay a Lightning invoice using the connected NWC wallet.
 * This creates an invoice via the Cashu mint, pays it via NWC,
 * then mints tokens from the paid invoice.
 *
 * @param amount Amount in sats to pay
 * @param mintUrl The Cashu mint URL to create invoice against
 * @param callbacks Optional callbacks for invoice creation, success, and error
 * @returns Promise resolving to payment result
 */
export async function payWithNWC(
  amount: number,
  mintUrl: string,
  callbacks?: NWCPaymentCallbacks
): Promise<NWCPaymentResult> {
  try {
    // Check NWC connection
    const connected = await isNWCConnected();
    if (!connected) {
      throw new Error("NWC wallet not connected");
    }

    // Create invoice via Cashu mint
    const invoiceData = await createLightningInvoice(mintUrl, amount);
    const { paymentRequest, quoteId } = invoiceData;

    callbacks?.onInvoiceCreated?.(paymentRequest, quoteId);

    // Pay with connected NWC wallet
    const mod = await import("@getalby/bitcoin-connect-react");
    const provider = await mod.requestProvider();

    const res = await provider.sendPayment(paymentRequest);

    // Check payment status - different wallets may return different formats
    const preimage = (res as any)?.preimage || (res as any)?.payment_preimage;

    if (preimage && preimage !== "") {
      // Payment successful, mint tokens
      const proofs = await mintTokensFromPaidInvoice(mintUrl, quoteId, amount);

      if (proofs.length > 0) {
        await callbacks?.onPaymentSuccess?.(proofs, amount);
        finalizeMintClaim(mintUrl, quoteId);
        return { success: true, proofs };
      } else {
        return { success: true, proofs: [] };
      }
    } else {
      // Empty or no preimage - payment might still be processing
      // Poll for payment status (some wallets process async)

      // Poll up to 30 seconds
      const maxPolls = 15;
      const pollInterval = 2000; // 2 seconds

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        try {
          const proofs = await mintTokensFromPaidInvoice(
            mintUrl,
            quoteId,
            amount
          );
          if (proofs.length > 0) {
            await callbacks?.onPaymentSuccess?.(proofs, amount);
            finalizeMintClaim(mintUrl, quoteId);
            return { success: true, proofs };
          }
        } catch (e) {
          // Invoice not paid yet, continue polling
        }
      }

      // After polling, payment didn't complete
      throw new Error(
        "Payment did not complete within timeout. Please check your wallet."
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown payment error";
    console.error(`[payWithNWC] Error:`, errorMessage);
    callbacks?.onPaymentError?.(
      error instanceof Error ? error : new Error(errorMessage)
    );
    return { success: false, error: errorMessage };
  }
}

/**
 * Attempt to mint tokens from a previously paid invoice (for polling scenarios)
 * @param mintUrl The Cashu mint URL
 * @param quoteId The quote ID from the invoice creation
 * @param amount The expected amount
 * @returns Promise resolving to proofs if successful, empty array otherwise
 */
export async function attemptMintFromQuote(
  mintUrl: string,
  quoteId: string,
  amount: number
): Promise<Proof[]> {
  try {
    const proofs = await mintTokensFromPaidInvoice(mintUrl, quoteId, amount);
    if (proofs.length > 0) finalizeMintClaim(mintUrl, quoteId);
    return proofs;
  } catch {
    return [];
  }
}
