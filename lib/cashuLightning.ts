import { useCashuStore } from "@/features/wallet";
import {
  Mint,
  Wallet,
  MeltQuoteResponse,
  MeltQuoteState,
  MintQuoteResponse,
  MintQuoteState,
  Proof,
} from "@cashu/cashu-ts";
import { calculateFees, canMakeExactChange } from "@/features/wallet";
import { CashuToken } from "@/features/wallet/core/domain/Token";

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
  amount: number,
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
        "NetworkError when attempting to fetch resource",
      ) ||
        error.message.includes("Failed to fetch") ||
        error.message.includes("Load failed"))
    ) {
      throw new Error(
        `Mint connection error ${mintUrl}. The mint is blocking your IP or is down.`,
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
 * @returns The minted proofs
 */
export async function mintTokensFromPaidInvoice(
  mintUrl: string,
  quoteId: string,
  amount: number,
  maxAttempts: number = 40,
): Promise<Proof[]> {
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

    let attempts = 0;
    let mintQuoteChecked;

    while (attempts < maxAttempts) {
      try {
        // Check the status of the quote
        mintQuoteChecked = await wallet.checkMintQuote(quoteId);
        console.log("rdlogs: THE MAIN ONE, ", mintQuoteChecked);

        if (mintQuoteChecked.state === MintQuoteState.PAID) {
          break; // Exit the loop if the invoice is paid
        }

        // Invoice not paid yet - this is normal, just wait and try again
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for 3 seconds before retrying
        }
      } catch (error) {
        // Only log actual API/network errors
        console.error("Error checking mint quote:", error);
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for 3 seconds before retrying
        }
      }
    }

    if (attempts === maxAttempts) {
      throw new Error("Failed to confirm payment after multiple attempts");
    }

    // Mint proofs using the paid quote
    const proofs = await wallet.mintProofs(amount, quoteId);

    const mintQuoteUpdated = await wallet.checkMintQuote(quoteId);
    useCashuStore
      .getState()
      .updateMintQuote(mintUrl, quoteId, mintQuoteUpdated as MintQuoteResponse);

    return proofs;
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
  paymentRequest: string,
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
 * Pay a Lightning invoice by melting tokens
 * @param mintUrl The URL of the mint to use
 * @param quoteId The quote ID from the invoice
 * @param proofs The proofs to spend
 * @returns The fee and change proofs
 */
export async function payMeltQuote(
  mintUrl: string,
  quoteId: string,
  proofs: Proof[],
  cleanSpentProofs: (mintUrl: string) => Promise<Proof[]>,
) {
  try {
    const mint = new Mint(mintUrl);
    const keysets = await mint.getKeySets();
    const mintDetails = useCashuStore.getState().getMint(mintUrl);

    // Get preferred unit: msat over sat if both are active
    const activeKeysets = keysets.keysets.filter((k) => k.active);
    const units = [...new Set(activeKeysets.map((k) => k.unit))];
    const fees = [...new Array(activeKeysets.map((k) => k.input_fee_ppk))];
    console.log("rdlogs: lfees", fees);
    const preferredUnit = units.includes("msat")
      ? "msat"
      : units.includes("sat")
        ? "sat"
        : "not supported";

    const wallet = new Wallet(mint, { unit: preferredUnit });

    // Load mint keysets
    await wallet.loadMint();

    // Get melt quote from store
    const meltQuote = useCashuStore.getState().getMeltQuote(mintUrl, quoteId);

    // Calculate total amount needed, including fee
    const amountToSend = meltQuote.amount + meltQuote.fee_reserve;

    const proofsAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
    if (proofsAmount < amountToSend) {
      throw new Error(`Not enough funds on mint ${mintUrl}`);
    }
    console.log(
      "rdlogs: proofs lfees",
      calculateFees(proofs, activeKeysets as any),
    );
    const mintFees =
      calculateFees(proofs, activeKeysets as any) / proofs.length;

    let keep: Proof[], send: Proof[];

    try {
      // First, try wallet.send()
      console.log("Attempting wallet.send() for melt quote");
      const result = await wallet.send(amountToSend, proofs, {
        includeFees: true,
      });
      keep = result.keep;
      send = result.send;
      console.log("Successfully used wallet.send() for melt quote");
    } catch (error: any) {
      // Check if error is "Token already spent"
      if (error?.message?.includes("Token already spent")) {
        console.log("Detected spent tokens, cleaning up and retrying...");

        // Clean spent proofs
        await cleanSpentProofs(mintUrl);

        // Check if we still have enough funds after cleanup
        const newProofsAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
        if (newProofsAmount < amountToSend) {
          throw new Error(
            `Not enough funds on mint ${mintUrl} after cleaning spent proofs`,
          );
        }

        // Check exact change again with fresh proofs
        const freshDenominationCounts = proofs.reduce(
          (acc, p) => {
            acc[p.amount] = (acc[p.amount] || 0) + 1;
            return acc;
          },
          {} as Record<number, number>,
        );

        const exactChangeRetryResult = canMakeExactChange(
          amountToSend,
          freshDenominationCounts,
          proofs,
        );

        if (
          exactChangeRetryResult.canMake &&
          exactChangeRetryResult.selectedProofs
        ) {
          const selectedDenominations = exactChangeRetryResult.selectedProofs
            .map((p) => p.amount)
            .sort((a, b) => b - a);
          const denominationCounts = selectedDenominations.reduce(
            (acc, denom) => {
              acc[denom] = (acc[denom] || 0) + 1;
              return acc;
            },
            {} as Record<number, number>,
          );

          console.log(
            "rdlogs: Can make exact change on retry, using selected proofs directly",
          );
          console.log(
            "rdlogs: Selected denominations on retry:",
            selectedDenominations,
          );
          console.log(
            "rdlogs: Denomination breakdown on retry:",
            denominationCounts,
          );

          send = exactChangeRetryResult.selectedProofs;
          keep = proofs.filter((p) => !keep.includes(p));
        } else {
          console.log(
            "rdlogs: Cannot make exact change on retry, using wallet.send()",
          );
          const result = await wallet.send(amountToSend, proofs, {
            includeFees: true,
          });
          keep = result.keep;
          send = result.send;
        }
      }
      // Check if the error is "Not enough funds available for swap"
      else if (
        error?.message?.includes("Not enough funds available for swap")
      ) {
        console.log(
          "wallet.send() failed with insufficient funds, trying exact change methods",
        );

        // Get denomination counts for exact change attempts
        const denominationCounts = proofs.reduce(
          (acc, p) => {
            acc[p.amount] = (acc[p.amount] || 0) + 1;
            return acc;
          },
          {} as Record<number, number>,
        );
        console.log("rdlogs:", denominationCounts);

        // Try with 0% error tolerance first
        let exactChangeResult = canMakeExactChange(
          amountToSend,
          denominationCounts,
          proofs,
          mintFees,
          0,
        );

        if (!exactChangeResult.canMake || !exactChangeResult.selectedProofs) {
          console.log(
            "Cannot make exact change with 0% tolerance, trying with 5% tolerance",
          );
          // Try with 5% error tolerance
          exactChangeResult = canMakeExactChange(
            amountToSend,
            denominationCounts,
            proofs,
            mintFees,
            0.05,
          );
        }

        if (exactChangeResult.canMake && exactChangeResult.selectedProofs) {
          const selectedDenominations = exactChangeResult.selectedProofs
            .map((p) => p.amount)
            .sort((a, b) => b - a);
          const denominationBreakdown = selectedDenominations.reduce(
            (acc, denom) => {
              acc[denom] = (acc[denom] || 0) + 1;
              return acc;
            },
            {} as Record<number, number>,
          );

          const actualAmount = exactChangeResult.actualAmount || 0;
          const overpayment = actualAmount - amountToSend;
          const overpaymentPercent = (overpayment / amountToSend) * 100;

          console.log(
            "rdlogs: Can make change within tolerance, using selected proofs directly",
          );
          console.log("rdlogs: Target amount:", amountToSend);
          console.log("rdlogs: Actual amount:", actualAmount);
          console.log(
            "rdlogs: Overpayment:",
            overpayment,
            `(${overpaymentPercent.toFixed(2)}%)`,
          );
          console.log("rdlogs: Selected denominations:", selectedDenominations);
          console.log("rdlogs: Denomination breakdown:", denominationBreakdown);
          console.log("Using proofs within tolerance for melt quote payment");
          send = exactChangeResult.selectedProofs;
          keep = proofs.filter((p) => !send.includes(p));
        } else {
          // If all methods fail, re-throw the original error
          throw error;
        }
      } else {
        // Re-throw if it's a different error
        throw error;
      }
    }

    // Melt the selected proofs to pay the Lightning invoice
    let meltResponse;
    try {
      meltResponse = await wallet.meltProofs(meltQuote, send);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Check if error is "Token already spent"
      if (message.includes("Token already spent")) {
        console.log("Detected spent tokens, cleaning up and retrying...");
        if (error instanceof Error) {
          error.message =
            "Token already spent. Please go to your wallet and press Cleanup Wallet for this mint.";
        }
        throw error;
      }
      throw error;
    }

    const meltQuoteUpdated = await wallet.checkMeltQuote(meltQuote.quote);
    useCashuStore
      .getState()
      .updateMeltQuote(
        mintUrl,
        meltQuote.quote,
        meltQuoteUpdated as MeltQuoteResponse,
      );

    return {
      fee: meltQuote.fee_reserve || 0,
      change: meltResponse.change || [],
      keep,
      success: true,
    };
  } catch (error) {
    console.error("Error paying Lightning invoice:", error);
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
