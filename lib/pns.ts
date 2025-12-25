import { extract as hkdf_extract } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { nip44, getPublicKey, finalizeEvent, Event } from "nostr-tools";

// Constants
export const KIND_PNS = 1080;
export const SALT_PNS = "routstr-chat-sync-v1";
// export const SALT_PNS = process.env.NODE_ENV === 'development' ? 'routstr-chat-sync-test3' : 'routstr-chat-sync-v1';

// Types
export interface PnsKeys {
  pnsKey: Uint8Array;
  pnsKeypair: {
    privKey: Uint8Array;
    pubKey: string;
  };
  salt: string;
}

/**
 * Derives PNS keys from a device secret key (nsec)
 */
export function derivePnsKeys(deviceKey: Uint8Array, salt?: string): PnsKeys {
  // 1. Key Derivation
  const salt_used = salt ?? SALT_PNS;
  // pns_key = hkdf_extract(ikm=device_key, salt="nip-pns")
  const pnsKey = hkdf_extract(sha256, deviceKey, salt ?? SALT_PNS);

  // pns_keypair = derive_secp256k1_keypair(pns_key)
  // Note: pns_key is used as the private key for the keypair
  const pnsPrivKey = pnsKey;
  const pnsPubKey = getPublicKey(pnsPrivKey);

  return {
    pnsKey,
    pnsKeypair: {
      privKey: pnsPrivKey,
      pubKey: pnsPubKey,
    },
    salt: salt_used,
  };
}

/**
 * Creates a signed PNS event (Kind 1080)
 */
export function createPnsEvent(innerEvent: any, pnsKeys: PnsKeys): Event {
  const innerEventJson = JSON.stringify(innerEvent);

  // Generate a random 32-byte nonce
  const nonce = randomBytes(32);

  // Encrypt the inner note using pns_nip44_key and the nonce via NIP-44 v2
  const ciphertext = nip44.v2.encrypt(
    innerEventJson,
    pnsKeys.pnsKeypair.privKey,
    nonce,
  );
  const pnsEvent = {
    kind: KIND_PNS,
    pubkey: pnsKeys.pnsKeypair.pubKey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: ciphertext,
  };

  return finalizeEvent(pnsEvent, pnsKeys.pnsKeypair.privKey);
}

/**
 * Decrypts a PNS event
 */
export function decryptPnsEvent(pnsEvent: Event, pnsKeys: PnsKeys): any | null {
  try {
    // Attempt NIP-44 decryption using pns_nip44_key
    const plaintext = nip44.v2.decrypt(
      pnsEvent.content,
      pnsKeys.pnsKeypair.privKey,
    );

    // Parse the decrypted contents as JSON
    return JSON.parse(plaintext);
  } catch (error) {
    if (error instanceof Error) {
      // Handle specific "invalid MAC" error which indicates decryption failure
      if (error.message === "invalid MAC") {
        console.warn(
          "PNS event decryption failed: invalid MAC - likely encrypted with different keys",
          {
            eventId: pnsEvent.id,
            pubkey: pnsEvent.pubkey,
          },
        );
        return null;
      }

      // Handle JSON parse errors separately
      if (
        error.message.includes("Unexpected token") ||
        error.message.includes("JSON")
      ) {
        console.warn("Failed to parse decrypted PNS event content as JSON:", {
          eventId: pnsEvent.id,
          error: error.message,
        });
        return null;
      }

      console.error("PNS event decryption error:", error.message, {
        eventId: pnsEvent.id,
        pubkey: pnsEvent.pubkey,
      });
      return null;
    }

    console.error("Failed to decrypt PNS event:", error);
    return null;
  }
}

/**
 * Creates a deletion request event for one or multiple PNS events
 */
export function createPnsDeletionEvent(
  eventIds: string[],
  pnsKeys: PnsKeys,
  reason?: string,
): Event {
  // Validate input
  if (!eventIds || eventIds.length === 0) {
    throw new Error("At least one event ID must be provided for deletion");
  }

  // Create tags for the deletion event
  const tags: string[][] = [];

  // Add 'e' tags for each event ID to be deleted
  eventIds.forEach((eventId) => {
    tags.push(["e", eventId]);
  });

  // Add 'k' tag for the kind of events being deleted (PNS events are kind 1080)
  tags.push(["k", KIND_PNS.toString()]);

  const deletionEvent = {
    kind: 5, // Deletion request event kind
    pubkey: pnsKeys.pnsKeypair.pubKey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: reason || "PNS events deletion request",
  };

  return finalizeEvent(deletionEvent, pnsKeys.pnsKeypair.privKey);
}
