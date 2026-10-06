import { verifyEvent, type Filter, type NostrEvent } from "nostr-tools";
import { Subscription } from "rxjs";
import type { Conversation, Message } from "@/types/chat";
import { KIND_PNS, createPnsDeletionEvent, type PnsKeys } from "@/lib/pns";
import type { AccountRelays } from "@/features/relays/service";
import { decodeMessage, encodeMessage, type Entry } from "./codec";
import {
  KIND_KEYRING,
  createKeyring,
  openKeyring,
  type HistorySigner,
} from "./keyring";
import { HistoryStore } from "./store";
import type { StoredMessage, ThreadSlot } from "./thread";
import { forgetSavedConversations, readSavedConversations } from "./legacy";
import type { EventLog } from "./ports";

const KIND_DELETE = 5;
const FORGET_AFTER_S = 7 * 24 * 60 * 60;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface HistoryDeps {
  owner: string;
  signer: HistorySigner;
  log: EventLog;
  relays: Pick<AccountRelays, "ready" | "fetch" | "live" | "publish">;
  /** Device settings ("Sync chats", "Forget chats after 7 days") and main's old chats. */
  storage: KeyValueStorage;
}

/**
 * loading: opening keyrings, or waiting for the first relay answer.
 * ready: messages can be saved.
 * locked: a keyring exists but the signer will not open it.
 * offline: no keyring here and no relay answered, so none can be made safely.
 * failed: it could not start, most likely this device's storage would not open.
 */
export type HistoryStatus =
  | "loading"
  | "ready"
  | "locked"
  | "offline"
  | "failed";
export type SyncOutcome = "ok" | "failed" | "offline";

export const SYNC_KEY = "chatSyncEnabled";
export const FORGET_KEY = "auto_delete_conversations";

export const flag = (
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: boolean
) => {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    return typeof value === "boolean" ? value : fallback;
  } catch {
    return fallback;
  }
};

interface Keyring {
  event: NostrEvent;
  keys?: PnsKeys;
}

/**
 * One account's chats: kept on this device, encrypted with the account's
 * history key, and synced through its relays in main's formats.
 */
export class HistoryService {
  readonly owner: string;
  private store = new HistoryStore(() => this.notify());
  private status: HistoryStatus = "loading";
  private listeners = new Set<() => void>();
  private keyrings = new Map<string, Keyring>();
  private opening = new Set<string>();
  private followed = new Map<string, PnsKeys>();
  private authorOf = new Map<string, string>();
  private deleted = new Set<string>();
  private relayCheck: "pending" | "answered" | "unanswered" = "pending";
  private makeFailed = false;
  private making: Promise<void> | undefined;
  private broken = false;
  private liveFor = new Set<string>();
  private live = new Subscription();
  private disposed = false;

  constructor(private deps: HistoryDeps) {
    this.owner = deps.owner;
  }

  start(): void {
    this.boot().catch((error) => {
      // most likely this device's storage would not open: saves must not wait
      console.error("History could not start:", error);
      this.broken = true;
      this.settle();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.live.unsubscribe();
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = (): HistoryStatus => this.status;
  getConversations = (): Conversation[] => this.store.getConversations();
  getThread = (conversationId: string): ThreadSlot[] | undefined =>
    this.store.getThread(conversationId);

  /** The branch on screen, root first. */
  branch(conversationId: string): StoredMessage[] {
    return (
      this.store.getThread(conversationId)?.map((slot) => slot.displayed) ?? []
    );
  }

  selectVersion(conversationId: string, depth: number, key: string): void {
    this.store.selectVersion(conversationId, depth, key);
  }

  /** The oldest keyring's keys: every device of the account writes with the same one. */
  writingKeys(): PnsKeys | undefined {
    let oldest: Keyring | undefined;
    for (const keyring of this.keyrings.values()) {
      if (keyring.keys && (!oldest || older(keyring.event, oldest.event))) {
        oldest = keyring;
      }
    }
    return oldest?.keys;
  }

  /**
   * Resolves only once the message is on this device's disk, so a caller can
   * pay after it. It becomes the version shown at its place. Relays get it
   * afterwards; one that missed it gets it on the next sync.
   */
  async save(
    conversationId: string,
    message: Message & { _prevId: string }
  ): Promise<StoredMessage> {
    const keys = await this.whenWritable();
    const event = encodeMessage(
      conversationId,
      message,
      this.owner,
      nowSeconds(),
      keys
    );
    await this.deps.log.put([event]);
    // what is in memory is what was written
    const entry = decodeMessage(event, keys)!;
    this.authorOf.set(event.id, event.pubkey);
    this.store.ingest([entry]);
    this.store.show(conversationId, event.id);
    this.publish(event);
    return { ...entry.message, _prevId: message._prevId };
  }

  /** Gone here at once; the deletion is kept and sent to relays. */
  async remove(conversationId: string): Promise<void> {
    this.assertLive();
    const byAuthor = new Map<string, string[]>();
    for (const id of this.store.eventIds(conversationId)) {
      const author = this.authorOf.get(id);
      if (author) byAuthor.set(author, [...(byAuthor.get(author) ?? []), id]);
    }
    const deletions = [...byAuthor].map(([author, ids]) =>
      createPnsDeletionEvent(
        ids,
        this.followed.get(author)!,
        "Conversation deleted"
      )
    );
    // the deletion first: a crash between the two still removes the chat on the next start
    await this.deps.log.put(deletions);
    this.apply(deletions);
    deletions.forEach((deletion) => this.publish(deletion));
  }

  /** Usage's "Delete all chats": gone from this device only. Relays keep
   *  their copies, and the next sync brings them back. */
  async forgetHere(): Promise<void> {
    this.assertLive();
    const ids = this.store
      .getConversations()
      .flatMap((conversation) => this.store.eventIds(conversation.id));
    await this.deps.log.remove(ids);
    ids.forEach((id) => this.authorOf.delete(id));
    this.store.remove(ids);
  }

  /** A manual sync: resolves with how this run ended, not another's. */
  async sync(): Promise<SyncOutcome> {
    this.assertLive();
    return this.syncOnce();
  }

  private async boot(): Promise<void> {
    const local = await this.deps.log.query(this.keyringFilter());
    await Promise.all(local.map((event) => this.addKeyring(event, false)));
    this.settle();
    this.live.add(
      this.deps.relays.live(this.keyringFilter()).subscribe((event) => {
        this.addKeyring(event, true).catch((error) => {
          console.warn("Could not keep a history key on this device:", error);
        });
      })
    );
    await this.deps.relays.ready();
    await this.syncOnce();
    // a switch during the first sync: the next account starts its own
    if (this.disposed) return;
    await this.importSaved();
    await this.forgetOld();
  }

  // main's chats from before sync, kept by the first account that opens here
  private async importSaved(): Promise<void> {
    const saved = readSavedConversations(this.deps.storage, nowSeconds());
    const keys = this.writingKeys();
    if (!saved || !keys) return;
    const events = saved.map(({ conversationId, message, createdAt }) =>
      encodeMessage(conversationId, message, this.owner, createdAt, keys)
    );
    await this.deps.log.put(events);
    forgetSavedConversations(this.deps.storage);
    this.apply(events, keys);
    events.forEach((event) => this.publish(event));
  }

  private async syncOnce(): Promise<SyncOutcome> {
    if (this.disposed) return "failed";
    // a keyring the signer refused before is asked again
    await Promise.all(
      [...this.keyrings.values()]
        .filter((keyring) => !keyring.keys)
        .map((keyring) => this.openOne(keyring.event))
    );
    const found = await this.deps.relays.fetch(this.keyringFilter(), () =>
      this.deps.log.query(this.keyringFilter())
    );
    await Promise.all(
      found.events.map((event) => this.addKeyring(event, true))
    );
    if (this.relayCheck !== "answered") {
      this.relayCheck = found.answered.length > 0 ? "answered" : "unanswered";
    }
    if (this.keyrings.size === 0 && this.relayCheck === "answered") {
      // one at a time: a "Sync now" during the signer's prompt must not ask again
      this.making ??= this.makeKeyring().finally(
        () => (this.making = undefined)
      );
      await this.making;
    }
    this.settle();
    if (found.answered.length === 0) return "offline";
    if (!this.syncOn()) return "ok";
    const pulled = await Promise.all(
      [...this.followed].map(([author, keys]) => this.pull(author, keys))
    );
    return pulled.every(Boolean) ? "ok" : "failed";
  }

  /** Every relay's copy of one key's history, and ours to relays missing it. */
  private async pull(author: string, keys: PnsKeys): Promise<boolean> {
    if (!this.liveFor.has(author)) {
      this.liveFor.add(author);
      this.live.add(
        this.deps.relays
          .live(this.historyFilter(author))
          .subscribe((event) => this.receive([event], keys))
      );
    }
    const { events, answered } = await this.deps.relays.fetch(
      this.historyFilter(author),
      () => this.deps.log.query(this.historyFilter(author))
    );
    this.receive(events, keys);
    return answered.length > 0;
  }

  private async addKeyring(
    event: NostrEvent,
    fromRelay: boolean
  ): Promise<void> {
    if (this.keyrings.has(event.id) || event.pubkey !== this.owner) return;
    if (fromRelay && !verifyEvent(event)) return;
    this.keyrings.set(event.id, { event });
    if (fromRelay) await this.deps.log.put([event]);
    await this.openOne(event);
    this.settle();
  }

  // One decrypt per keyring at a time: "Sync now" during a slow signer's
  // prompt must not ask again.
  private async openOne(event: NostrEvent): Promise<void> {
    if (this.opening.has(event.id)) return;
    this.opening.add(event.id);
    this.settle();
    const keys = await openKeyring(event, this.owner, this.deps.signer);
    this.opening.delete(event.id);
    if (this.disposed) return;
    if (keys) {
      this.keyrings.set(event.id, { event, keys });
      // ready only once this device's copy of its history is in
      await this.follow(keys);
    }
    this.settle();
  }

  // Only once a relay has said this account has none: a second keyring
  // would split the account's history between devices.
  private async makeKeyring(): Promise<void> {
    // a switched-away account's signer is never asked
    if (this.disposed) return;
    let made: Awaited<ReturnType<typeof createKeyring>>;
    try {
      made = await createKeyring(this.owner, this.deps.signer, nowSeconds());
    } catch {
      // the signer cannot encrypt, or said no: asked again on the next sync
      this.makeFailed = true;
      return;
    }
    if (this.keyrings.size > 0) return;
    await this.deps.log.put([made.event]);
    this.keyrings.set(made.event.id, made);
    this.deps.relays.publish(made.event).catch(() => {
      // the next sync sends it to every relay that does not have it
    });
    await this.follow(made.keys);
  }

  private async follow(keys: PnsKeys): Promise<void> {
    const author = keys.pnsKeypair.pubKey;
    if (this.followed.has(author)) return;
    this.followed.set(author, keys);
    this.apply(await this.deps.log.query(this.historyFilter(author)), keys);
    // the first sync pulls every key it knows by then
    if (this.relayCheck === "pending" || !this.syncOn() || this.disposed)
      return;
    this.pull(author, keys).catch((error) => {
      console.warn("Could not sync this part of history:", error);
    });
  }

  /** Events from relays: checked, kept on disk, then shown. */
  private receive(events: NostrEvent[], keys: PnsKeys): void {
    const fresh = events.filter(
      (event) =>
        !this.authorOf.has(event.id) &&
        !this.deleted.has(event.id) &&
        event.pubkey === keys.pnsKeypair.pubKey &&
        verifyEvent(event)
    );
    if (fresh.length === 0) return;
    this.deps.log.put(fresh).catch((error) => {
      console.warn("Could not keep synced history on this device:", error);
    });
    this.apply(fresh, keys);
  }

  private apply(events: NostrEvent[], keys?: PnsKeys): void {
    const gone: string[] = [];
    for (const event of events) {
      this.authorOf.set(event.id, event.pubkey);
      if (event.kind !== KIND_DELETE) continue;
      for (const tag of event.tags) {
        if (tag[0] === "e" && tag[1] && !this.deleted.has(tag[1])) {
          this.deleted.add(tag[1]);
          gone.push(tag[1]);
        }
      }
    }
    if (gone.length > 0) {
      this.store.remove(gone);
      this.deps.log.remove(gone).catch((error) => {
        console.warn("Could not drop deleted history from this device:", error);
      });
    }
    if (!keys) return;
    const entries = events
      .filter((event) => event.kind === KIND_PNS && !this.deleted.has(event.id))
      .map((event) => decodeMessage(event, keys))
      .filter((entry): entry is Entry => entry !== null);
    this.store.ingest(entries);
  }

  // main's "Forget chats after 7 days": run once, after the first sync
  private async forgetOld(): Promise<void> {
    if (!flag(this.deps.storage, FORGET_KEY, false)) return;
    const cutoff = nowSeconds() - FORGET_AFTER_S;
    for (const conversation of this.store.getConversations()) {
      const last = conversation.messages.at(-1)?._createdAt ?? 0;
      if (last && last < cutoff) await this.remove(conversation.id);
    }
  }

  private async whenWritable(): Promise<PnsKeys> {
    for (;;) {
      this.assertLive();
      const keys = this.writingKeys();
      if (keys) return keys;
      if (this.status === "locked") {
        throw new Error("History is locked: the signer did not open it");
      }
      if (this.status === "offline") {
        throw new Error("History cannot start until a relay answers");
      }
      if (this.status === "failed") {
        throw new Error("History could not open this device's storage");
      }
      await new Promise<void>((resolve) => {
        const off = this.subscribe(() => {
          off();
          resolve();
        });
      });
    }
  }

  private publish(event: NostrEvent): void {
    if (!this.syncOn()) return;
    this.deps.relays.publish(event).catch(() => {
      // the next sync sends it to every relay that does not have it
    });
  }

  private settle(): void {
    const next: HistoryStatus = this.broken
      ? "failed"
      : this.writingKeys()
        ? "ready"
        : this.opening.size > 0 || this.relayCheck === "pending"
          ? "loading"
          : this.keyrings.size > 0 || this.makeFailed
            ? "locked"
            : this.relayCheck === "unanswered"
              ? "offline"
              : "loading";
    if (next === this.status) return;
    this.status = next;
    this.notify();
  }

  private syncOn(): boolean {
    return flag(this.deps.storage, SYNC_KEY, true);
  }

  private keyringFilter(): Filter {
    return { kinds: [KIND_KEYRING], authors: [this.owner] };
  }

  private historyFilter(author: string): Filter {
    return { kinds: [KIND_PNS, KIND_DELETE], authors: [author] };
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("This account is no longer active");
  }

  private notify = (): void => {
    this.listeners.forEach((listener) => listener());
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const older = (a: NostrEvent, b: NostrEvent) =>
  a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id);
