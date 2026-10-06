import { getTokenMetadata, type Proof } from "@cashu/cashu-ts";
import { WalletExecutor } from "@/features/book/executor";
import type { Journal } from "@/features/book/journal";
import type { Coin, CoinStore } from "./ports";

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
  /** Takes a token into this account's wallet; resolves with the sats it gave. */
  receive(token: string): Promise<number>;
  /** What a token says, without its mint: for a preview before receiving. */
  peek(token: string): { mint: string; sats: number };
}

export interface PurseDeps {
  coins: CoinStore;
  journal: Journal;
  locks?: LockManager;
}

const total = (proofs: Pick<Proof, "amount">[]) =>
  proofs.reduce((sum, p) => sum + p.amount, 0);

/** Whole sats: an msat amount is rounded down, never up, and a unit that is
 *  not bitcoin (usd, eur) is worth none. */
const toSats = (amount: number, unit: string) =>
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

/** The purse of `owner`: every move goes through the wallet book. */
export function createPurse(
  owner: string,
  { coins, journal, locks }: PurseDeps
): Purse {
  const executor = new WalletExecutor({
    owner,
    journal,
    locks,
    commitFor: (mintUrl) => (add, remove) =>
      coins.change(owner, mintUrl, add, remove),
  });
  return {
    balances: async () => balancesOf(await coins.coins(owner)),
    activeMint: () => coins.activeMint(owner),
    send: (mintUrl, sats, handoff) =>
      executor.send(mintUrl, sats, () => coins.coins(owner, mintUrl), {
        handoff,
        track: !handoff,
      }),
    receive: async (token) =>
      toSats(
        total(await executor.receive(token)),
        getTokenMetadata(token).unit
      ),
    peek: (token) => {
      const { mint, amount, unit } = getTokenMetadata(token);
      return { mint, sats: toSats(amount, unit) };
    },
  };
}
