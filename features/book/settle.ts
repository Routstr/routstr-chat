import {
  CheckStateEnum,
  MeltQuoteState,
  type OutputData,
  type Proof,
  type Wallet,
} from "@cashu/cashu-ts";
import type { Journal } from "./journal";
import {
  loadOutputs,
  type LandedRecord,
  type MeltRecord,
  type SwapRecord,
} from "./records";

/*
 * How each record is settled from what the mint says, after an answer was
 * lost or the app was closed. Anything the mint cannot answer yet stays.
 */

/** Stores proofs in the wallet of the record's account (and removes others). */
export type CommitProofs = (add: Proof[], remove: Proof[]) => Promise<unknown>;

/** Where a payment ended up. "pending" covers PENDING and any answer that
 *  never came: its coins stay out of the wallet until the mint says. */
export type MeltOutcome = "paid" | "failed" | "pending";

async function unspentOf(wallet: Wallet, proofs: Proof[]) {
  const states = await wallet.checkProofsStates(proofs);
  return {
    states,
    unspent: proofs.filter(
      (_, i) => states[i]?.state === CheckStateEnum.UNSPENT
    ),
  };
}

/** Signed outputs the mint already holds for these blinded messages (NUT-09),
 *  as proofs, the unspent ones only. */
async function restoreOutputs(
  wallet: Wallet,
  keysetId: string,
  outputs: OutputData[]
): Promise<Proof[]> {
  if (!outputs.length) return [];
  const res = await wallet.mint.restore({
    outputs: outputs.map((o) => o.blindedMessage),
  });
  if (!res.outputs.length) return [];
  // a keyset the mint has rotated out since still has its keys there
  const keyset = await wallet.keyChain.ensureKeysetKeys(keysetId);
  const proofs = res.outputs.flatMap((o, i) => {
    const data = outputs.find((d) => d.blindedMessage.B_ === o.B_);
    return data ? [data.toProof(res.signatures[i], keyset)] : [];
  });
  // a pass cut short may have stored these and they may be spent by now
  return (await unspentOf(wallet, proofs)).unspent;
}

/**
 * A swap whose answer never came. If the mint signed our outputs they come
 * back from restore. If it signed nothing, our own unspent inputs come back;
 * a received token's inputs are the sender's, so they stay with the token.
 * Returns false while the mint is still working on it (the record stays).
 */
export async function settleSwap(
  wallet: Wallet,
  record: SwapRecord,
  commit: CommitProofs,
  journal: Journal
): Promise<boolean> {
  // coins first: a swap still running holds its inputs PENDING, so restore runs only after
  const { states, unspent } = await unspentOf(wallet, record.inputs);
  if (states.some((s) => s.state === CheckStateEnum.PENDING)) return false;
  const restored = await restoreOutputs(
    wallet,
    record.keysetId,
    loadOutputs(record.outputs)
  );
  if (restored.length) await commit(restored, []);
  else if (!record.incoming) await commit(unspent, []);
  journal.remove(record.id);
  return true;
}

/**
 * A melt, from the payment's state (NUT-05) and its coins' states (NUT-07).
 * Anything they do not settle stays reserved.
 */
export async function settleMelt(
  wallet: Wallet,
  record: MeltRecord,
  commit: CommitProofs,
  journal: Journal
): Promise<{ state: MeltOutcome; change: Proof[] }> {
  // coins first: a quote still UNPAID after this read means the melt never ran,
  // so a coin the mint saw spent was a stale copy that made it refuse the melt
  const { states, unspent } = await unspentOf(wallet, record.inputs);
  const quote = await wallet.checkMeltQuote(record.quoteId);
  if (quote.state === MeltQuoteState.PAID) {
    // a paid quote is final, so coins read after it say whose payment it was
    const after = await unspentOf(wallet, record.inputs);
    if (after.states.some((s) => s.state === CheckStateEnum.PENDING)) {
      return { state: "pending", change: [] };
    }
    // a melt spends all its coins at once: unless all are spent, another
    // request paid the quote and these never left
    const ours =
      after.states.length === record.inputs.length && !after.unspent.length;
    const back = ours
      ? await restoreOutputs(
          wallet,
          record.keysetId,
          loadOutputs(record.blanks)
        )
      : after.unspent;
    await commit(back, []);
    journal.remove(record.id);
    return { state: "paid", change: ours ? back : [] };
  }
  if (
    quote.state === MeltQuoteState.UNPAID &&
    !states.some((s) => s.state === CheckStateEnum.PENDING)
  ) {
    await commit(unspent, []);
    journal.remove(record.id);
    return { state: "failed", change: [] };
  }
  return { state: "pending", change: [] };
}

/** New proofs the mint gave us that the wallet never stored: never handed to
 *  anyone, so the unspent ones are ours. */
export async function settleLanded(
  wallet: Wallet,
  record: LandedRecord,
  commit: CommitProofs,
  journal: Journal
): Promise<void> {
  await commit((await unspentOf(wallet, record.proofs)).unspent, []);
  journal.remove(record.id);
}
