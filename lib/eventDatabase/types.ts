import { NostrEvent } from "nostr-tools";

/**
 * Filter type for querying events
 * Based on NIP-01 filter specification
 */
export interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  // Tag filters (e.g., #e, #p)
  [key: `#${string}`]: string[] | undefined;
}

/**
 * IEventDatabase interface
 * Defines the contract for event storage implementations
 */
export interface IEventDatabase {
  /** Add an event to the database */
  add(event: NostrEvent): NostrEvent;
  /** Remove an event from the database */
  remove(event: string | NostrEvent): boolean;
  /** Remove multiple events that match the given filters */
  removeByFilters(filters: Filter | Filter[]): number;
  /** Check if the event store has an event with id */
  hasEvent(id: string): boolean;
  /** Get an event by id */
  getEvent(id: string): NostrEvent | undefined;
  /** Check if the event store has a replaceable event */
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean;
  /** Get a replaceable event */
  getReplaceable(
    kind: number,
    pubkey: string,
    identifier?: string
  ): NostrEvent | undefined;
  /** Get the history of a replaceable event */
  getReplaceableHistory(
    kind: number,
    pubkey: string,
    identifier?: string
  ): NostrEvent[] | undefined;
  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): NostrEvent[];
  /** Get a timeline of events that match the filters */
  getTimeline(filters: Filter | Filter[]): NostrEvent[];
}

/**
 * Internal state for the event store
 */
export interface EventStoreState extends IEventDatabase {
  // Primary storage: event ID -> NostrEvent
  events: Record<string, NostrEvent>;

  // Replaceable event index: "kind:pubkey:identifier" -> latest event ID
  replaceableIndex: Record<string, string>;

  // Replaceable history: "kind:pubkey:identifier" -> event ID array (newest first)
  replaceableHistory: Record<string, string[]>;

  // Utility methods
  clearStore: () => void;
  getStats: () => { totalEvents: number; replaceableCount: number };
}

/**
 * Store statistics
 */
export interface EventStoreStats {
  totalEvents: number;
  replaceableCount: number;
}
