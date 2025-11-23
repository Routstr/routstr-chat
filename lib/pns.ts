import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import * as secp from '@noble/secp256k1';
import { nip44, getPublicKey, finalizeEvent, Event } from 'nostr-tools';
import { decodePrivateKey } from './nostr';

// Constants
export const KIND_PNS = 1080;
const SALT_PNS = 'nip-pns';
const SALT_NIP44 = 'nip44-v2';

// Types
export interface PnsKeys {
  pnsKey: Uint8Array;
  pnsKeypair: {
    privKey: Uint8Array;
    pubKey: string;
  };
  pnsNip44Key: Uint8Array;
}

/**
 * Derives PNS keys from a device secret key (nsec)
 */
export function derivePnsKeys(deviceKey: Uint8Array): PnsKeys {
  // 1. Key Derivation
  // pns_key = hkdf_extract(ikm=device_key, salt="nip-pns")
  const pnsKey = hkdf(sha256, deviceKey, new TextEncoder().encode(SALT_PNS), new Uint8Array(0), 32);

  // pns_keypair = derive_secp256k1_keypair(pns_key)
  // Note: pns_key is used as the private key for the keypair
  const pnsPrivKey = pnsKey;
  const pnsPubKey = getPublicKey(pnsPrivKey);

  // 2. Symmetric Key Derivation for Encryption
  // pns_nip44_key = hkdf_extract(ikm=pns_key, salt="nip44-v2")
  const pnsNip44Key = hkdf(sha256, pnsKey, new TextEncoder().encode(SALT_NIP44), new Uint8Array(0), 32);

  return {
    pnsKey,
    pnsKeypair: {
      privKey: pnsPrivKey,
      pubKey: pnsPubKey,
    },
    pnsNip44Key,
  };
}

/**
 * Encrypts an inner event using PNS
 */
export function encryptPnsEvent(
  innerEvent: any,
  pnsKeys: PnsKeys
): { content: string; nonce: Uint8Array } {
  const innerEventJson = JSON.stringify(innerEvent);
  
  // Generate a random 32-byte nonce
  const nonce = nip44.v2.utils.randomBytes(32);
  
  // Encrypt the inner note using pns_nip44_key and the nonce via NIP-44 v2
  const ciphertext = nip44.v2.encrypt(innerEventJson, pnsKeys.pnsNip44Key, nonce);
  
  return { content: ciphertext, nonce };
}

/**
 * Creates a signed PNS event (Kind 1080)
 */
export function createPnsEvent(
  ciphertext: string,
  pnsKeys: PnsKeys
): Event {
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
    const plaintext = nip44.v2.decrypt(pnsEvent.content, pnsKeys.pnsNip44Key);
    
    // Parse the decrypted contents as JSON
    return JSON.parse(plaintext);
  } catch (error) {
    console.error('Failed to decrypt PNS event:', error);
    return null;
  }
}

/**
 * Helper to get PNS keys from an nsec string
 */
export function getPnsKeysFromNsec(nsec: string): PnsKeys | null {
  const deviceKey = decodePrivateKey(nsec);
  if (!deviceKey) return null;
  return derivePnsKeys(deviceKey);
}