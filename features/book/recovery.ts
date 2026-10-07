import type { Wallet } from "@cashu/cashu-ts";
import { walletLock } from "./executor";
import type { Journal } from "./journal";
import { openWallet } from "./mint";
import {
  settleLanded,
  settleMelt,
  settleMint,
  settleSwap,
  type CommitProofs,
  type MeltOutcome,
} from "./settle";

export interface RecoveryDeps {
  journal: Journal;
  openWallet?: (mintUrl: string, unit?: string) => Promise<Wallet>;
  /** Web Locks; without them nothing is settled (the records wait) */
  locks?: LockManager;
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
    // a pass already running, here or in another tab, holds the lock too
    await locks.request(walletLock(owner), { ifAvailable: true }, (lock) =>
      lock ? this.pass(owner, commitFor, outcomes) : undefined
    );
    return outcomes;
  }

  private async pass(
    owner: string,
    commitFor: (mintUrl: string) => CommitProofs,
    outcomes: Map<string, MeltOutcome>
  ) {
    const { journal } = this.deps;
    for (const record of journal.list(owner)) {
      // a token waits for the person; a receive is tried by the purse
      if (record.kind === "token" || record.kind === "receive") continue;
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
          await settleMint(wallet, record, commit, journal);
        } else {
          await settleLanded(wallet, record, commit, journal);
        }
      } catch (error) {
        // the mint did not answer, or this account is no longer active: the record waits
        console.error("Could not settle a pending wallet operation:", error);
      }
    }
  }
}
