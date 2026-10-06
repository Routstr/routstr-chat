import {
  getEncodedTokenV4,
  getTokenMetadata,
  MeltQuoteState,
  type MeltQuoteBolt11Response,
  type Proof,
  type SwapPreview,
  type Wallet,
} from "@cashu/cashu-ts";
import type { Journal } from "./journal";
import { normalizeMintUrl, openWallet } from "./mint";
import {
  amountOf,
  saveOutputs,
  type MeltRecord,
  type SwapRecord,
} from "./records";
import {
  settleMelt,
  settleSwap,
  type CommitProofs,
  type MeltOutcome,
} from "./settle";

export interface ExecutorDeps {
  /** pubkey of the account whose money this executor moves */
  owner: string;
  journal: Journal;
  /** stores proofs in this account's wallet, and refuses once another account is active */
  commitFor: (mintUrl: string) => CommitProofs;
  openWallet?: (mintUrl: string) => Promise<Wallet>;
  /** Web Locks; without them the executor refuses to move money */
  locks?: LockManager;
}

const newId = () => crypto.randomUUID();

/** The coins to spend, or how to read them once this account's lock is held:
 *  coins read before it may already be spent by the operation ahead. */
type Coins = Proof[] | (() => Promise<Proof[]>);

export interface SendOptions {
  track?: boolean;
  includeFees?: boolean;
  handoff?: (token: string) => Promise<void>;
}

// a request that failed may still be on its way to the mint: it gets this long
// to land before the mint is asked what became of it
const LOST_ANSWER_WAIT_MS = 2000;
const afterLostAnswer = () =>
  new Promise((resolve) => setTimeout(resolve, LOST_ANSWER_WAIT_MS));

// tokens and mint requests carry only what the other side needs: never what
// the store keeps next to a coin (its NIP-60 event, its owner)
const bare = (proofs: Proof[]) =>
  proofs.map(({ id, amount, secret, C }) => ({ id, amount, secret, C }));

/** One operation per account at a time, in every tab; recovery waits for it. */
export const walletLock = (owner: string) => `routstr-chat-wallet:${owner}`;

/**
 * Moves one account's money. Every mint call that spends or creates coins is
 * written to the journal first, and the coins it returns are written down
 * before anything else is awaited, so a lost answer, a closed tab or a sign
 * out in between leaves a record the recovery host settles for this account.
 * Each operation holds the account's wallet lock from start to end.
 */
export class WalletExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  /** Pays a Lightning melt quote from these proofs of the wallet. */
  pay(
    mintUrl: string,
    quote: MeltQuoteBolt11Response,
    proofs: Proof[]
  ): Promise<{ state: MeltOutcome; fee: number; change: Proof[] }> {
    return this.locked(() => this.payLocked(mintUrl, quote, bare(proofs)));
  }

  private async payLocked(
    mintUrl: string,
    quote: MeltQuoteBolt11Response,
    proofs: Proof[]
  ): Promise<{ state: MeltOutcome; fee: number; change: Proof[] }> {
    const { journal, owner } = this.deps;
    const wallet = await this.open(mintUrl);
    const commit = this.deps.commitFor(mintUrl);
    const fee = quote.fee_reserve || 0;
    const amount = quote.amount + fee;
    if (amountOf(proofs) < amount) {
      throw new Error(`Not enough funds on mint ${mintUrl}`);
    }

    // coins that already make the exact amount need no swap
    let send: Proof[] = [];
    try {
      const exact = wallet.sendOffline(amount, proofs, {
        includeFees: true,
        exactMatch: true,
      }).send;
      if (amountOf(exact) === amount + wallet.getFeesForProofs(exact)) {
        send = exact;
      }
    } catch {
      // no exact selection
    }
    const swapped = send.length
      ? undefined
      : await this.swap(
          wallet,
          mintUrl,
          await wallet.prepareSwapToSend(amount, proofs, { includeFees: true }),
          proofs,
          commit
        );
    send = swapped?.send ?? send;

    const preview = await wallet.prepareMelt("bolt11", quote, send);
    const melt: MeltRecord = {
      v: 1,
      kind: "melt",
      id: newId(),
      owner,
      mintUrl,
      unit: wallet.unit,
      createdAt: Date.now(),
      keysetId: preview.keysetId,
      quoteId: quote.quote,
      inputs: send,
      blanks: saveOutputs(preview.outputData),
    };
    journal.put(melt);
    if (swapped) {
      // the swap's coins for the melt go straight into it, never into the wallet
      await commit(swapped.keep, []);
      journal.remove(swapped.id);
    } else {
      await commit([], send);
    }
    let answer;
    try {
      answer = await wallet.completeMelt(preview);
    } catch (error) {
      console.error("Melt request did not complete:", error);
      await afterLostAnswer();
    }
    if (answer?.quote.state === MeltQuoteState.PAID) {
      const change = answer.change;
      try {
        journal.put({
          ...this.held(melt.id, mintUrl, wallet),
          kind: "landed",
          proofs: change,
        });
      } catch (error) {
        // storage full: the melt record stays, and recovery restores the change
        console.error("Could not write the change down yet:", error);
      }
      // paid either way: change that fails to store now is stored by recovery
      await commit(change, []).then(
        () => journal.remove(melt.id),
        (error) => console.error("Could not store the change yet:", error)
      );
      return { state: "paid", fee, change };
    }
    // UNPAID, PENDING or no answer: only the mint's own states decide
    const settled = await settleMelt(wallet, melt, commit, journal).catch(
      () => ({ state: "pending" as const, change: [] })
    );
    return { ...settled, fee };
  }

  /**
   * Makes a token worth `sats` from these proofs of the wallet. A tracked
   * token stays listed until the person reclaims or dismisses it. `handoff`
   * is how the SDK stores a token it was given: the token stays listed until
   * that resolves, so if it never does the person can still reclaim it.
   */
  send(
    mintUrl: string,
    sats: number,
    coins: Coins,
    options: SendOptions = {}
  ): Promise<string> {
    return this.locked(async () =>
      this.sendLocked(
        mintUrl,
        sats,
        bare(typeof coins === "function" ? await coins() : coins),
        options
      )
    );
  }

  private async sendLocked(
    mintUrl: string,
    sats: number,
    proofs: Proof[],
    options: SendOptions
  ): Promise<string> {
    const { journal } = this.deps;
    const wallet = await this.open(mintUrl);
    const commit = this.deps.commitFor(mintUrl);
    const amount = wallet.unit === "msat" ? sats * 1000 : sats;
    // a token is always swapped fresh, never coins the wallet already held
    const preview = await wallet.prepareSwapToSend(amount, proofs, {
      keysetId: wallet.keysetId,
      includeFees: options.includeFees ?? true,
    });
    const { id, keep, send } = await this.swap(
      wallet,
      mintUrl,
      preview,
      proofs,
      commit
    );
    await commit(keep, []);
    const token = getEncodedTokenV4({
      mint: mintUrl,
      proofs: bare(send),
      unit: wallet.unit,
    });
    if (options.track || options.handoff) {
      const held = this.held(id, mintUrl, wallet);
      journal.put({ ...held, kind: "token", token, amount });
    } else {
      journal.remove(id);
    }
    if (options.handoff) {
      await options.handoff(token);
      journal.remove(id);
    }
    return token;
  }

  /**
   * Receives a token into the wallet. With `requirePersisted` it throws when
   * the new proofs could not be stored yet (they are kept and stored later).
   */
  receive(
    token: string,
    options: { requirePersisted?: boolean } = {}
  ): Promise<Proof[]> {
    return this.locked(() => this.receiveLocked(token, options));
  }

  private async receiveLocked(
    token: string,
    options: { requirePersisted?: boolean }
  ): Promise<Proof[]> {
    const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint);
    const wallet = await this.open(mintUrl);
    const commit = this.deps.commitFor(mintUrl);
    const preview = await wallet.prepareSwapToReceive(token);
    const { id, keep } = await this.swap(wallet, mintUrl, preview, [], commit);
    try {
      await commit(keep, []);
      this.deps.journal.remove(id);
    } catch (error) {
      if (options.requirePersisted) {
        throw new Error(
          "Token redeemed, but storing the funds failed - they will be restored automatically. " +
            (error instanceof Error ? error.message : String(error))
        );
      }
      console.error("Could not store the received proofs yet:", error);
    }
    return keep;
  }

  /**
   * One swap, written down before the mint call. `ours` are the wallet's
   * proofs the preview chose from (none when receiving): the inputs among
   * them leave the wallet first, and the ones the swap left untouched are not
   * returned again. The new proofs come back already held in the journal under
   * the returned id, until the caller stores them; a received token whose
   * answer was lost comes back already stored, from the mint's restore.
   */
  private async swap(
    wallet: Wallet,
    mintUrl: string,
    preview: SwapPreview,
    ours: Proof[],
    commit: CommitProofs
  ): Promise<{ id: string; keep: Proof[]; send: Proof[] }> {
    const { journal, owner } = this.deps;
    const record: SwapRecord = {
      v: 1,
      kind: "swap",
      id: newId(),
      owner,
      mintUrl,
      unit: wallet.unit,
      createdAt: Date.now(),
      keysetId: preview.keysetId,
      inputs: preview.inputs,
      outputs: saveOutputs([
        ...(preview.sendOutputs ?? []),
        ...(preview.keepOutputs ?? []),
      ]),
      ...(ours.length ? {} : { incoming: true as const }),
    };
    journal.put(record);
    if (ours.length) await commit([], preview.inputs);
    let answer;
    try {
      answer = await wallet.completeSwap(preview);
    } catch (error) {
      // no answer is not "no swap": settle from what the mint holds
      await afterLostAnswer();
      const restored = await settleSwap(wallet, record, commit, journal).catch(
        () => null
      );
      // a token received: the coins the mint signed for it are ours, so it went through
      if (!ours.length && restored?.length) {
        return { id: record.id, keep: restored, send: [] };
      }
      throw error;
    }
    const fresh = (proofs: Proof[]) =>
      proofs.filter((p) => !ours.some((q) => q.secret === p.secret));
    const keep = fresh(answer.keep);
    const send = fresh(answer.send);
    journal.put({
      ...this.held(record.id, mintUrl, wallet),
      kind: "landed",
      proofs: [...keep, ...send],
    });
    return { id: record.id, keep, send };
  }

  private held(id: string, mintUrl: string, wallet: Wallet) {
    const { owner } = this.deps;
    const unit = wallet.unit;
    return { v: 1 as const, id, owner, mintUrl, unit, createdAt: Date.now() };
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const locks = this.deps.locks;
    if (!locks) {
      throw new Error(
        "This browser cannot safely coordinate payments across tabs."
      );
    }
    return locks.request(walletLock(this.deps.owner), operation);
  }

  /** A mint that cannot say what became of a lost answer is not used: no guessing. */
  private async open(mintUrl: string) {
    const wallet = await (this.deps.openWallet ?? openWallet)(mintUrl);
    const info = wallet.getMintInfo();
    if (!info.isSupported(7).supported || !info.isSupported(9).supported) {
      throw new Error(
        `${mintUrl} cannot report what happened to a lost payment (NUT-07 and NUT-09), so the wallet does not move coins there.`
      );
    }
    return wallet;
  }
}
