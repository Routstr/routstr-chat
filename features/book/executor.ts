import {
  getEncodedTokenV4,
  getTokenMetadata,
  MeltQuoteState,
  Mint,
  MintOperationError,
  MintQuoteState,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  type Proof,
  type SwapPreview,
  type Wallet,
} from "@cashu/cashu-ts";
import type { Journal } from "./journal";
import { assertRecoverable, normalizeMintUrl, openWallet } from "./mint";
import {
  amountOf,
  saveOutputs,
  type MeltRecord,
  type MintRecord,
  type QuoteRecord,
  type ReceiveRecord,
  type SwapRecord,
} from "./records";
import {
  settleMelt,
  settleMint,
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
  openWallet?: (mintUrl: string, unit?: string) => Promise<Wallet>;
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
  /** the provider the handoff gives the token to, kept on its record */
  to?: string;
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
const read = async (coins: Coins) =>
  bare(typeof coins === "function" ? await coins() : coins);

// how long a mint gets to show it is there before a token for it waits
const REACH_MS = 10_000;

/**
 * Claims a paid quote's coins. Its record turns into a `mint` record holding
 * the exact outputs before the mint is asked, so a lost answer is restored,
 * here or by recovery; the coins are stored before the record goes. Throws
 * when the coins could not be stored yet (they wait in the book).
 */
export async function claimPaid(
  wallet: Wallet,
  record: QuoteRecord,
  quote: Pick<MintQuoteBolt11Response, "amount">,
  commit: CommitProofs,
  journal: Journal
): Promise<Proof[]> {
  const preview = await wallet.prepareMint(
    "bolt11",
    quote.amount,
    record.quoteId,
    { keysetId: wallet.keysetId }
  );
  const base = {
    v: 1 as const,
    id: record.id,
    owner: record.owner,
    mintUrl: record.mintUrl,
    unit: wallet.unit,
    createdAt: record.createdAt,
  };
  const claim: MintRecord = {
    ...base,
    kind: "mint",
    keysetId: preview.keysetId,
    quoteId: record.quoteId,
    amount: quote.amount,
    outputs: saveOutputs(preview.outputData),
  };
  journal.put(claim);
  let proofs: Proof[];
  try {
    proofs = await wallet.completeMint(preview);
  } catch (error) {
    console.error("Mint request did not complete:", error);
    await afterLostAnswer();
    const restored = await settleMint(wallet, claim, commit, journal).catch(
      () => null
    );
    if (restored?.length) return restored;
    throw error;
  }
  try {
    journal.put({ ...base, kind: "landed", proofs });
  } catch (error) {
    // storage full: the mint record stays, and recovery restores the coins
    console.error("Could not write the coins down yet:", error);
  }
  try {
    await commit(proofs, []);
  } catch (error) {
    // the coins wait in the book, and recovery stores them once it can
    throw new Error(
      "Deposit claimed, but storing the funds failed - they will be restored automatically. " +
        (error instanceof Error ? error.message : String(error))
    );
  }
  journal.remove(record.id);
  return proofs;
}

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

  /** Pays a Lightning melt quote from these coins of the wallet. */
  pay(
    mintUrl: string,
    quote: MeltQuoteBolt11Response,
    coins: Coins
  ): Promise<{ state: MeltOutcome; fee: number; change: Proof[] }> {
    return this.locked(async () =>
      this.payLocked(mintUrl, quote, await read(coins))
    );
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
      this.sendLocked(mintUrl, sats, await read(coins), options)
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
      journal.put({
        ...held,
        kind: "token",
        token,
        amount,
        ...(options.to ? { baseUrl: options.to } : {}),
      });
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

  /**
   * Takes a token into the wallet. It is written down first, before any
   * network step, so a token whose mint cannot be reached stays in the book
   * and is tried again (retryReceives); the same token twice is one record.
   * Resolves once the wallet owns it: the coins it gave, or pending. Throws
   * only when nothing was kept: the mint refused it (spent, invalid) or the
   * record could not be written.
   */
  async take(
    token: string
  ): Promise<{ proofs: Proof[]; unit: string; pending: boolean }> {
    if (!this.deps.locks) {
      throw new Error(
        "This browser cannot safely coordinate payments across tabs."
      );
    }
    const record = this.holdReceive(token);
    // a mint that does not answer never holds the account's lock
    if (!(await this.reachable(record.mintUrl))) {
      return { proofs: [], unit: record.unit ?? "sat", pending: true };
    }
    return this.locked(() => this.landReceive(record));
  }

  /** Tries every token this account still holds to receive; resolves with
   *  what landed. One the mint refuses (spent, invalid) is dropped. */
  async retryReceives(): Promise<{ proofs: Proof[]; unit: string }[]> {
    const landed: { proofs: Proof[]; unit: string }[] = [];
    for (const record of this.deps.journal.list(this.deps.owner)) {
      if (record.kind !== "receive") continue;
      if (!(await this.reachable(record.mintUrl))) continue;
      const got = await this.locked(() => this.landReceive(record)).catch(
        (error) => {
          console.error("A waiting token was refused:", error);
          return null;
        }
      );
      if (got?.proofs.length) landed.push(got);
    }
    return landed;
  }

  /** The mint answers at all, within REACH_MS: asked outside the lock. */
  private async reachable(mintUrl: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Mint(mintUrl).getInfo(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("no answer")), REACH_MS);
        }),
      ]);
      return true;
    } catch (error) {
      console.error(`${mintUrl} could not be reached; its token waits:`, error);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private holdReceive(token: string): ReceiveRecord {
    const { journal, owner } = this.deps;
    const { mint, unit, amount, incompleteProofs } = getTokenMetadata(token);
    const secrets = incompleteProofs.map((p) => p.secret);
    const held = journal
      .list(owner)
      .find(
        (r): r is ReceiveRecord =>
          r.kind === "receive" && r.secrets.some((s) => secrets.includes(s))
      );
    if (held) return held;
    const record: ReceiveRecord = {
      v: 1,
      kind: "receive",
      id: newId(),
      owner,
      mintUrl: normalizeMintUrl(mint),
      unit,
      createdAt: Date.now(),
      token,
      amount,
      secrets,
    };
    journal.put(record);
    return record;
  }

  private async landReceive(
    record: ReceiveRecord
  ): Promise<{ proofs: Proof[]; unit: string; pending: boolean }> {
    const unit = record.unit ?? "sat";
    const { journal, owner } = this.deps;
    // a retry, here or in another tab, took it in while this one waited
    if (!journal.list(owner).some((r) => r.id === record.id)) {
      return { proofs: [], unit, pending: false };
    }
    try {
      const proofs = await this.receiveLocked(record.token, {});
      journal.remove(record.id);
      return { proofs, unit, pending: false };
    } catch (error) {
      // only the mint's own refusal ends it: no network, a proxy's page or a
      // reply that makes no sense keep the token for later
      if (error instanceof MintOperationError) {
        journal.remove(record.id);
        throw error;
      }
      console.error("The token could not be received yet; it waits:", error);
      return { proofs: [], unit, pending: true };
    }
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
   * Claims the coins of a paid deposit (NUT-04 mint quote `quoteId`), in the
   * quote's unit. The outputs are written down before the mint is asked, so a
   * lost answer is restored, here or by recovery. Resolves with no coins when
   * the quote was already issued with nothing of ours left to restore (claimed
   * earlier, or by another tab or device); throws while it is unpaid.
   */
  async claim(
    mintUrl: string,
    quoteId: string
  ): Promise<{ proofs: Proof[]; unit: string }> {
    const url = normalizeMintUrl(mintUrl);
    // an unpaid invoice is asked about every few seconds: never under the
    // account's lock, so a slow mint never holds up a payment
    const quote = await new Mint(url).checkMintQuoteBolt11(quoteId);
    if (
      quote.state === MintQuoteState.UNPAID &&
      !this.leftClaim(url, quoteId)
    ) {
      throw new Error("Invoice has not been paid yet");
    }
    return this.locked(() => this.claimLocked(url, quoteId));
  }

  private leftClaim(mintUrl: string, quoteId: string) {
    return this.deps.journal
      .list(this.deps.owner)
      .find(
        (r): r is MintRecord =>
          r.kind === "mint" && r.mintUrl === mintUrl && r.quoteId === quoteId
      );
  }

  private async claimLocked(
    mintUrl: string,
    quoteId: string
  ): Promise<{ proofs: Proof[]; unit: string }> {
    const { journal, owner } = this.deps;
    let wallet = await this.open(mintUrl);
    const quote = await wallet.checkMintQuoteBolt11(quoteId);
    if (quote.unit && quote.unit !== wallet.unit) {
      wallet = await this.open(mintUrl, quote.unit);
    }
    const commit = this.deps.commitFor(mintUrl);
    const left = this.leftClaim(mintUrl, quoteId);
    if (left) {
      const proofs = await settleMint(wallet, left, commit, journal);
      if (!proofs) throw new Error("The mint has not settled this deposit yet");
      return { proofs, unit: wallet.unit };
    }
    if (quote.state === MintQuoteState.UNPAID) {
      throw new Error("Invoice has not been paid yet");
    }
    const made = journal
      .list(owner)
      .find(
        (r): r is QuoteRecord =>
          r.kind === "quote" && r.mintUrl === mintUrl && r.quoteId === quoteId
      );
    if (quote.state === MintQuoteState.ISSUED) {
      if (made) journal.remove(made.id);
      return { proofs: [], unit: wallet.unit };
    }
    // a quote made before quotes were written down gets its record now
    const record = made ?? {
      ...this.held(newId(), mintUrl, wallet),
      kind: "quote" as const,
      quoteId,
      amount: quote.amount,
    };
    const proofs = await claimPaid(wallet, record, quote, commit, journal);
    return { proofs, unit: wallet.unit };
  }

  /**
   * A new deposit: a mint quote for `sats`, asked in the mint's unit (msat
   * when it offers it), written down before its invoice is returned, so it is
   * claimed whenever it is paid, even if nobody waits for it any more.
   */
  async deposit(
    mintUrl: string,
    sats: number
  ): Promise<{ request: string; quoteId: string; expiresAt?: number }> {
    const url = normalizeMintUrl(mintUrl);
    const wallet = await this.open(url);
    // the wallet opens in msat when the mint offers it, else sat
    const amount = wallet.unit === "msat" ? sats * 1000 : sats;
    const quote = await wallet.createMintQuote(amount);
    const expiresAt = quote.expiry ? quote.expiry * 1000 : undefined;
    this.deps.journal.put({
      ...this.held(newId(), url, wallet),
      kind: "quote",
      quoteId: quote.quote,
      amount,
      expiresAt,
    });
    return { request: quote.request, quoteId: quote.quote, expiresAt };
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
  private async open(mintUrl: string, unit?: string) {
    const wallet = await (this.deps.openWallet ?? openWallet)(mintUrl, unit);
    assertRecoverable(wallet, mintUrl);
    return wallet;
  }
}
