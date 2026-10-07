"use client";

import type { Purse } from "@/features/wallet/purse";

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
  onPaymentSuccess?: (sats: number) => void | Promise<void>;
  onPaymentError?: (error: Error) => void;
}

export interface NWCPaymentResult {
  success: boolean;
  /** what reached the wallet */
  sats?: number;
  error?: string;
}

/** The wallet a refill lands in: it makes the invoice, written down before
 *  it is paid, and claims it once the mint has seen the payment. */
export type DepositWallet = Pick<Purse, "deposit" | "claim">;

// the mint may see the payment a while after the wallet sends it, and the
// payment has left by then: every failure is tried again for that long
const CLAIM_TRIES = 40;
const CLAIM_EVERY_MS = 3000;

async function claimWhenPaid(
  wallet: DepositWallet,
  mintUrl: string,
  quoteId: string
): Promise<number> {
  for (let i = 1; ; i++) {
    try {
      return await wallet.claim(mintUrl, quoteId);
    } catch (error) {
      if (i >= CLAIM_TRIES) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, CLAIM_EVERY_MS));
  }
}

/**
 * Pay a Lightning invoice using the connected NWC wallet.
 * This creates an invoice via the Cashu mint, pays it via NWC,
 * then claims the deposit into the wallet.
 *
 * @param amount Amount in sats to pay
 * @param mintUrl The Cashu mint URL to create invoice against
 * @param wallet Makes the invoice and claims it, for the account it is for even if another one is active by then; if this gives up, the wallet still claims it once paid
 * @param callbacks Optional callbacks for invoice creation, success, and error
 * @returns Promise resolving to payment result
 */
export async function payWithNWC(
  amount: number,
  mintUrl: string,
  wallet: DepositWallet,
  callbacks?: NWCPaymentCallbacks
): Promise<NWCPaymentResult> {
  try {
    // Check NWC connection
    const connected = await isNWCConnected();
    if (!connected) {
      throw new Error("NWC wallet not connected");
    }

    // Create invoice via Cashu mint
    const { request: paymentRequest, quoteId } = await wallet.deposit(
      mintUrl,
      amount
    );

    callbacks?.onInvoiceCreated?.(paymentRequest, quoteId);

    // Pay with connected NWC wallet
    const mod = await import("@getalby/bitcoin-connect-react");
    const provider = await mod.requestProvider();
    await provider.sendPayment(paymentRequest);

    // some wallets answer before the payment settles: the claim waits for the mint
    let sats: number;
    try {
      sats = await claimWhenPaid(wallet, mintUrl, quoteId);
    } catch (error) {
      if (!String(error).includes("not been paid")) throw error;
      throw new Error(
        "Payment did not complete within timeout. Please check your wallet."
      );
    }
    await callbacks?.onPaymentSuccess?.(sats);
    return { success: true, sats };
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
