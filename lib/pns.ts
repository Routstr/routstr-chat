import { extract as hkdf_extract } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';
import { nip44, getPublicKey, finalizeEvent, Event } from 'nostr-tools';

// Constants
export const KIND_PNS = 1080;
export const SALT_PNS = process.env.NODE_ENV === 'development' ? 'routstr-chat-sync-test3' : 'routstr-chat-sync-v1';

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
    salt: salt_used
  };
}

/**
 * Creates a signed PNS event (Kind 1080)
 */
export function createPnsEvent(
  innerEvent: any,
  pnsKeys: PnsKeys
): Event {
  const innerEventJson = JSON.stringify(innerEvent);
  
  // Generate a random 32-byte nonce
  const nonce = randomBytes(32);
  
  // Encrypt the inner note using pns_nip44_key and the nonce via NIP-44 v2
  const ciphertext = nip44.v2.encrypt(innerEventJson, pnsKeys.pnsKeypair.privKey, nonce);
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
export function decryptPnsEvent(
  pnsEvent: Event,
  pnsKeys: PnsKeys
): any | null {
  try {
    // Attempt NIP-44 decryption using pns_nip44_key
    const plaintext = nip44.v2.decrypt(pnsEvent.content, pnsKeys.pnsKeypair.privKey);
    
    // Parse the decrypted contents as JSON
    return JSON.parse(plaintext);
  } catch (error) {
    console.error('Failed to decrypt PNS event:', error);
    return null;
  }
}
