import { useCashuStore } from "@/features/wallet";
import {
  CheckStateEnum,
  Mint,
  Wallet,
  MeltQuoteResponse,
  MeltQuoteState,
  MintQuoteResponse,
  MintQuoteState,
  OutputData,
  Proof,
} from "@cashu/cashu-ts";
import {
  decodeOutputs,
  encodeOutputs,
  listEntries,
  putEntry,
  removeEntry,
  type MeltEntry,
  type SwapEntry,
} from "./meltJournal";

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
 * @returns The minted proofs
 */
export async function mintTokensFromPaidInvoice(
  mintUrl: string,
  quoteId: string,
  amount: number,
  maxAttempts: number = 40
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

/** Where a payment ended up. "pending" covers PENDING and any answer that never came:
 *  its coins stay out of the wallet until the mint says what happened. */
export type MeltOutcome = "paid" | "failed" | "pending";

/** Moves proofs in and out of the wallet store (and its NIP-60 copy) in one step. */
export type CommitProofs = (add: Proof[], remove: Proof[]) => Promise<unknown>;

async function walletFor(mintUrl: string) {
  const mint = new Mint(mintUrl);
  const keysets = await mint.getKeySets();
  // Get preferred unit: msat over sat if both are active
  const units = [...new Set(keysets.keysets.filter((k) => k.active).map((k) => k.unit))];
  const unit = units.includes("msat") ? "msat" : units.includes("sat") ? "sat" : "not supported";
  const wallet = new Wallet(mint, { unit });
  await wallet.loadMint();
  return wallet;
}

// how long a running payment may take before the reconciler treats its entry as abandoned
const IN_FLIGHT_MS = 3 * 60_000;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Signed outputs the mint already holds for these blinded messages (NUT-09), as proofs. */
async function restoreOutputs(wallet: Wallet, keysetId: string, outputs: OutputData[]): Promise<Proof[]> {
  if (!outputs.length) return [];
  const res = await wallet.mint.restore({ outputs: outputs.map((o) => o.blindedMessage) });
  const keyset = wallet.getKeyset(keysetId);
  return res.outputs.flatMap((o, i) => {
    const data = outputs.find((d) => d.blindedMessage.B_ === o.B_);
    return data ? [data.toProof(res.signatures[i], keyset)] : [];
  });
}

/**
 * Settles a swap whose answer never arrived. If the mint signed our outputs they come back from
 * restore and the inputs are gone; if it signed nothing, the inputs still unspent return to the
 * wallet. Returns the fresh proofs, or null when the mint cannot tell yet (the entry stays).
 */
async function settleSwap(wallet: Wallet, entry: SwapEntry, commit: CommitProofs): Promise<Proof[] | null> {
  const restored = await restoreOutputs(wallet, entry.keysetId, decodeOutputs(entry.outputs));
  if (restored.length) {
    await commit(restored, []);
    removeEntry(entry.id);
    return restored;
  }
  const states = await wallet.checkProofsStates(entry.inputs);
  if (states.some((s) => s.state === CheckStateEnum.PENDING)) return null;
  const unspent = entry.inputs.filter((_, i) => states[i]?.state === CheckStateEnum.UNSPENT);
  await commit(unspent, []);
  removeEntry(entry.id);
  return [];
}

/**
 * Settles a melt from the mint's two answers: the payment's state (NUT-05) and the state of the
 * coins it was given (NUT-07). Anything they do not settle stays reserved.
 */
async function settleMelt(wallet: Wallet, entry: MeltEntry, commit: CommitProofs): Promise<{ state: MeltOutcome; change: Proof[] }> {
  // coins first: a quote still UNPAID after this read means the melt never ran, so a coin the mint
  // saw spent was a stale copy spent elsewhere, and the mint refused the melt for it
  const states = await wallet.checkProofsStates(entry.inputs);
  const quote = await wallet.checkMeltQuote(entry.quoteId);
  const all = (s: string) => states.length === entry.inputs.length && states.every((x) => x.state === s);
  if (quote.state === MeltQuoteState.PAID && all(CheckStateEnum.SPENT)) {
    const change = await restoreOutputs(wallet, entry.keysetId, decodeOutputs(entry.blanks));
    await commit(change, []);
    removeEntry(entry.id);
    return { state: "paid", change };
  }
  if (quote.state === MeltQuoteState.UNPAID && !states.some((s) => s.state === CheckStateEnum.PENDING)) {
    await commit(entry.inputs.filter((_, i) => states[i]?.state === CheckStateEnum.UNSPENT), []);
    removeEntry(entry.id);
    return { state: "failed", change: [] };
  }
  return { state: "pending", change: [] };
}

/**
 * Pay a Lightning invoice by melting tokens. Every mint call is written to the journal (with its
 * inputs taken out of the wallet) before it is sent, so no answer, a failure or a crash can lose
 * coins: they are settled now or by reconcileJournal later.
 * @param proofs The proofs at this mint to pay from
 * @param commit Moves proofs in and out of the wallet store
 */
export async function payMeltQuote(
  mintUrl: string,
  quoteId: string,
  proofs: Proof[],
  commit: CommitProofs
): Promise<{ state: MeltOutcome; fee: number; change: Proof[] }> {
  const wallet = await walletFor(mintUrl);
  const meltQuote = useCashuStore.getState().getMeltQuote(mintUrl, quoteId);
  const amountToSend = meltQuote.amount + meltQuote.fee_reserve;
  if (proofs.reduce((sum, p) => sum + p.amount, 0) < amountToSend) {
    throw new Error(`Not enough funds on mint ${mintUrl}`);
  }

  // the exact amount from coins already held needs no swap; otherwise swap for it, written down first
  let send: Proof[] = [];
  try {
    // an exact selection covers the amount and the fee for spending its own coins
    const exact = wallet.sendOffline(amountToSend, proofs, { includeFees: true, exactMatch: true }).send;
    if (exact.reduce((s, p) => s + p.amount, 0) === amountToSend + wallet.getFeesForProofs(exact)) send = exact;
  } catch {
    // no exact selection: swap below
  }
  if (!send.length) {
    const preview = await wallet.prepareSwapToSend(amountToSend, proofs, { includeFees: true });
    const swap: SwapEntry = {
      v: 1,
      kind: "swap",
      id: newId(),
      mintUrl,
      keysetId: preview.keysetId,
      createdAt: Date.now(),
      inputs: preview.inputs,
      outputs: encodeOutputs([...(preview.sendOutputs ?? []), ...(preview.keepOutputs ?? [])]),
    };
    putEntry(swap);
    await commit([], preview.inputs);
    try {
      const res = await wallet.completeSwap(preview);
      await commit([...res.keep, ...res.send], []);
      removeEntry(swap.id);
      send = res.send;
    } catch (error) {
      // no answer is not "no swap": settle from what the mint holds, then stop this payment
      await settleSwap(wallet, swap, commit).catch(() => null);
      throw error;
    }
  }

  const preview = await wallet.prepareMelt("bolt11", meltQuote, send);
  const melt: MeltEntry = {
    v: 1,
    kind: "melt",
    id: newId(),
    mintUrl,
    keysetId: preview.keysetId,
    createdAt: Date.now(),
    quoteId,
    inputs: send,
    blanks: encodeOutputs(preview.outputData),
  };
  putEntry(melt);
  await commit([], send);
  try {
    const res = await wallet.completeMelt(preview);
    useCashuStore.getState().updateMeltQuote(mintUrl, quoteId, res.quote as MeltQuoteResponse);
    if (res.quote.state === MeltQuoteState.PAID) {
      await commit(res.change, []);
      removeEntry(melt.id);
      return { state: "paid", fee: meltQuote.fee_reserve || 0, change: res.change };
    }
  } catch (error) {
    console.error("Melt request did not complete:", error);
  }
  // UNPAID, PENDING or no answer: only the mint's own states decide
  const settled = await settleMelt(wallet, melt, commit).catch(() => ({ state: "pending" as const, change: [] }));
  return { ...settled, fee: meltQuote.fee_reserve || 0 };
}

/**
 * Settles every journal entry the mint can answer for: a swap whose answer was lost, a melt that
 * was PENDING or unanswered. Melts report their outcome by quote id.
 */
export async function reconcileJournal(
  commitFor: (mintUrl: string) => CommitProofs
): Promise<Map<string, MeltOutcome>> {
  const outcomes = new Map<string, MeltOutcome>();
  for (const entry of listEntries()) {
    // a payment still running in this or another tab owns its entry for now
    if (Date.now() - entry.createdAt < IN_FLIGHT_MS) continue;
    try {
      const wallet = await walletFor(entry.mintUrl);
      const commit = commitFor(entry.mintUrl);
      if (entry.kind === "swap") await settleSwap(wallet, entry, commit);
      else outcomes.set(entry.quoteId, (await settleMelt(wallet, entry, commit)).state);
    } catch (error) {
      // the mint did not answer: the entry stays for the next pass
      console.error("Could not settle a pending wallet operation:", error);
    }
  }
  return outcomes;
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
