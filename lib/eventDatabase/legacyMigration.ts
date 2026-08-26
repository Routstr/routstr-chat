import type { NostrEvent } from "nostr-tools";
import { openDB as openLegacyIdb, type IDBPDatabase } from "idb";
import { isAnyReplaceable, getEventReplaceableKey, isNewerEvent } from "./replaceables";

/**
 * The previous storage layer persisted the whole Zustand store (events,
 * replaceableIndex, replaceableHistory) as a single JSON blob under this
 * IndexedDB key. This module only ever reads from it - it is kept around as
 * a rollback backup and is never cleared or written to.
 */
const LEGACY_DB_NAME = "zustand-event-store";
const LEGACY_STORE_NAME = "keyval";
const LEGACY_DB_VERSION = 1;
const LEGACY_KEY = "nostr-event-store";

interface LegacyPersistedState {
  state?: {
    events?: Record<string, unknown>;
    replaceableIndex?: Record<string, string>;
    replaceableHistory?: Record<string, string[]>;
  };
}

function isEventShaped(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.pubkey === "string" &&
    typeof e.kind === "number" &&
    typeof e.created_at === "number" &&
    typeof e.content === "string" &&
    typeof e.sig === "string" &&
    Array.isArray(e.tags)
  );
}

async function openLegacyDB(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === "undefined") return null;

  // Avoid indexedDB.open() ever creating an empty legacy database: check for
  // its existence first where the browser supports it. `null` means "no
  // legacy data to migrate"; a genuine open failure is allowed to throw so
  // the caller doesn't mark migration complete after a transient error.
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === LEGACY_DB_NAME)) return null;
  }

  return openLegacyIdb(LEGACY_DB_NAME, LEGACY_DB_VERSION, {
    upgrade(db) {
      // Mirrors the old store's own upgrade handler so re-opening it here is a
      // no-op if the store already exists, and never fails if it doesn't.
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.createObjectStore(LEGACY_STORE_NAME);
      }
    },
  });
}

/**
 * Reads and validates events from the legacy Zustand-persisted event store.
 * Returns all regular events plus the newest version of each
 * replaceable/addressable event, deduplicated by id. Returns [] when there is
 * genuinely nothing to migrate (absent DB, empty/corrupt snapshot), but lets a
 * transient read failure throw so the caller can retry instead of marking the
 * migration permanently complete. Never mutates or clears the legacy DB.
 */
export async function readLegacyEvents(): Promise<NostrEvent[]> {
  const db = await openLegacyDB();
  if (!db) return [];

  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) return [];

    const raw = await db.get(LEGACY_STORE_NAME, LEGACY_KEY);
    if (typeof raw !== "string" || raw.length === 0) return [];

    let parsed: LegacyPersistedState;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn(
        "[legacyMigration] Legacy snapshot is not valid JSON, skipping migration:",
        error
      );
      return [];
    }

    const rawEvents = parsed?.state?.events;
    if (!rawEvents || typeof rawEvents !== "object") return [];

    const byId = new Map<string, NostrEvent>();
    for (const value of Object.values(rawEvents)) {
      if (isEventShaped(value) && !byId.has(value.id)) {
        byId.set(value.id, value);
      }
    }

    const newestByReplaceableKey = new Map<string, NostrEvent>();
    const regularEvents: NostrEvent[] = [];

    for (const event of byId.values()) {
      const replaceableKey = isAnyReplaceable(event.kind)
        ? getEventReplaceableKey(event)
        : null;

      if (!replaceableKey) {
        regularEvents.push(event);
        continue;
      }

      const current = newestByReplaceableKey.get(replaceableKey);
      if (!current || isNewerEvent(event, current)) {
        newestByReplaceableKey.set(replaceableKey, event);
      }
    }

    return [...regularEvents, ...newestByReplaceableKey.values()];
  } finally {
    db.close();
  }
}
