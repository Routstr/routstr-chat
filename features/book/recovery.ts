import {
  Mint,
  MintOperationError,
  MintQuoteState,
  type Proof,
  type Wallet,
} from "@cashu/cashu-ts";
import { claimPaid, walletLock } from "./executor";
import type { Journal } from "./journal";
import type { BookRecord } from "./records";
import { forgetWallets, openWallet } from "./mint";
import {
  settleLanded,
  settleMelt,
  settleMint,
  settleSwap,
  type CommitProofs,
  type MeltOutcome,
} from "./settle";

// how long a mint gets to say what became of a deposit quote
const QUOTE_MS = 10_000;
// a quote is over only this long after its expiry, in case clocks differ
const EXPIRY_GRACE_MS = 5 * 60_000;

export interface RecoveryDeps {
  journal: Journal;
  openWallet?: (mintUrl: string, unit?: string) => Promise<Wallet>;
  /** Web Locks; without them nothing is settled (the records wait) */
  locks?: LockManager;
  /** Coins of a deposit recovery claimed, for the account's activity. */
  claimed?: (owner: string, proofs: Proof[], unit: string) => void;
}

/** Whether a pass has anything to do with this record: a token waits for the
 *  person and a receive for the purse; a quote only once the mint says paid
 *  or issued, or unpaid past its expiry. */
function due(
  record: BookRecord,
  answer: { state: string; at: number } | undefined
): boolean {
  if (record.kind === "token" || record.kind === "receive") return false;
  if (record.kind !== "quote") return true;
  if (answer?.state === MintQuoteState.UNPAID) {
    return !!record.expiresAt && answer.at > record.expiresAt + EXPIRY_GRACE_MS;
  }
  return (
    answer?.state === MintQuoteState.PAID ||
    answer?.state === MintQuoteState.ISSUED
  );
}

/** Settles each account's records that the operation writing them left behind. */
export class RecoveryHost {
  constructor(private readonly deps: RecoveryDeps) {}

  /**
   * One pass over this account's records. It runs only when no operation of
   * this account is running in any tab (they hold the account's wallet lock),
   * so every record it finds was left behind. Returns each melt's outcome by
   * quote id.
   */
  async settle(
    owner: string,
    commitFor: (mintUrl: string) => CommitProofs
  ): Promise<Map<string, MeltOutcome>> {
    const outcomes = new Map<string, MeltOutcome>();
    const locks = this.deps.locks;
    if (!locks) return outcomes;
    // deposit quotes are asked about outside the lock: most wait unpaid
    const quotes = await this.quoteStates(owner);
    // nothing to settle: the lock is left to the person's own payments
    if (!this.deps.journal.list(owner).some((r) => due(r, quotes.get(r.id)))) {
      return outcomes;
    }
    // a pass already running, here or in another tab, holds the lock too
    await locks.request(walletLock(owner), { ifAvailable: true }, (lock) =>
      lock ? this.pass(owner, commitFor, outcomes, quotes) : undefined
    );
    return outcomes;
  }

  /** What each deposit quote's mint says of it now; none when it did not
   *  answer in time. */
  private async quoteStates(
    owner: string
  ): Promise<Map<string, { state: string; at: number }>> {
    const states = new Map<string, { state: string; at: number }>();
    await Promise.all(
      this.deps.journal.list(owner).map(async (record) => {
        if (record.kind !== "quote") return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const quote = await Promise.race([
            new Mint(record.mintUrl).checkMintQuoteBolt11(record.quoteId),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("no answer")),
                QUOTE_MS
              );
            }),
          ]);
          states.set(record.id, { state: quote.state, at: Date.now() });
        } catch (error) {
          // the mint says it does not know it (purged once expired): unpaid
          if (error instanceof MintOperationError) {
            states.set(record.id, {
              state: MintQuoteState.UNPAID,
              at: Date.now(),
            });
          }
          // no answer: the quote waits for the next pass
        } finally {
          clearTimeout(timer);
        }
      })
    );
    return states;
  }

  private async pass(
    owner: string,
    commitFor: (mintUrl: string) => CommitProofs,
    outcomes: Map<string, MeltOutcome>,
    quotes: Map<string, { state: string; at: number }>
  ) {
    const { journal } = this.deps;
    for (const record of journal.list(owner)) {
      // a token waits for the person; a receive is tried by the purse
      if (record.kind === "token" || record.kind === "receive") continue;
      if (record.kind === "quote") {
        const answer = quotes.get(record.id);
        if (answer?.state === MintQuoteState.UNPAID) {
          // an invoice nobody paid in time is over: judged by when the mint
          // said unpaid, not by when this pass got to it
          if (
            record.expiresAt &&
            answer.at > record.expiresAt + EXPIRY_GRACE_MS
          ) {
            journal.remove(record.id);
          }
          continue;
        }
        if (answer?.state === MintQuoteState.ISSUED) {
          // claimed elsewhere: a record still of this kind never sent outputs
          journal.remove(record.id);
          continue;
        }
        if (answer?.state !== MintQuoteState.PAID) continue;
      }
      try {
        const wallet = await (this.deps.openWallet ?? openWallet)(
          record.mintUrl,
          record.unit
        );
        const commit = commitFor(record.mintUrl);
        if (record.kind === "swap") {
          const restored = await settleSwap(wallet, record, commit, journal);
          // a waiting token whose swap landed after all is received
          if (record.incoming && restored?.length) {
            const inputs = new Set(record.inputs.map((p) => p.secret));
            journal
              .list(owner)
              .filter(
                (r) =>
                  r.kind === "receive" && r.secrets.some((s) => inputs.has(s))
              )
              .forEach((r) => journal.remove(r.id));
          }
        } else if (record.kind === "melt") {
          const { state } = await settleMelt(wallet, record, commit, journal);
          outcomes.set(record.quoteId, state);
        } else if (record.kind === "mint") {
          const proofs = await settleMint(wallet, record, commit, journal);
          if (proofs?.length) this.deps.claimed?.(owner, proofs, wallet.unit);
        } else if (record.kind === "quote") {
          // paid, whoever made it and whether anyone still waits for it
          const quote = await wallet.checkMintQuoteBolt11(record.quoteId);
          if (quote.state === MintQuoteState.PAID) {
            const proofs = await claimPaid(
              wallet,
              record,
              quote,
              commit,
              journal
            );
            this.deps.claimed?.(owner, proofs, wallet.unit);
          }
        } else {
          await settleLanded(wallet, record, commit, journal);
        }
      } catch (error) {
        // the mint did not answer, or this account is no longer active: the record waits
        console.error("Could not settle a pending wallet operation:", error);
        forgetWallets(record.mintUrl);
      }
    }
  }
}
