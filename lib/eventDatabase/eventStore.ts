import { create, StateCreator } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";
import { NostrEvent } from "nostr-tools";
import { openDB, IDBPDatabase } from "idb";
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

const DB_NAME = "zustand-event-store";
const STORE_NAME = "keyval";
const DB_VERSION = 1;

/**
 * Get or create the IndexedDB database instance
 */
let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * IndexedDB storage adapter for Zustand persist middleware
 * Uses the idb library for IndexedDB access
 */
const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await getDB();
    const value = await db.get(STORE_NAME, name);
    return value ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const db = await getDB();
    await db.put(STORE_NAME, value, name);
  },
  removeItem: async (name: string): Promise<void> => {
    const db = await getDB();
    await db.delete(STORE_NAME, name);
  },
};

/**
 * Zustand-based Event Database
 * Implements IEventDatabase interface for use with applesauce-core EventStore
 */
export const useEventDatabase = create<EventStoreState>()(
  persist(
    (set, get) => ({
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
        const state = get();

        // Check if event already exists
        if (state.events[event.id]) {
          return event;
        }

        // Handle replaceable events
        if (isAnyReplaceable(event.kind)) {
          const replaceableKey = getEventReplaceableKey(event);
          if (replaceableKey) {
            const currentLatestId = state.replaceableIndex[replaceableKey];
            const currentLatest = currentLatestId
              ? state.events[currentLatestId]
              : null;

            // Check if this event is newer than the current latest
            const shouldUpdateIndex =
              !currentLatest || isNewerEvent(event, currentLatest);

            // Get existing history or create new array
            const existingHistory =
              state.replaceableHistory[replaceableKey] || [];

            // Insert event into history in sorted order (newest first)
            let newHistory: string[];
            if (existingHistory.length === 0) {
              newHistory = [event.id];
            } else {
              // Find the correct position to insert
              let insertIndex = 0;
              for (let i = 0; i < existingHistory.length; i++) {
                const historyEvent = state.events[existingHistory[i]];
                if (historyEvent && isNewerEvent(event, historyEvent)) {
                  break;
                }
                insertIndex = i + 1;
              }
              newHistory = [
                ...existingHistory.slice(0, insertIndex),
                event.id,
                ...existingHistory.slice(insertIndex),
              ];
            }

            set({
              events: { ...state.events, [event.id]: event },
              replaceableIndex: shouldUpdateIndex
                ? { ...state.replaceableIndex, [replaceableKey]: event.id }
                : state.replaceableIndex,
              replaceableHistory: {
                ...state.replaceableHistory,
                [replaceableKey]: newHistory,
              },
            });

            return event;
          }
        }

        // Non-replaceable event: just add to events
        set({
          events: { ...state.events, [event.id]: event },
        });

        return event;
      },

      /**
       * Remove an event from the database
       * Returns true if the event was removed, false if not found
       */
      remove(event: string | NostrEvent): boolean {
        const state = get();
        const eventId = typeof event === "string" ? event : event.id;

        // Check if event exists
        if (!state.events[eventId]) {
          return false;
        }

        const eventToRemove = state.events[eventId];
        const newEvents = { ...state.events };
        delete newEvents[eventId];

        // Handle replaceable events
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
    }),
    {
      name: "nostr-event-store",
      storage: createJSONStorage(() => indexedDBStorage),
      // Only persist data, not methods
      partialize: (state) => ({
        events: state.events,
        replaceableIndex: state.replaceableIndex,
        replaceableHistory: state.replaceableHistory,
      }),
    }
  )
);

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
