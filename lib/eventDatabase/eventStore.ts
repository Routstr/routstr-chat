import { create } from "zustand";
import { NostrEvent } from "nostr-tools";
import { EventStoreState, Filter } from "./types";
import {
  isAnyReplaceable,
  getEventReplaceableKey,
  getReplaceableKey,
  isNewerEvent,
} from "./replaceables";
import {
  filterEvents,
  matchesAnyFilter,
  getTimeline as getTimelineFromEvents,
} from "./filters";
import {
  getStorageUid,
  schedulePersist,
  clearPersistedEvents,
  hydratedEvents,
  enablePersistence,
  setPersistedHeadResolver,
} from "./persistence";

interface CoreState {
  events: Record<string, NostrEvent>;
  replaceableIndex: Record<string, string>;
  replaceableHistory: Record<string, string[]>;
}

/**
 * Applies the replaceable-aware insertion logic shared by `add()` and
 * `hydrateInsert()`. Returns the next core state, or null if the event was
 * already present (no-op).
 */
function applyInsert(state: CoreState, event: NostrEvent): CoreState | null {
  if (state.events[event.id]) {
    return null;
  }

  if (isAnyReplaceable(event.kind)) {
    const replaceableKey = getEventReplaceableKey(event);
    if (replaceableKey) {
      const currentLatestId = state.replaceableIndex[replaceableKey];
      const currentLatest = currentLatestId ? state.events[currentLatestId] : null;

      const shouldUpdateIndex = !currentLatest || isNewerEvent(event, currentLatest);

      const existingHistory = state.replaceableHistory[replaceableKey] || [];

      let newHistory: string[];
      if (existingHistory.length === 0) {
        newHistory = [event.id];
      } else {
        let insertIndex = 0;
        for (let i = 0; i < existingHistory.length; i++) {
          const historyEvent = state.events[existingHistory[i]];
          if (historyEvent && isNewerEvent(event, historyEvent)) break;
          insertIndex = i + 1;
        }
        newHistory = [
          ...existingHistory.slice(0, insertIndex),
          event.id,
          ...existingHistory.slice(insertIndex),
        ];
      }

      return {
        events: { ...state.events, [event.id]: event },
        replaceableIndex: shouldUpdateIndex
          ? { ...state.replaceableIndex, [replaceableKey]: event.id }
          : state.replaceableIndex,
        replaceableHistory: {
          ...state.replaceableHistory,
          [replaceableKey]: newHistory,
        },
      };
    }
  }

  return { ...state, events: { ...state.events, [event.id]: event } };
}

/**
 * Event Database backing the Applesauce EventStore
 *
 * This store is synchronous and memory-backed (a plain Zustand store, no
 * persist middleware). An IndexedDB persistence sidecar
 * (lib/eventDatabase/persistence.ts) is attached separately: it persists
 * individual events keyed by storage identity and batches/coalesces writes,
 * instead of serializing the whole store on every mutation.
 */
export const useEventDatabase = create<EventStoreState>()((set, get) => ({
  // State
  events: {},
  replaceableIndex: {},
  replaceableHistory: {},

  // ====== Core Methods ======

  /**
   * Add an event to the database
   * Returns the added event
   */
  add(event: NostrEvent): NostrEvent {
    const next = applyInsert(get(), event);
    if (!next) return event;

    set(next);
    schedulePersist(getStorageUid(event));
    return event;
  },

  hydrateInsert(event: NostrEvent): void {
    const next = applyInsert(get(), event);
    if (next) set(next);
  },

  /**
   * Remove an event from the database
   * Returns true if the event was removed, false if not found
   */
  remove(event: string | NostrEvent): boolean {
    const state = get();
    const eventId = typeof event === "string" ? event : event.id;

    const eventToRemove = state.events[eventId];
    if (!eventToRemove) {
      return false;
    }

    const newEvents = { ...state.events };
    delete newEvents[eventId];

    let newReplaceableIndex = state.replaceableIndex;
    let newReplaceableHistory = state.replaceableHistory;

    if (isAnyReplaceable(eventToRemove.kind)) {
      const replaceableKey = getEventReplaceableKey(eventToRemove);
      if (replaceableKey) {
        // Remove from history
        const history = state.replaceableHistory[replaceableKey] || [];
        const newHistory = history.filter((id) => id !== eventId);

        newReplaceableHistory = { ...state.replaceableHistory };
        if (newHistory.length === 0) {
          delete newReplaceableHistory[replaceableKey];
        } else {
          newReplaceableHistory[replaceableKey] = newHistory;
        }

        // Update index if this was the latest
        newReplaceableIndex = { ...state.replaceableIndex };
        if (state.replaceableIndex[replaceableKey] === eventId) {
          if (newHistory.length > 0) {
            // Set next newest as the latest
            newReplaceableIndex[replaceableKey] = newHistory[0];
          } else {
            delete newReplaceableIndex[replaceableKey];
          }
        }
      }
    }

    set({
      events: newEvents,
      replaceableIndex: newReplaceableIndex,
      replaceableHistory: newReplaceableHistory,
    });

    // Resolved from live state at flush time, so removing an older replaceable
    // version re-writes the surviving head instead of deleting the row.
    schedulePersist(getStorageUid(eventToRemove));

    return true;
  },

  /**
   * Remove multiple events that match the given filters
   * Returns the number of events removed
   */
  removeByFilters(filters: Filter | Filter[]): number {
    const state = get();
    const allEvents = Object.values(state.events);
    const filterArray = Array.isArray(filters) ? filters : [filters];

    // Find events that match the filters
    const eventsToRemove = allEvents.filter((event) =>
      matchesAnyFilter(event, filterArray)
    );

    if (eventsToRemove.length === 0) {
      return 0;
    }

    // Remove each matching event
    eventsToRemove.forEach((event) => {
      get().remove(event);
    });

    return eventsToRemove.length;
  },

  /**
   * Check if the event store has an event with id
   */
  hasEvent(id: string): boolean {
    return id in get().events;
  },

  /**
   * Get an event by id
   */
  getEvent(id: string): NostrEvent | undefined {
    return get().events[id];
  },

  // ====== Replaceable Event Methods ======

  /**
   * Check if the event store has a replaceable event
   */
  hasReplaceable(
    kind: number,
    pubkey: string,
    identifier: string = ""
  ): boolean {
    const key = getReplaceableKey(kind, pubkey, identifier);
    return key in get().replaceableIndex;
  },

  /**
   * Get a replaceable event (returns the latest version)
   */
  getReplaceable(
    kind: number,
    pubkey: string,
    identifier: string = ""
  ): NostrEvent | undefined {
    const state = get();
    const key = getReplaceableKey(kind, pubkey, identifier);
    const eventId = state.replaceableIndex[key];
    return eventId ? state.events[eventId] : undefined;
  },

  /**
   * Get the history of a replaceable event (all versions, newest first)
   */
  getReplaceableHistory(
    kind: number,
    pubkey: string,
    identifier: string = ""
  ): NostrEvent[] | undefined {
    const state = get();
    const key = getReplaceableKey(kind, pubkey, identifier);
    const history = state.replaceableHistory[key];

    if (!history || history.length === 0) {
      return undefined;
    }

    return history
      .map((id) => state.events[id])
      .filter((event): event is NostrEvent => event !== undefined);
  },

  // ====== Filter Methods ======

  /**
   * Get all events that match the filters
   */
  getByFilters(filters: Filter | Filter[]): NostrEvent[] {
    const allEvents = Object.values(get().events);
    return filterEvents(allEvents, filters);
  },

  /**
   * Get a timeline of events that match the filters (sorted by created_at descending)
   */
  getTimeline(filters: Filter | Filter[]): NostrEvent[] {
    const allEvents = Object.values(get().events);
    return getTimelineFromEvents(allEvents, filters);
  },

  // ====== Utility Methods ======

  /**
   * Clear all events from the store
   */
  clearStore(): void {
    set({
      events: {},
      replaceableIndex: {},
      replaceableHistory: {},
    });
    void clearPersistedEvents();
  },

  /**
   * Get statistics about the store
   */
  getStats(): { totalEvents: number; replaceableCount: number } {
    const state = get();
    return {
      totalEvents: Object.keys(state.events).length,
      replaceableCount: Object.keys(state.replaceableIndex).length,
    };
  },
}));

// null means the uid no longer exists in memory -> "delete this row".
setPersistedHeadResolver((uid) => {
  const state = useEventDatabase.getState();
  const headId = state.replaceableIndex[uid];
  if (headId) return state.events[headId] ?? null;
  return state.events[uid] ?? null;
});

/**
 * Resolves once the persistence sidecar has finished opening its database,
 * migrating legacy data (if any), and hydrating this store's memory from
 * disk. Consumers that must not race ahead of cached history (initial relay
 * sync, stored-event processing) should await this before doing anything
 * that depends on the store already reflecting cached state.
 */
export const eventDatabaseReady: Promise<void> =
  typeof window !== "undefined"
    ? hydratedEvents
        .then((events) => {
          const hydrateInsert = useEventDatabase.getState().hydrateInsert;
          // Oldest first, so the same isNewerEvent comparisons used by add()
          // naturally converge on the newest version per replaceable key
          // regardless of the order events were originally persisted in.
          const sorted = [...events].sort((a, b) => a.created_at - b.created_at);
          for (const event of sorted) hydrateInsert(event);
          enablePersistence();
        })
        .catch((error) => {
          // Leave persistence disabled so we never overwrite the existing
          // on-disk history with un-hydrated state; it retries on next load.
          console.error(
            "[eventDatabase] Failed to hydrate from IndexedDB:",
            error
          );
        })
    : Promise.resolve();

/**
 * Get the event database instance for use with EventStore
 * This returns a plain object that implements IEventDatabase
 */
export function getEventDatabaseInstance() {
  const store = useEventDatabase.getState();
  return {
    add: store.add.bind(store),
    remove: store.remove.bind(store),
    removeByFilters: store.removeByFilters.bind(store),
    hasEvent: store.hasEvent.bind(store),
    getEvent: store.getEvent.bind(store),
    hasReplaceable: store.hasReplaceable.bind(store),
    getReplaceable: store.getReplaceable.bind(store),
    getReplaceableHistory: store.getReplaceableHistory.bind(store),
    getByFilters: store.getByFilters.bind(store),
    getTimeline: store.getTimeline.bind(store),
  };
}

// Export the hook as default
export default useEventDatabase;
