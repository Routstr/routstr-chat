import type { Proof } from "@cashu/cashu-ts";
import type { UsageTrackingEntry } from "@routstr/sdk/storage";
import type { EventTemplate, Filter, NostrEvent } from "nostr-tools";
import type { Fetched } from "@/features/relays/service";

/** A coin as the wallet keeps it: the proof, whose it is, at which mint, and
 *  the unit of its keyset. */
export interface Coin extends Proof {
  owner: string;
  mintUrl: string;
  unit: string;
  /** the NIP-60 token event (7375) on relays that lists it, once published */
  eventId?: string;
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
  /** Runs when this owner's coins may have changed: by this tab, or when this
   *  tab reads what another tab saved. */
  subscribe(owner: string, listener: () => void): () => void;
}

/** What the relay copy (NIP-60) needs from the coin store. Every change of
 *  coins leaves an outbox entry for its mint in the same transaction; what
 *  comes from relays leaves none. */
export interface ReplicaStore {
  coins(owner: string, mintUrl?: string): Promise<Coin[]>;
  /** The secrets among these that this device has ever held, for any owner. */
  known(secrets: string[]): Promise<Set<string>>;
  /** The mints whose coins changed since their copy was last published, each
   *  with how many changes it has seen. */
  outbox(owner: string): Promise<{ mintUrl: string; version: number }[]>;
  /** This owner's token events at the mint that are on relays, or may be. */
  events(owner: string, mintUrl: string): Promise<string[]>;
  /** An event about to be published: kept, so a retry deletes it too. */
  publishing(owner: string, mintUrl: string, eventId: string): Promise<void>;
  /** The copy is out: `replaced` are gone, the coins listed in `listed` say
   *  so, and the outbox entry clears unless the mint changed meanwhile. */
  published(
    owner: string,
    mintUrl: string,
    done: { version: number; replaced: string[]; listed: Map<string, string> }
  ): Promise<void>;
  /** What relays hold for this mint: `add` comes in with its events, `drop`
   *  goes, held coins take the event that lists them now, and `events` are
   *  this owner's live events there. `relist` asks for the mint to be
   *  published again (coins nobody's event lists any more). */
  adopt(
    owner: string,
    mintUrl: string,
    from: {
      add: { proof: Proof; eventId: string }[];
      drop: Proof[];
      listed: Map<string, string>;
      events: string[];
      /** events relays say are deleted: none of them is listed any more */
      forget: string[];
      relist: boolean;
    }
  ): Promise<void>;
}

/** One account's signer, for its own wallet copy (NIP-44 to itself). */
export interface WalletSigner {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  sign(template: EventTemplate): Promise<NostrEvent>;
}

/** One account's relays (history's `relays.of(owner)`). */
export interface WalletRelays {
  fetch(filter: Filter): Promise<Fetched>;
  /** Resolves with the relays that took it; rejects when none did. */
  publish(event: NostrEvent): Promise<string[]>;
}

/** The SDK's log of what each reply cost (Settings → Usage). */
export interface UsageLog {
  list(): Promise<UsageTrackingEntry[]>;
  clear(): Promise<void>;
}

/** Where an account's activity is written: each send and receive, in sats. */
export interface ActivityLog {
  record(owner: string, entry: { direction: "in" | "out"; sats: number }): void;
}
