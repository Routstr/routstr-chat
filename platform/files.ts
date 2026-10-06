import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { finalizeEvent } from "nostr-tools";
import type { FileStore, StoredFile } from "@/features/chat/ports";
import type { PnsKeys } from "@/lib/pns";
import { decryptBlob, encryptBlob } from "@/utils/blobEncryption";

// main's formats: the device's file database, the ids of copies a screen
// recovered from Blossom, and the device's file sync settings
interface FilesDb extends DBSchema {
  files: {
    key: string;
    value: { id: string; file: File; timestamp: number };
    indexes: { "by-date": number };
  };
}
const RECOVERED = "storage_id_mapping";
const SYNC = "blossomSyncEnabled";
const SERVERS = "blossomServers";
const DEFAULT_SERVERS = [
  "https://blossom.primal.net",
  "https://cdn.nostr.build",
];

// A reply is saved once its images are kept, so a server that never answers
// must not hold it (Stop ends the wait at once)
const UPLOAD_WAIT_MS = 30_000;

const trim = (server: string) => server.replace(/\/$/, "");

function toDataUrl(bytes: Uint8Array, type: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function fromDataUrl(url: string): {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
} {
  const [head, data] = url.split(",", 2);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, type: head.slice(5).replace(/;base64$/, "") };
}

/**
 * The one file store: files kept on this device, in main's `routstr-files`
 * database, and their copies on Blossom, encrypted with the account's history
 * key so its other devices can open them.
 */
export function createFileStore(deps: {
  /** The account's history keys, the one it writes with first; none while
   *  its history is locked. A copy opens with whichever key made it. */
  keys(): PnsKeys[];
  settings: Pick<Storage, "getItem">;
}): FileStore {
  let db: Promise<IDBPDatabase<FilesDb>> | undefined;
  const database = () =>
    (db ??= openDB<FilesDb>("routstr-files", 1, {
      upgrade(db) {
        db.createObjectStore("files", { keyPath: "id" }).createIndex(
          "by-date",
          "timestamp"
        );
      },
    }));

  const setting = <T>(key: string, fallback: T): T => {
    try {
      return JSON.parse(deps.settings.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  };
  // Blossom only while sync is on and the account's history is open
  const syncKeys = () => (setting(SYNC, true) ? deps.keys() : []);

  async function loadHere(storageId: string): Promise<string | undefined> {
    const id = setting<Record<string, string>>(RECOVERED, {})[storageId];
    try {
      const record = await (await database()).get("files", id ?? storageId);
      if (record) {
        const bytes = new Uint8Array(await record.file.arrayBuffer());
        return toDataUrl(bytes, record.file.type);
      }
    } catch (error) {
      console.warn("Could not read a file kept on this device", error);
    }
  }

  async function loadFromBlossom(
    hash: string,
    servers: string[],
    keys: PnsKeys[],
    signal: AbortSignal
  ): Promise<string | undefined> {
    for (const server of servers) {
      try {
        const response = await fetch(`${trim(server)}/${hash}`, { signal });
        if (!response.ok) continue;
        const blob = new Uint8Array(await response.arrayBuffer());
        for (const { pnsKey } of keys) {
          const file = decryptBlob(blob, pnsKey);
          if (file) return toDataUrl(file.data, file.mimeType);
        }
      } catch {
        if (signal.aborted) return undefined;
      }
    }
  }

  async function keepHere(bytes: Uint8Array<ArrayBuffer>, type: string) {
    try {
      const id = crypto.randomUUID();
      const file = new File([bytes], `file.${type.split("/")[1] ?? "bin"}`, {
        type,
      });
      await (
        await database()
      ).put("files", { id, file, timestamp: Date.now() });
      return id;
    } catch (error) {
      console.warn("Could not keep a file on this device", error);
    }
  }

  async function upload(
    bytes: Uint8Array,
    type: string,
    signal: AbortSignal
  ): Promise<StoredFile> {
    const [keys] = syncKeys();
    if (!keys) return {};
    // a fresh buffer (concatBytes), never a shared one
    const blob = encryptBlob(
      bytes,
      type,
      keys.pnsKey
    ) as Uint8Array<ArrayBuffer>;
    const hash = bytesToHex(sha256(blob));
    const now = Math.floor(Date.now() / 1000);
    const auth = finalizeEvent(
      {
        kind: 24242,
        created_at: now,
        tags: [
          ["t", "upload"],
          ["expiration", String(now + 3600)],
          ["x", hash],
        ],
        content: `Authorize upload for ${hash}`,
      },
      keys.pnsKeypair.privKey
    );
    const late = new AbortController();
    const timer = setTimeout(() => late.abort(), UPLOAD_WAIT_MS);
    const stop = AbortSignal.any([signal, late.signal]);
    const results = await Promise.allSettled(
      setting(SERVERS, DEFAULT_SERVERS).map(async (server) => {
        const response = await fetch(`${trim(server)}/upload`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Nostr ${btoa(JSON.stringify(auth))}`,
          },
          body: blob,
          signal: stop,
        });
        if (!response.ok)
          throw new Error(`${server} answered ${response.status}`);
        return server;
      })
    );
    clearTimeout(timer);
    const servers = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : []
    );
    return servers.length ? { blossomHash: hash, blossomServers: servers } : {};
  }

  return {
    async load({ storageId, blossomHash, blossomServers }, signal) {
      const here = storageId && (await loadHere(storageId));
      if (here) return here;
      const keys = syncKeys();
      if (!blossomHash || !keys.length) return undefined;
      const servers = blossomServers?.length
        ? blossomServers
        : setting(SERVERS, DEFAULT_SERVERS);
      return loadFromBlossom(blossomHash, servers, keys, signal);
    },

    async store(dataUrl, signal) {
      let file: ReturnType<typeof fromDataUrl>;
      try {
        file = fromDataUrl(dataUrl);
      } catch (error) {
        // a reply must still be saved without it
        console.warn("Could not read a file to keep it", error);
        return {};
      }
      const { bytes, type } = file;
      const [storageId, copies] = await Promise.all([
        keepHere(bytes, type),
        upload(bytes, type, signal),
      ]);
      return storageId ? { storageId, ...copies } : copies;
    },
  };
}
