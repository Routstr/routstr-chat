import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes, concatBytes, bytesToHex } from "@noble/hashes/utils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

// ============================================================================
// Constants
// ============================================================================

/**
 * Current version of the encrypted blob format.
 * Used to allow future changes to the encryption scheme.
 */
const BLOB_ENCRYPTION_VERSION = 1;

/**
 * Salt used for deriving blob encryption keys from PNS keys.
 */
const BLOB_KEY_SALT = "routstr-blob-encryption-v1";

/**
 * Nonce size for XChaCha20-Poly1305 (24 bytes)
 */
const NONCE_SIZE = 24;

// ============================================================================
// Types
// ============================================================================

export interface EncryptedBlobHeader {
  version: number;
  mimeType: string;
  originalSize: number;
  originalHash: string; // SHA-256 of original data for verification
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derives a per-blob encryption key from the PNS key and file content.
 * Uses HKDF with SHA-256 to derive a 32-byte key.
 *
 * This ensures:
 * - Same file with same PNS key = same encryption (for deduplication)
 * - Different files get different keys (for security)
 *
 * @param pnsKey - The 32-byte PNS key from user's derived keys
 * @param fileHash - SHA-256 hash of the original file content
 * @returns 32-byte encryption key
 */
export function deriveBlobKey(
  pnsKey: Uint8Array,
  fileHash: Uint8Array
): Uint8Array {
  // Use HKDF to derive a unique key for this blob
  // IKM = pnsKey, salt = BLOB_KEY_SALT + fileHash, info = empty
  const salt = new TextEncoder().encode(BLOB_KEY_SALT);
  const combinedSalt = concatBytes(salt, fileHash);

  return hkdf(sha256, pnsKey, combinedSalt, undefined, 32);
}

/**
 * Derives a master blob encryption key from the PNS key.
 * This is used when we don't have the original file hash (e.g., for decryption).
 *
 * @param pnsKey - The 32-byte PNS key from user's derived keys
 * @returns 32-byte master encryption key
 */
export function deriveMasterBlobKey(pnsKey: Uint8Array): Uint8Array {
  const salt = new TextEncoder().encode(BLOB_KEY_SALT);
  return hkdf(sha256, pnsKey, salt, undefined, 32);
}

// ============================================================================
// Encryption/Decryption
// ============================================================================

/**
 * Encrypts a blob for upload to Blossom servers.
 *
 * Format of encrypted blob:
 * [version: 1 byte][headerLength: 4 bytes][header: JSON][nonce: 24 bytes][ciphertext: variable]
 *
 * Uses XChaCha20-Poly1305 for authenticated encryption.
 *
 * @param data - The raw file data to encrypt
 * @param mimeType - The MIME type of the original file
 * @param pnsKey - The 32-byte PNS key for encryption
 * @returns Encrypted blob data ready for upload
 */
export function encryptBlob(
  data: Uint8Array,
  mimeType: string,
  pnsKey: Uint8Array
): Uint8Array {
  // Calculate original file hash
  const originalHash = sha256(data);

  // Derive per-blob encryption key
  const blobKey = deriveBlobKey(pnsKey, originalHash);

  // Create header with metadata
  const header: EncryptedBlobHeader = {
    version: BLOB_ENCRYPTION_VERSION,
    mimeType,
    originalSize: data.length,
    originalHash: bytesToHex(originalHash),
  };

  const headerJson = JSON.stringify(header);
  const headerBytes = new TextEncoder().encode(headerJson);

  // Generate random nonce for XChaCha20-Poly1305
  const nonce = randomBytes(NONCE_SIZE);

  // Encrypt the data
  const cipher = xchacha20poly1305(blobKey, nonce);
  const ciphertext = cipher.encrypt(data);

  // Build the final blob:
  // [version: 1 byte][headerLength: 4 bytes LE][header][nonce: 24 bytes][ciphertext]
  const headerLength = new Uint8Array(4);
  new DataView(headerLength.buffer).setUint32(0, headerBytes.length, true);

  return concatBytes(
    new Uint8Array([BLOB_ENCRYPTION_VERSION]),
    headerLength,
    headerBytes,
    nonce,
    ciphertext
  );
}

/**
 * Decrypts a blob retrieved from Blossom servers.
 *
 * @param encryptedData - The encrypted blob data
 * @param pnsKey - The 32-byte PNS key for decryption
 * @returns Object with decrypted data and metadata, or null if decryption fails
 */
export function decryptBlob(
  encryptedData: Uint8Array,
  pnsKey: Uint8Array
): { data: Uint8Array; mimeType: string } | null {
  try {
    // Check minimum size (version + headerLength + some header + nonce + some data)
    if (encryptedData.length < 1 + 4 + 10 + NONCE_SIZE + 16) {
      console.error("Encrypted blob too small");
      return null;
    }

    // Read version
    const version = encryptedData[0];
    if (version !== BLOB_ENCRYPTION_VERSION) {
      console.error(`Unsupported blob encryption version: ${version}`);
      return null;
    }

    // Read header length
    const headerLength = new DataView(
      encryptedData.buffer,
      encryptedData.byteOffset + 1,
      4
    ).getUint32(0, true);

    // Validate header length
    if (
      headerLength > 10000 ||
      1 + 4 + headerLength + NONCE_SIZE > encryptedData.length
    ) {
      console.error("Invalid header length");
      return null;
    }

    // Read and parse header
    const headerStart = 5;
    const headerEnd = headerStart + headerLength;
    const headerBytes = encryptedData.slice(headerStart, headerEnd);
    const headerJson = new TextDecoder().decode(headerBytes);
    const header: EncryptedBlobHeader = JSON.parse(headerJson);

    // Read nonce
    const nonceStart = headerEnd;
    const nonceEnd = nonceStart + NONCE_SIZE;
    const nonce = encryptedData.slice(nonceStart, nonceEnd);

    // Read ciphertext
    const ciphertext = encryptedData.slice(nonceEnd);

    // Derive the blob key using the original hash from header
    const originalHashBytes = hexToBytes(header.originalHash);
    const blobKey = deriveBlobKey(pnsKey, originalHashBytes);

    // Decrypt
    const cipher = xchacha20poly1305(blobKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);

    // Verify hash
    const actualHash = bytesToHex(sha256(plaintext));
    if (actualHash !== header.originalHash) {
      console.error("Hash verification failed after decryption");
      return null;
    }

    return {
      data: plaintext,
      mimeType: header.mimeType,
    };
  } catch (error) {
    console.error("Blob decryption failed:", error);
    return null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Checks if data is an encrypted blob by checking the version byte
 */
export function isEncryptedBlob(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === BLOB_ENCRYPTION_VERSION;
}
