import { Mint, Wallet, type Proof } from "@cashu/cashu-ts";
import { verifyEvent, type NostrEvent } from "nostr-tools";
import { walletLock } from "@/features/book/executor";
import { normalizeMintUrl } from "@/features/book/mint";
import type { ReplicaStore, WalletRelays, WalletSigner } from "./ports";

// NIP-60 token events, and NIP-09 deletions of them
const TOKEN = 7375;
const DELETE = 5;
// a mint that has not answered by then is asked again on the next pull
const CHECK_MS = 10_000;
// coins per event: an event stays well under relays' size caps and NIP-44's
const PER_EVENT = 100;

const bare = ({ id, amount, secret, C }: Proof) => ({ id, amount, secret, C });
const now = () => Math.floor(Date.now() / 1000);

/** What the mint says of these coins (NUT-07): unspent and spent; any
 *  other (pending) is in neither. */
export type CoinStates = (
  mintUrl: string,
  coins: Proof[]
) => Promise<{ unspent: Proof[]; spent: Proof[] }>;

export const statesAt: CoinStates = (mintUrl, coins) =>
  new Wallet(new Mint(mintUrl)).groupProofsByState(coins);

/** One copy goes out at a time per account, in every tab. */
export const copyLock = (owner: string) => `routstr-chat-wallet-copy:${owner}`;

interface Listed {
  id: string;
  mintUrl: string;
  proofs: Proof[];
}

/**
 * One account's coins on relays (NIP-60), kept in step with this device's
 * store both ways. `push` publishes each mint the outbox names: one token
 * event per unit listing all its coins, then a deletion of the events before
 * it; a mint whose publish fails stays in the outbox. `pull` reads the
 * account's events: coins this device never held come in if the mint says
 * unspent, and coins whose event another device replaced without them go if
 * the mint says spent. A coin this device ever held never comes back.
 */
export class Replica {
  constructor(
    readonly owner: string,
    private readonly deps: {
      store: ReplicaStore;
      signer: WalletSigner;
      relays: WalletRelays;
      locks: LockManager;
      states?: CoinStates;
      wait?: number;
    }
  ) {}

  // token events read before: an event never changes, so it is read once
  private readonly read = new Map<
    string,
    { listed: Listed | null; del: string[] }
  >();

  /** Resolves true once nothing is left in the outbox. */
  async push(): Promise<boolean> {
    const { store, locks } = this.deps;
    return locks.request(copyLock(this.owner), async () => {
      let done = true;
      for (const { mintUrl, version } of await store.outbox(this.owner)) {
        await this.pushMint(mintUrl, version).catch((error) => {
          done = false;
          console.error(`Could not publish ${mintUrl}'s coins yet:`, error);
        });
      }
      return done;
    });
  }

  private async pushMint(mintUrl: string, version: number): Promise<void> {
    const { store, signer, relays } = this.deps;
    const coins = await store.coins(this.owner, mintUrl);
    const replaced = await store.events(this.owner, mintUrl);
    const units = new Map<string, Proof[]>();
    coins.forEach((c) => units.set(c.unit, [...(units.get(c.unit) ?? []), c]));
    const chunks = [...units].flatMap(([unit, all]) =>
      Array.from({ length: Math.ceil(all.length / PER_EVENT) }, (_, i) => ({
        unit,
        proofs: all.slice(i * PER_EVENT, (i + 1) * PER_EVENT),
      }))
    );
    const listed = new Map<string, string>();
    for (const { unit, proofs } of chunks) {
      const content = JSON.stringify({
        mint: mintUrl,
        ...(unit === "sat" ? {} : { unit }),
        proofs: proofs.map(bare),
        del: replaced,
      });
      const event = await signer.sign({
        kind: TOKEN,
        content: await signer.encrypt(content),
        tags: [],
        created_at: now(),
      });
      // rejects when no relay took it: then it is on none, and a retry signs anew
      await relays.publish(event);
      // a later failure in this push leaves it listed for the retry to delete
      await store.publishing(this.owner, mintUrl, event.id);
      proofs.forEach((p) => listed.set(p.secret, event.id));
    }
    if (replaced.length) {
      await relays.publish(
        await signer.sign({
          kind: DELETE,
          content: "",
          tags: [...replaced.map((id) => ["e", id]), ["k", String(TOKEN)]],
          created_at: now(),
        })
      );
    }
    await store.published(this.owner, mintUrl, { version, replaced, listed });
  }

  async pull(): Promise<void> {
    const { store, signer, relays } = this.deps;
    const [tokens, deletions] = await Promise.all([
      relays.fetch({ kinds: [TOKEN], authors: [this.owner] }),
      relays.fetch({ kinds: [DELETE], authors: [this.owner] }),
    ]);
    // no relay answered: nothing to go by
    if (!tokens.answered.length) return;
    const own = (e: NostrEvent, kind: number) =>
      e.kind === kind && e.pubkey === this.owner && verifyEvent(e);
    const deleted = new Set<string>();
    deletions.events
      .filter((e) => own(e, DELETE))
      .forEach((e) =>
        e.tags.forEach(([name, id]) => name === "e" && id && deleted.add(id))
      );
    const events: Listed[] = [];
    for (const event of tokens.events.filter((e) => own(e, TOKEN))) {
      const read = this.read.get(event.id) ?? (await this.readEvent(event));
      if (!read) continue;
      this.read.set(event.id, read);
      read.del.forEach((id) => deleted.add(id));
      if (read.listed) events.push(read.listed);
    }
    const live = events.filter((e) => !deleted.has(e.id));
    // and the mints where a coin's event is gone
    const mints = new Set(live.map((e) => e.mintUrl));
    (await store.coins(this.owner))
      .filter((c) => c.eventId && deleted.has(c.eventId))
      .forEach((c) => mints.add(c.mintUrl));
    for (const mintUrl of mints) {
      await this.pullMint(
        mintUrl,
        live.filter((e) => e.mintUrl === mintUrl),
        deleted
      ).catch((error) =>
        console.error(`Could not take in ${mintUrl}'s coins yet:`, error)
      );
    }
  }

  private async readEvent(
    event: NostrEvent
  ): Promise<{ listed: Listed | null; del: string[] } | null> {
    try {
      const data = JSON.parse(await this.deps.signer.decrypt(event.content));
      const del = (Array.isArray(data.del) ? data.del : []).filter(
        (id: unknown): id is string => typeof id === "string"
      );
      if (typeof data.mint !== "string" || !Array.isArray(data.proofs)) {
        return { listed: null, del };
      }
      return {
        listed: {
          id: event.id,
          mintUrl: normalizeMintUrl(data.mint),
          proofs: data.proofs.filter((p: Proof) => p?.secret && p.id),
        },
        del,
      };
    } catch (error) {
      // not read now (a signer that said no): asked again next pull
      console.error("Could not read a token event:", error);
      return null;
    }
  }

  private async pullMint(
    mintUrl: string,
    events: Listed[],
    deleted: Set<string>
  ): Promise<void> {
    const { store, locks, states = statesAt, wait = CHECK_MS } = this.deps;
    const listed = new Map<string, string>();
    const proofs = new Map<string, Proof>();
    for (const event of events) {
      for (const p of event.proofs) {
        listed.set(p.secret, event.id);
        proofs.set(p.secret, p);
      }
    }
    await locks.request(walletLock(this.owner), async () => {
      const held = await store.coins(this.owner, mintUrl);
      const known = await store.known([...proofs.keys()]);
      const fresh = [...proofs.values()].filter((p) => !known.has(p.secret));
      // another device replaced their event without them
      const gone = held.filter(
        (c) => c.eventId && deleted.has(c.eventId) && !listed.has(c.secret)
      );
      const heldSecrets = new Set(held.map((c) => c.secret));
      // listed still, by another device, though this one spent them
      const stale = [...proofs.values()].filter(
        (p) => known.has(p.secret) && !heldSecrets.has(p.secret)
      );
      const asked = [...fresh, ...gone, ...stale];
      let unspent = new Set<string>();
      let spent = new Set<string>();
      if (asked.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const answer = await Promise.race([
          states(mintUrl, asked),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${mintUrl} did not answer in time`)),
              wait
            );
          }),
        ]).finally(() => clearTimeout(timer));
        unspent = new Set(answer.unspent.map((p) => p.secret));
        spent = new Set(answer.spent.map((p) => p.secret));
      }
      await store.adopt(this.owner, mintUrl, {
        add: fresh
          .filter((p) => unspent.has(p.secret))
          .map((proof) => ({ proof, eventId: listed.get(proof.secret)! })),
        // only what the mint says is spent: a pending coin may come back
        drop: gone.filter((c) => spent.has(c.secret)),
        listed,
        events: events.map((e) => e.id),
        forget: [...deleted],
        // listed again by this device: still-unspent coins no event lists
        // any more, and events that still list a coin the mint says is
        // spent (not one still on its way, which settles first)
        relist:
          gone.some((c) => unspent.has(c.secret)) ||
          stale.some((p) => spent.has(p.secret)),
      });
    });
  }
}
