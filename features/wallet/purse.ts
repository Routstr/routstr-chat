import {
  getTokenMetadata,
  type MeltQuoteBolt11Response,
  type Proof,
} from "@cashu/cashu-ts";
import { WalletExecutor } from "@/features/book/executor";
import type { Journal } from "@/features/book/journal";
import type { MeltOutcome } from "@/features/book/settle";
import type { ActivityLog, Coin, CoinStore } from "./ports";

/** One account's money, for that account and no other, in whole sats. The one
 *  door chat and keys use: callers never touch coins. */
export interface Purse {
  /** Spendable sats per mint url. */
  balances(): Promise<Record<string, number>>;
  activeMint(): string;
  /** A fresh token worth `sats` from this account's coins at the mint. It stays
   *  this account's until `handoff` (the SDK storing it) resolves; without one
   *  it stays listed in the wallet until taken back or dismissed, so the money
   *  never lives only in the returned string. */
  send(
    mintUrl: string,
    sats: number,
    handoff?: (token: string) => Promise<void>
  ): Promise<string>;
  /** Pays a Lightning invoice's melt quote from this account's coins at the
   *  mint. "pending" means the mint has not settled it yet: the coins stay out
   *  of the wallet and the book settles it later. */
  pay(mintUrl: string, quote: MeltQuoteBolt11Response): Promise<MeltOutcome>;
  /** Claims a paid deposit (a mint quote made for this account) into this
   *  account's wallet; resolves with the sats it gave, 0 when it was claimed
   *  already (here or elsewhere). Throws while the invoice is unpaid. */
  claim(mintUrl: string, quoteId: string): Promise<number>;
  /** Takes a token into this account's wallet. It is written down before its
   *  mint is asked: resolves once the wallet owns it, with the sats it gave,
   *  or `pending` (the token's sats) when the mint could not be reached; the
   *  wallet tries it again (retryPending). Throws only when nothing was kept
   *  (the mint refused it): the caller keeps its own record then. */
  take(token: string): Promise<{ sats: number; pending: boolean }>;
  /** As take, the sats alone. */
  receive(token: string): Promise<number>;
  /** What a token says, without its mint: for a preview before receiving. */
  peek(token: string): { mint: string; sats: number };
  /** Tries again the tokens still waiting for their mint; resolves with the
   *  sats that landed. */
  retryPending(): Promise<number>;
  /** Runs when this account's coins may have changed: read balances again. */
  subscribe(listener: () => void): () => void;
}

export interface PurseDeps {
  coins: CoinStore;
  activity: ActivityLog;
  journal: Journal;
  locks?: LockManager;
}

const total = (proofs: Pick<Proof, "amount">[]) =>
  proofs.reduce((sum, p) => sum + p.amount, 0);

/** Whole sats: an msat amount is rounded down, never up, and a unit that is
 *  not bitcoin (usd, eur) is worth none. */
export const toSats = (amount: number, unit: string) =>
  unit === "sat" ? amount : unit === "msat" ? Math.floor(amount / 1000) : 0;

/** Spendable sats per mint: each unit's coins added up first, then rounded. */
export function balancesOf(coins: Coin[]): Record<string, number> {
  const byMint = new Map<string, Map<string, number>>();
  for (const coin of coins) {
    const units = byMint.get(coin.mintUrl) ?? new Map<string, number>();
    units.set(coin.unit, (units.get(coin.unit) ?? 0) + coin.amount);
    byMint.set(coin.mintUrl, units);
  }
  return Object.fromEntries(
    [...byMint].map(([mintUrl, units]) => [
      mintUrl,
      [...units].reduce((sum, [unit, amount]) => sum + toSats(amount, unit), 0),
    ])
  );
}

/** What a token says, without asking its mint: for a preview before receiving. */
export function peek(token: string): { mint: string; sats: number } {
  const { mint, amount, unit } = getTokenMetadata(token);
  return { mint, sats: toSats(amount, unit) };
}

/** The purse of `owner`: every move goes through the wallet book. */
export function createPurse(
  owner: string,
  { coins, activity, journal, locks }: PurseDeps
): Purse {
  // the money moved either way: a log that cannot write never turns that into a failure
  const note = (entry: { direction: "in" | "out"; sats: number }) => {
    try {
      activity.record(owner, entry);
    } catch (error) {
      console.error("Could not write the activity:", error);
    }
  };
  const executor = new WalletExecutor({
    owner,
    journal,
    locks,
    commitFor: (mintUrl) => (add, remove) =>
      coins.change(owner, mintUrl, add, remove),
  });
  const purse: Purse = {
    balances: async () => balancesOf(await coins.coins(owner)),
    activeMint: () => coins.activeMint(owner),
    send: async (mintUrl, sats, handoff) => {
      const token = await executor.send(
        mintUrl,
        sats,
        () => coins.coins(owner, mintUrl),
        { handoff, track: !handoff }
      );
      note({ direction: "out", sats });
      return token;
    },
    pay: async (mintUrl, quote) =>
      (await executor.pay(mintUrl, quote, () => coins.coins(owner, mintUrl)))
        .state,
    claim: async (mintUrl, quoteId) => {
      const { proofs, unit } = await executor.claim(mintUrl, quoteId);
      const sats = toSats(total(proofs), unit);
      if (sats) note({ direction: "in", sats });
      return sats;
    },
    take: async (token) => {
      const { proofs, unit, pending } = await executor.take(token);
      // waiting for its mint, or taken in by a retry that noted it
      if (pending || !proofs.length) return { sats: peek(token).sats, pending };
      const sats = toSats(total(proofs), unit);
      note({ direction: "in", sats });
      // its mint answers: tokens still waiting are tried again
      void purse
        .retryPending()
        .catch((error) =>
          console.error("Could not try the waiting tokens:", error)
        );
      return { sats, pending };
    },
    receive: async (token) => (await purse.take(token)).sats,
    peek,
    retryPending: async () => {
      let sats = 0;
      for (const got of await executor.retryReceives()) {
        const landed = toSats(total(got.proofs), got.unit);
        note({ direction: "in", sats: landed });
        sats += landed;
      }
      return sats;
    },
    subscribe: (listener) => coins.subscribe(owner, listener),
  };
  return purse;
}
