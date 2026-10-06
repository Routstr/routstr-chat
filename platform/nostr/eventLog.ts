import type { IDBPObjectStore } from "idb";
import {
  getEventTags,
  getEventsForFilter,
  openDB,
  type NostrIDB,
  type Schema,
} from "nostr-idb";
import { readLegacyEvents } from "@/lib/eventDatabase/legacyMigration";
import { getEventReplaceableKey } from "@/lib/eventDatabase/replaceables";
import type { EventLog } from "@/features/history/ports";

/** Where main keeps every Nostr event it has seen, one row per event. */
const DB_NAME = "routstr-event-store";
const MIGRATED_KEY = "routstr:eventdb:migrated:v1";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** The history event log over main's IndexedDB. Rows are keyed by event id,
 *  which is main's key for the regular kinds history writes. */
export function openEventLog(storage: KeyValueStorage): EventLog {
  let db: Promise<NostrIDB> | undefined;
  // opened on first use; a failure rejects every call instead of losing writes
  const ready = () => (db ??= open(storage));
  const write = async (apply: (store: Store) => void) => {
    const tx = (await ready()).transaction("events", "readwrite", {
      durability: "strict",
    });
    apply(tx.store);
    await tx.done;
  };
  return {
    query: async (filter) => getEventsForFilter(await ready(), filter),
    put: (events) =>
      write((store) => {
        for (const event of events) {
          store.put({ event, tags: getEventTags(event) }, event.id);
        }
      }),
    remove: (ids) => write((store) => ids.forEach((id) => store.delete(id))),
  };
}

type Store = IDBPObjectStore<Schema, ["events"], "events", "readwrite">;

// Before July 2026 main kept everything in one JSON blob in another database.
// Copied once, as main does, for people who have not opened it since.
async function open(storage: KeyValueStorage): Promise<NostrIDB> {
  const db = await openDB(DB_NAME);
  if (storage.getItem(MIGRATED_KEY) !== "1") {
    try {
      const legacy = await readLegacyEvents();
      const tx = db.transaction("events", "readwrite");
      for (const event of legacy) {
        const uid = getEventReplaceableKey(event) ?? event.id;
        tx.store.put({ event, tags: getEventTags(event) }, uid);
      }
      await tx.done;
      storage.setItem(MIGRATED_KEY, "1");
    } catch (error) {
      // tried again on the next load
      console.warn("Could not copy the old event store yet:", error);
    }
  }
  return db;
}
