import type { NostrEvent } from "nostr-tools";
import { openDB as openNostrIdb, getEventTags, type NostrIDB } from "nostr-idb";
import { getEventReplaceableKey } from "./replaceables";
import { readLegacyEvents } from "./legacyMigration";

const DB_NAME = "routstr-event-store";
const MIGRATION_FLAG_KEY = "routstr:eventdb:migrated:v1";

// How long to wait after the last dirty event before flushing, and the
// absolute cap on how long a dirty entry can sit unflushed during a
// sustained burst (e.g. importing hundreds of events back to back).
const FLUSH_DEBOUNCE_MS = 150;
const FLUSH_MAX_WAIT_MS = 750;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * The storage identity for an event: the replaceable/addressable key for
 * replaceable events (so all versions share one row), otherwise the event id.
 * This intentionally uses this app's own replaceable-kind semantics
 * (lib/eventDatabase/replaceables.ts) rather than nostr-idb's own
 * getEventUID(), which also treats kinds 0 and 3 as replaceable - keeping a
 * single source of truth for what "replaceable" means avoids the sidecar's
 * storage keys silently diverging from the in-memory store's own model.
 */
export function getStorageUid(event: NostrEvent): string {
  return getEventReplaceableKey(event) ?? event.id;
}

let dbPromise: Promise<NostrIDB> | null = null;

function getDB(): Promise<NostrIDB> {
  if (!dbPromise) {
    dbPromise = openNostrIdb(DB_NAME);
  }
  return dbPromise;
}

async function runLegacyMigrationIfNeeded(db: NostrIDB): Promise<void> {
  if (hasLocalStorage() && window.localStorage.getItem(MIGRATION_FLAG_KEY) === "1") {
    return;
  }

  try {
    const legacyEvents = await readLegacyEvents();
    if (legacyEvents.length > 0) {
      const tx = db.transaction("events", "readwrite");
      for (const event of legacyEvents) {
        // Migration runs before hydration/live-sync are allowed to touch this
        // database, so nothing else can have written a newer value at this uid
        // yet - a plain put is safe.
        tx.store.put({ event, tags: getEventTags(event) }, getStorageUid(event));
      }
      await tx.done;
    }

    if (hasLocalStorage()) {
      window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    }
  } catch (error) {
    console.warn(
      "[eventDatabase] Legacy migration failed; will retry on next load:",
      error
    );
  }
}

async function readAllEvents(db: NostrIDB): Promise<NostrEvent[]> {
  const all = await db.getAll("events");
  return all.map((record) => record.event);
}

async function bootstrap(): Promise<NostrEvent[]> {
  const db = await getDB();
  await runLegacyMigrationIfNeeded(db);
  return readAllEvents(db);
}

/**
 * Resolves with every event currently persisted (after legacy migration has
 * been applied). Consumed once by eventStore.ts to hydrate memory before
 * resolving eventDatabaseReady.
 */
export const hydratedEvents: Promise<NostrEvent[]> =
  typeof window !== "undefined" ? bootstrap() : Promise.resolve([]);

// ---- Coalesced per-identity writes ----
//
// `dirty` holds the storage uids whose on-disk value is stale. The event to
// write for each uid is resolved from *live in-memory state* at flush time
// (via `resolveHead`), never captured at mutation time. So no matter how many
// add/remove/hydrate operations touch a uid between flushes, the row we write
// is always its final in-memory state - which is what keeps "insert new
// version, then remove the old one" from ever deleting the surviving version,
// and keeps a pre-hydration write from overwriting a newer version that
// hydration is still loading.
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let firstDirtyAt = 0;
let flushChain: Promise<void> = Promise.resolve();

// Writes are held until the in-memory store has hydrated from disk. Until
// then a live event that arrives early could flush a value that loses to (and
// overwrites) a newer version still being loaded. The gate stays closed if
// hydration fails, preserving existing on-disk history rather than clobbering
// it with un-hydrated state.
let canPersist = false;

type HeadResolver = (uid: string) => NostrEvent | null;
let resolveHead: HeadResolver = () => null;

/** Registered by the event store so writes can read current in-memory heads. */
export function setPersistedHeadResolver(resolver: HeadResolver): void {
  resolveHead = resolver;
}

/**
 * Opens the write gate and flushes anything queued during startup. Called by
 * the event store only after a successful hydration.
 */
export function enablePersistence(): void {
  canPersist = true;
  if (dirty.size > 0) scheduleFlush();
}

async function writePending(): Promise<void> {
  if (dirty.size === 0) return;
  const pending = [...dirty];
  dirty.clear();
  firstDirtyAt = 0;

  try {
    const db = await getDB();
    const tx = db.transaction("events", "readwrite");
    for (const uid of pending) {
      const event = resolveHead(uid);
      if (event) tx.store.put({ event, tags: getEventTags(event) }, uid);
      else tx.store.delete(uid);
    }
    await tx.done;
  } catch (error) {
    // Requeue the batch so it retries rather than being lost, and swallow so
    // the shared flush chain never stays rejected - a rejected chain would
    // silently stop every future flush and the clear() below.
    for (const uid of pending) dirty.add(uid);
    scheduleFlush();
    console.warn("[eventDatabase] Flush failed; will retry:", error);
  }
}

function flushDirty(): Promise<void> {
  flushChain = flushChain.then(writePending);
  return flushChain;
}

function scheduleFlush(): void {
  if (!canPersist) return;
  const now = Date.now();
  if (firstDirtyAt === 0) firstDirtyAt = now;

  if (now - firstDirtyAt >= FLUSH_MAX_WAIT_MS) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    void flushDirty();
    return;
  }

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDirty();
  }, FLUSH_DEBOUNCE_MS);
}

/** Marks a storage identity as needing to be re-persisted. */
export function schedulePersist(uid: string): void {
  dirty.add(uid);
  scheduleFlush();
}

// iOS Safari aggressively suspends/kills backgrounded tabs, which is the
// platform this bug was reported on - flush immediately when the page is
// about to be hidden or unloaded rather than relying solely on the debounce
// window. (No-op until persistence is enabled, so we never write un-hydrated
// state.)
if (typeof document !== "undefined") {
  const flushNow = () => {
    if (canPersist) void flushDirty();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

export async function clearPersistedEvents(): Promise<void> {
  dirty.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  firstDirtyAt = 0;
  // Chain onto flushChain so a flush already in flight can't land after the
  // clear and resurrect stale rows. Keep the shared chain resolved afterwards
  // so a failed clear can't wedge future writes.
  const done = flushChain.then(async () => {
    const db = await getDB();
    await db.clear("events");
  });
  flushChain = done.catch(() => {});
  await done;
}
