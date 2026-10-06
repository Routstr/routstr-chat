import type { Filter, NostrEvent } from "nostr-tools";

/** This device's copy of Nostr events (platform/nostr/eventLog.ts). */
export interface EventLog {
  query(filter: Filter): Promise<NostrEvent[]>;
  /** Resolves only once the events are on disk. */
  put(events: NostrEvent[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
}
