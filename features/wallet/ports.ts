import type { Proof } from "@cashu/cashu-ts";

/** A coin as the wallet keeps it: the proof, whose it is, at which mint, and
 *  the unit of its keyset. */
export interface Coin extends Proof {
  owner: string;
  mintUrl: string;
  unit: string;
}

/** Where an account's coins live. */
export interface CoinStore {
  /** Stores `add` and drops `remove` (matched by secret) for this owner at this
   *  mint. Throws when it cannot store for that owner yet; the wallet book then
   *  keeps the coins in its record until it can. */
  change(
    owner: string,
    mintUrl: string,
    add: Proof[],
    remove: Proof[]
  ): Promise<void>;
  /** This owner's coins, at one mint or at all of them. */
  coins(owner: string, mintUrl?: string): Promise<Coin[]>;
  /** The mint this owner pays from by default. */
  activeMint(owner: string): string;
}
