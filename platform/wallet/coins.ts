import type { Proof } from "@cashu/cashu-ts";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Coin } from "@/features/wallet/ports";

interface Schema extends DBSchema {
  coins: { key: string; value: Coin; indexes: { owner: string } };
  // every secret this device has held, and whose it was
  held: { key: string; value: { secret: string; owner: string } };
}

const NAME = "routstr-wallet";
const CHANGED = "changed";
const bare = ({ id, amount, secret, C }: Proof) => ({ id, amount, secret, C });

/**
 * Every account's coins on this device, in IndexedDB. A change is one durable
 * transaction, matched by secret so the wallet book can repeat it after a
 * crash, and every tab hears of it and reads again: no tab works from a stale
 * copy. A secret this device ever held stays known, so a spent coin never
 * comes back from an old store and a coin never moves to another account.
 */
export class IndexedCoins {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: Promise<IDBPDatabase<Schema>>,
    /** a coin's unit, from its mint's keyset */
    private readonly unitOf: (
      mintUrl: string,
      keysetId: string
    ) => Promise<string>,
    private readonly channel?: BroadcastChannel
  ) {
    channel?.addEventListener("message", () => this.emit());
  }

  static open(
    unitOf: (mintUrl: string, keysetId: string) => Promise<string>
  ): IndexedCoins {
    const db = openDB<Schema>(NAME, 1, {
      upgrade(db) {
        db.createObjectStore("coins", { keyPath: "secret" }).createIndex(
          "owner",
          "owner"
        );
        db.createObjectStore("held", { keyPath: "secret" });
      },
    });
    const channel =
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel(NAME);
    return new IndexedCoins(db, unitOf, channel);
  }

  /** Stores `add` and drops `remove` for this owner at this mint, all or
   *  nothing, and resolves once it is on disk. Throws when it cannot (the
   *  book's record then keeps the coins), and for a coin another account holds. */
  async change(
    owner: string,
    mintUrl: string,
    add: Proof[],
    remove: Proof[]
  ): Promise<void> {
    // before the transaction: it closes at the first wait that is not its own
    const units = await Promise.all(add.map((p) => this.unitOf(mintUrl, p.id)));
    const tx = (await this.db).transaction(["coins", "held"], "readwrite", {
      durability: "strict",
    });
    const coins = tx.objectStore("coins");
    const held = tx.objectStore("held");
    const holders = await Promise.all(add.map((p) => held.get(p.secret)));
    if (holders.some((h) => h && h.owner !== owner)) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error("A coin here belongs to another account on this device.");
    }
    await Promise.all([
      ...remove.map((p) => coins.delete(p.secret)),
      ...add.flatMap((p, i) => [
        coins.put({ ...bare(p), owner, mintUrl, unit: units[i] }),
        held.put({ secret: p.secret, owner }),
      ]),
      tx.done,
    ]);
    // other tabs first: a listener here that throws must not keep them stale
    this.channel?.postMessage(CHANGED);
    this.emit();
  }

  /** This owner's coins, at one mint or at all of them. */
  async coins(owner: string, mintUrl?: string): Promise<Coin[]> {
    const all = await (await this.db).getAllFromIndex("coins", "owner", owner);
    return mintUrl ? all.filter((c) => c.mintUrl === mintUrl) : all;
  }

  /** The secrets among these that this device has ever held, for any owner. */
  async known(secrets: string[]): Promise<Set<string>> {
    const tx = (await this.db).transaction("held");
    const found = await Promise.all(secrets.map((s) => tx.store.get(s)));
    return new Set(secrets.filter((_, i) => found[i]));
  }

  /** Runs after every change, in this tab or another. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
