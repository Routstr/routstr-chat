import {
  nip19,
  SimplePool,
  getPublicKey as getPublicKeyFromPrivate,
  finalizeEvent,
} from "nostr-tools";
import type { Event } from "nostr-tools";

// Define the Window interface extension for Nostr
declare global {
  interface Window {
    nostr?: NostrExtension;
  }
}

export type NostrExtension = {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<Event>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
};

export const isNostrExtensionAvailable = (): boolean => {
  return (
    typeof window !== "undefined" &&
    "nostr" in window &&
    window.nostr !== undefined
  );
};

// Get the user's public key from their Nostr extension (NIP-07)
export const getPublicKey = async (): Promise<string | null> => {
  if (!isNostrExtensionAvailable()) {
    console.error("Nostr extension not available");
    return null;
  }

  try {
    const publicKey = await window.nostr!.getPublicKey();
    return publicKey;
  } catch (error) {
    console.error("Error getting public key:", error);
    return null;
  }
};

// Format a public key to npub format for display
export const formatPublicKey = (publicKey: string): string => {
  try {
    return nip19.npubEncode(publicKey);
  } catch (error) {
    console.error("Error formatting public key:", error);
    return publicKey.slice(0, 10) + "..." + publicKey.slice(-10);
  }
};

// Decode a npub to get the raw public key
export const decodePublicKey = (npub: string): string | null => {
  try {
    const { type, data } = nip19.decode(npub);
    if (type !== "npub") return null;
    return data as string;
  } catch (error) {
    console.error("Error decoding npub:", error);
    return null;
  }
};

// Decode an nsec to get the private key
export const decodePrivateKey = (nsec: string): Uint8Array | null => {
  try {
    const { type, data } = nip19.decode(nsec);
    if (type !== "nsec") return null;
    return data as Uint8Array;
  } catch (error) {
    console.error("Error decoding nsec:", error);
    return null;
  }
};

// Sign an event with a private key
export const signEventWithPrivateKey = (
  event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  },
  privateKey: Uint8Array
): Event => {
  // Create an unsigned event with the given details
  const unsignedEvent = {
    ...event,
    pubkey: getPublicKeyFromPrivate(privateKey),
  };

  // Calculate the event ID and signature
  return finalizeEvent(unsignedEvent, privateKey);
};

// Get public key from private key
export const getPublicKeyFromPrivateKey = (privateKey: Uint8Array): string => {
  return getPublicKeyFromPrivate(privateKey);
};

// Validate an nsec key
export const validateNsec = (nsec: string): boolean => {
  try {
    const privateKey = decodePrivateKey(nsec);
    return privateKey !== null;
  } catch {
    return false;
  }
};

// Sign an event with the user's Nostr extension
export const signEvent = async (
  content: string,
  kind = 1
): Promise<Event | null> => {
  if (!isNostrExtensionAvailable()) {
    console.error("Nostr extension not available");
    return null;
  }

  try {
    const event = {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    };

    const signedEvent = await window.nostr!.signEvent(event);
    return signedEvent;
  } catch (error) {
    console.error("Error signing event:", error);
    return null;
  }
};

// Create a new SimplePool for relay connections
export const createPool = (): SimplePool => {
  return new SimplePool();
};

// Get a list of default relays
export const getDefaultRelays = (): string[] => {
  // Deprecated: relays are now user-configurable. This returns an empty list to avoid hardcoded connections.
  return [];
};
