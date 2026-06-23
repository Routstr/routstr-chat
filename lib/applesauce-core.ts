import { EventStore } from "applesauce-core";
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { getEventDatabaseInstance, useEventDatabase } from "./eventDatabase";

/**
 * Singleton instances for Applesauce core functionality
 * These should be imported and used throughout the application
 */

// Get the Zustand-based event database instance
// This provides persistent storage via localStorage
const eventDatabase = getEventDatabaseInstance();

// Central event storage with persistent database backend
export const eventStore = new EventStore({ database: eventDatabase });

// Relay pool for managing connections
export const relayPool = new RelayPool();

// Setup nostr connect signer
if (typeof window !== "undefined") {
  NostrConnectSigner.subscriptionMethod =
    relayPool.subscription.bind(relayPool);
  NostrConnectSigner.publishMethod = relayPool.publish.bind(relayPool);
}

// Re-export the event database for direct access if needed
export { eventDatabase };

/**
 * Fully clears all cached events on account switch.
 *
 * The applesauce EventStore has two layers:
 *   1. `memory` – an in-memory EventMemory (LRU + indexes)
 *   2. `database` – the Zustand/IndexedDB-backed store
 *
 * Both must be cleared together so stale events from a previous identity
 * cannot be returned by subsequent queries.
 */
export function clearEventStore(): void {
  // Clear the in-memory layer (indexes, LRU, replaceable map, etc.)
  eventStore.memory?.reset();

  // Clear the persisted Zustand/IndexedDB layer
  useEventDatabase.getState().clearStore();
}
