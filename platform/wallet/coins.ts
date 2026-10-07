import type { Proof } from "@cashu/cashu-ts";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Coin, ReplicaStore } from "@/features/wallet/ports";

interface Schema extends DBSchema {
  coins: { key: string; value: Coin; indexes: { owner: string } };
  // every secret this device has held, and whose it was
  held: { key: string; value: { secret: string; owner: string } };
  // a mint whose coins changed since its relay copy was published
  outbox: {
    key: [string, string];
    value: { owner: string; mintUrl: string; version: number };
    indexes: { owner: string };
  };
  // this device's token events (NIP-60) for each owner and mint
  events: {
    key: string;
    value: { id: string; owner: string; mintUrl: string };
    indexes: { mint: [string, string] };
  };
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
export class IndexedCoins implements ReplicaStore {
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
    const db = openDB<Schema>(NAME, 2, {
      upgrade(db, from) {
        if (from < 1) {
          db.createObjectStore("coins", { keyPath: "secret" }).createIndex(
            "owner",
            "owner"
          );
          db.createObjectStore("held", { keyPath: "secret" });
        }
        if (from < 2) {
          db.createObjectStore("outbox", {
            keyPath: ["owner", "mintUrl"],
          }).createIndex("owner", "owner");
          db.createObjectStore("events", { keyPath: "id" }).createIndex(
            "mint",
            ["owner", "mintUrl"]
          );
        }
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
    await this.write(owner, mintUrl, {
      add: add.map((proof) => ({ proof })),
      drop: remove,
      outbox: true,
    });
  }

  /** One transaction: coins in and out for this owner at this mint, held
   *  coins re-listed, events noted, and the mint's outbox entry. */
  private async write(
    owner: string,
    mintUrl: string,
    {
      add,
      drop,
      listed,
      events,
      forget,
      outbox,
    }: {
      add: { proof: Proof; eventId?: string }[];
      drop: Proof[];
      listed?: Map<string, string>;
      events?: string[];
      forget?: string[];
      outbox: boolean;
    }
  ): Promise<void> {
    // before the transaction: it closes at the first wait that is not its own
    const units = await Promise.all(
      add.map(({ proof }) => this.unitOf(mintUrl, proof.id))
    );
    const tx = (await this.db).transaction(
      ["coins", "held", "outbox", "events"],
      "readwrite",
      { durability: "strict" }
    );
    const coins = tx.objectStore("coins");
    const held = tx.objectStore("held");
    const holders = await Promise.all(
      add.map(({ proof }) => held.get(proof.secret))
    );
    if (holders.some((h) => h && h.owner !== owner)) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error("A coin here belongs to another account on this device.");
    }
    const relisted = listed
      ? (await coins.index("owner").getAll(owner)).filter(
          (c) =>
            c.mintUrl === mintUrl &&
            listed.has(c.secret) &&
            listed.get(c.secret) !== c.eventId
        )
      : [];
    const entry = outbox
      ? await tx.objectStore("outbox").get([owner, mintUrl])
      : undefined;
    await Promise.all([
      ...drop.map((p) => coins.delete(p.secret)),
      ...add.flatMap(({ proof, eventId }, i) => [
        coins.put({ ...bare(proof), owner, mintUrl, unit: units[i], eventId }),
        held.put({ secret: proof.secret, owner }),
      ]),
      ...relisted.map((c) =>
        coins.put({ ...c, eventId: listed!.get(c.secret) })
      ),
      ...(events ?? []).map((id) =>
        tx.objectStore("events").put({ id, owner, mintUrl })
      ),
      // only this owner's: an id is a hash, so another's never matches
      ...(forget ?? []).map((id) => tx.objectStore("events").delete(id)),
      ...(outbox
        ? [
            tx.objectStore("outbox").put({
              owner,
              mintUrl,
              version: (entry?.version ?? 0) + 1,
            }),
          ]
        : []),
      tx.done,
    ]);
    // other tabs first: a listener here that throws must not keep them stale
    this.channel?.postMessage(CHANGED);
    this.emit();
  }

  async outbox(owner: string): Promise<{ mintUrl: string; version: number }[]> {
    return (
      await (await this.db).getAllFromIndex("outbox", "owner", owner)
    ).map(({ mintUrl, version }) => ({ mintUrl, version }));
  }

  async events(owner: string, mintUrl: string): Promise<string[]> {
    return (
      await (await this.db).getAllFromIndex("events", "mint", [owner, mintUrl])
    ).map((e) => e.id);
  }

  async publishing(
    owner: string,
    mintUrl: string,
    eventId: string
  ): Promise<void> {
    await (await this.db).put("events", { id: eventId, owner, mintUrl });
  }

  async published(
    owner: string,
    mintUrl: string,
    {
      version,
      replaced,
      listed,
    }: { version: number; replaced: string[]; listed: Map<string, string> }
  ): Promise<void> {
    const tx = (await this.db).transaction(
      ["coins", "outbox", "events"],
      "readwrite",
      { durability: "strict" }
    );
    const coins = tx.objectStore("coins");
    const outbox = tx.objectStore("outbox");
    const mine = (await coins.index("owner").getAll(owner)).filter(
      (c) => c.mintUrl === mintUrl && listed.has(c.secret)
    );
    const entry = await outbox.get([owner, mintUrl]);
    await Promise.all([
      ...replaced.map((id) => tx.objectStore("events").delete(id)),
      ...mine.map((c) => coins.put({ ...c, eventId: listed.get(c.secret) })),
      // changed again while this one went out: it goes out again
      ...(entry?.version === version ? [outbox.delete([owner, mintUrl])] : []),
      tx.done,
    ]);
  }

  async adopt(
    owner: string,
    mintUrl: string,
    from: {
      add: { proof: Proof; eventId: string }[];
      drop: Proof[];
      listed: Map<string, string>;
      events: string[];
      forget: string[];
      relist: boolean;
    }
  ): Promise<void> {
    await this.write(owner, mintUrl, { ...from, outbox: from.relist });
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
