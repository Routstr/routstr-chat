import type { Conversation } from "@/types/chat";
import type { Entry, Stored } from "./codec";
import { buildThread, byTime, titleOf, type ThreadSlot } from "./thread";

interface Record {
  byId: Map<string, Stored>;
  selected: Map<number, string>;
  conversation?: Conversation;
  slots?: ThreadSlot[];
}

/**
 * One account's conversations in memory, built from its decrypted events.
 * Snapshots keep their reference until their own data changes, so they are
 * safe for useSyncExternalStore and a change in one chat re-renders no other.
 */
export class HistoryStore {
  private records = new Map<string, Record>();
  private conversationOf = new Map<string, string>();
  private list: Conversation[] | undefined;

  constructor(private onChange: () => void) {}

  /** Events arrive in bursts and in any order: one change per burst. */
  ingest(entries: Entry[]): void {
    for (const { conversationId, message } of entries) {
      let record = this.records.get(conversationId);
      if (!record) {
        record = { byId: new Map(), selected: new Map() };
        this.records.set(conversationId, record);
      }
      record.byId.set(message._eventId, message);
      this.conversationOf.set(message._eventId, conversationId);
      this.changed(record);
    }
    if (entries.length > 0) this.onChange();
  }

  /** Drops events (a delete from this or another device). */
  remove(eventIds: string[]): void {
    let removed = false;
    for (const id of eventIds) {
      const conversationId = this.conversationOf.get(id);
      const record = conversationId && this.records.get(conversationId);
      if (!record) continue;
      record.byId.delete(id);
      this.conversationOf.delete(id);
      if (record.byId.size === 0) this.records.delete(conversationId);
      else this.changed(record);
      removed = true;
    }
    if (removed) {
      this.list = undefined;
      this.onChange();
    }
  }

  /** The ids of every event of one conversation, for a delete. */
  eventIds(conversationId: string): string[] {
    return [...(this.records.get(conversationId)?.byId.keys() ?? [])];
  }

  selectVersion(conversationId: string, depth: number, key: string): void {
    const record = this.records.get(conversationId);
    if (!record || record.selected.get(depth) === key) return;
    record.selected = new Map(record.selected).set(depth, key);
    record.slots = undefined;
    this.onChange();
  }

  /** Shows a message just written here, even where an older version was picked. */
  show(conversationId: string, eventId: string): void {
    const depth = this.getThread(conversationId)?.findIndex((slot) =>
      slot.keys.includes(eventId)
    );
    if (depth !== undefined && depth !== -1) {
      this.selectVersion(conversationId, depth, eventId);
    }
  }

  /** Every conversation, newest first. */
  getConversations = (): Conversation[] => {
    this.list ??= [...this.records]
      .map(([id, record]) => ({ id, record, updatedAt: latest(record) }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, record }) => this.conversation(id, record));
    return this.list;
  };

  getThread = (conversationId: string): ThreadSlot[] | undefined => {
    const record = this.records.get(conversationId);
    if (!record) return undefined;
    record.slots ??= buildThread([...record.byId.values()], record.selected);
    return record.slots;
  };

  private conversation(id: string, record: Record): Conversation {
    if (!record.conversation) {
      const messages = byTime(
        [...record.byId.values()].filter((m) => m.role !== "system")
      );
      record.conversation = { id, title: titleOf(messages[0]), messages };
    }
    return record.conversation;
  }

  private changed(record: Record): void {
    record.conversation = undefined;
    record.slots = undefined;
    this.list = undefined;
  }
}

const latest = (record: Record): number => {
  let max = 0;
  for (const m of record.byId.values()) max = Math.max(max, m._createdAt);
  return max;
};
