import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { finalizeEvent, NostrEvent } from "nostr-tools";

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://cdn.nostr.build",
];

export const BLOSSOM_AUTH_KIND = 24242;

// ============================================================================
// Types
// ============================================================================

export interface BlobDescriptor {
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  url: string;
}

export interface BlossomSigner {
  getPublicKey: () => Promise<string>;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<NostrEvent>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate SHA-256 hash of data
 */
export function calculateHash(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/**
 * Convert a File to Uint8Array
 */
export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// ============================================================================
// Authorization Events
// ============================================================================

/**
 * Creates a signed kind 24242 authorization event for Blossom operations
 *
 * @param action - The action to authorize (upload, get, delete, list)
 * @param sha256Hash - The SHA-256 hash of the blob (hex string)
 * @param signer - Nostr signer with getPublicKey and signEvent methods
 * @param expirationSecs - Expiration time in seconds from now (default: 1 hour)
 * @returns Signed Nostr event for Blossom authorization
 */
export async function createBlossomAuthEvent(
  action: "upload" | "get" | "delete" | "list",
  sha256Hash: string,
  signer: BlossomSigner,
  expirationSecs: number = 3600
): Promise<NostrEvent> {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + expirationSecs;

  const tags: string[][] = [
    ["t", action],
    ["expiration", expiration.toString()],
  ];

  // Add x tag for blob hash (required for upload/get/delete)
  if (action !== "list") {
    tags.push(["x", sha256Hash]);
  }

  const event = {
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    tags,
    content: `Authorize ${action} for ${sha256Hash}`,
  };

  return await signer.signEvent(event);
}

/**
 * Encodes a signed event as base64 for the Authorization header
 */
export function encodeAuthHeader(event: NostrEvent): string {
  const json = JSON.stringify(event);
  // Use btoa for browser, or Buffer for Node
  if (typeof btoa !== "undefined") {
    return `Nostr ${btoa(json)}`;
  }
  return `Nostr ${Buffer.from(json).toString("base64")}`;
}

// ============================================================================
// Blob Operations
// ============================================================================

/**
 * Check if a blob exists on a Blossom server
 *
 * @param sha256Hash - The SHA-256 hash of the blob (hex string)
 * @param serverUrl - The Blossom server URL
 * @returns true if blob exists, false otherwise
 */
export async function checkBlob(
  sha256Hash: string,
  serverUrl: string
): Promise<boolean> {
  try {
    const url = `${serverUrl.replace(/\/$/, "")}/${sha256Hash}`;
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    console.warn(`Failed to check blob on ${serverUrl}:`, error);
    return false;
  }
}

/**
 * Upload a blob to a Blossom server
 *
 * @param data - The binary data to upload
 * @param mimeType - The MIME type of the data
 * @param signer - Nostr signer for authorization
 * @param serverUrl - The Blossom server URL (default: first default server)
 * @returns BlobDescriptor with upload details, or null if failed
 */
export async function uploadBlob(
  data: Uint8Array,
  mimeType: string,
  signer: BlossomSigner,
  serverUrl: string = DEFAULT_BLOSSOM_SERVERS[0]
): Promise<BlobDescriptor | null> {
  try {
    // Calculate the hash of the data
    const hash = calculateHash(data);

    // Check if blob already exists
    const exists = await checkBlob(hash, serverUrl);
    if (exists) {
      console.log(`Blob ${hash} already exists on ${serverUrl}`);
      return {
        sha256: hash,
        size: data.length,
        type: mimeType,
        uploaded: Math.floor(Date.now() / 1000),
        url: `${serverUrl.replace(/\/$/, "")}/${hash}`,
      };
    }

    // Create authorization event
    const authEvent = await createBlossomAuthEvent("upload", hash, signer);
    const authHeader = encodeAuthHeader(authEvent);

    // Upload the blob
    const uploadUrl = `${serverUrl.replace(/\/$/, "")}/upload`;
    // Create a copy to ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
    const blobData = new Uint8Array(data).buffer as ArrayBuffer;
    const blob = new Blob([blobData], { type: mimeType });
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        Authorization: authHeader,
      },
      body: blob,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`Blossom upload failed: ${response.status} - ${errorText}`);
      return null;
    }

    const descriptor: BlobDescriptor = await response.json();
    return descriptor;
  } catch (error) {
    console.error("Blossom upload error:", error);
    return null;
  }
}

/**
 * Retrieve a blob from Blossom servers
 *
 * @param sha256Hash - The SHA-256 hash of the blob (hex string)
 * @param servers - List of Blossom server URLs to try (default: DEFAULT_BLOSSOM_SERVERS)
 * @returns The blob data as Uint8Array, or null if not found
 */
export async function getBlob(
  sha256Hash: string,
  servers: string[] = DEFAULT_BLOSSOM_SERVERS
): Promise<Uint8Array | null> {
  for (const server of servers) {
    try {
      const url = `${server.replace(/\/$/, "")}/${sha256Hash}`;
      const response = await fetch(url);

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }

      // If 404, try next server
      if (response.status === 404) {
        continue;
      }

      console.warn(`Blossom fetch failed from ${server}: ${response.status}`);
    } catch (error) {
      console.warn(`Blossom fetch error from ${server}:`, error);
    }
  }

  return null;
}

/**
 * Upload a blob to multiple Blossom servers for redundancy
 *
 * @param data - The binary data to upload
 * @param mimeType - The MIME type of the data
 * @param signer - Nostr signer for authorization
 * @param servers - List of Blossom server URLs (default: DEFAULT_BLOSSOM_SERVERS)
 * @returns Object with hash and list of successful server URLs, or null if all failed
 */
export async function uploadBlobToMultiple(
  data: Uint8Array,
  mimeType: string,
  signer: BlossomSigner,
  servers: string[] = DEFAULT_BLOSSOM_SERVERS
): Promise<{ hash: string; servers: string[] } | null> {
  const hash = calculateHash(data);
  const successfulServers: string[] = [];

  // Upload to all servers in parallel
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const result = await uploadBlob(data, mimeType, signer, server);
      if (result) {
        return server;
      }
      throw new Error(`Upload failed to ${server}`);
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      successfulServers.push(result.value);
    }
  }

  if (successfulServers.length === 0) {
    console.error("Failed to upload blob to any Blossom server");
    return null;
  }

  return { hash, servers: successfulServers };
}

/**
 * Delete a blob from a Blossom server
 *
 * @param sha256Hash - The SHA-256 hash of the blob (hex string)
 * @param signer - Nostr signer for authorization
 * @param serverUrl - The Blossom server URL
 * @returns true if deletion was successful, false otherwise
 */
export async function deleteBlob(
  sha256Hash: string,
  signer: BlossomSigner,
  serverUrl: string
): Promise<boolean> {
  try {
    const authEvent = await createBlossomAuthEvent(
      "delete",
      sha256Hash,
      signer
    );
    const authHeader = encodeAuthHeader(authEvent);

    const url = `${serverUrl.replace(/\/$/, "")}/${sha256Hash}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: authHeader,
      },
    });

    return response.ok;
  } catch (error) {
    console.error("Blossom delete error:", error);
    return false;
  }
}
