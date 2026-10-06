import { EventStore } from "applesauce-core";
import { NostrConnectSigner } from "applesauce-signers";
import { pool } from "@/runtime/nostr";
import { getEventDatabaseInstance } from "./eventDatabase";

/**
 * Singleton instances for Applesauce core functionality
 * These should be imported and used throughout the application
 */

// Get the Zustand-based event database instance
// This provides persistent storage via localStorage
const eventDatabase = getEventDatabaseInstance();

// Central event storage with persistent database backend
export const eventStore = new EventStore({ database: eventDatabase });

// The app's one relay pool (runtime/nostr.ts)
export const relayPool = pool;

// Setup nostr connect signer
if (typeof window !== "undefined") {
  NostrConnectSigner.subscriptionMethod =
    relayPool.subscription.bind(relayPool);
  NostrConnectSigner.publishMethod = relayPool.publish.bind(relayPool);
}

// Re-export the event database for direct access if needed
export { eventDatabase };
