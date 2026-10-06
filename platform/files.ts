import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { finalizeEvent } from "nostr-tools";
import {
  DEFAULT_FILE_SERVERS,
  type Files,
  type FileSync,
  type StoredFile,
} from "@/features/chat/ports";
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

// A message is saved once its files are kept, so a server that never answers
// must not hold it (Stop ends the wait at once). A copy the composer makes in
// the background holds nothing, so it waits as long as the upload takes.
const SAVE_WAIT_MS = 30_000;

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

/** A data URL's bytes, or undefined when it cannot be read: a message must
 *  still be saved without that file. */
function readable(dataUrl: string) {
  try {
    return fromDataUrl(dataUrl);
  } catch (error) {
    console.warn("Could not read a file to keep it", error);
    return undefined;
  }
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
  settings: Pick<Storage, "getItem" | "setItem">;
}): Files {
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
  const write = (key: string, value: unknown) => {
    try {
      deps.settings.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("Could not save a file setting", error);
    }
  };
  const readSync = (): FileSync => ({
    on: setting(SYNC, true),
    servers: setting(SERVERS, DEFAULT_FILE_SERVERS),
  });
  let sync = readSync();
  const listeners = new Set<() => void>();
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
  ) {
    for (const server of servers) {
      try {
        const response = await fetch(`${trim(server)}/${hash}`, { signal });
        if (!response.ok) continue;
        const blob = new Uint8Array(await response.arrayBuffer());
        for (const { pnsKey } of keys) {
          const file = decryptBlob(blob, pnsKey);
          if (file) return file;
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
    signal: AbortSignal,
    waitMs?: number
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
    // Stop or the wait, whichever comes first (AbortSignal.any is too new for
    // the browsers the app builds for)
    const stop = new AbortController();
    const end = () => stop.abort();
    const timer = waitMs === undefined ? undefined : setTimeout(end, waitMs);
    if (signal.aborted) end();
    else signal.addEventListener("abort", end, { once: true });
    const results = await Promise.allSettled(
      setting(SERVERS, DEFAULT_FILE_SERVERS).map(async (server) => {
        const response = await fetch(`${trim(server)}/upload`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Nostr ${btoa(JSON.stringify(auth))}`,
          },
          body: blob,
          signal: stop.signal,
        });
        if (!response.ok)
          throw new Error(`${server} answered ${response.status}`);
        return server;
      })
    );
    clearTimeout(timer);
    signal.removeEventListener("abort", end);
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
        : setting(SERVERS, DEFAULT_FILE_SERVERS);
      const file = await loadFromBlossom(blossomHash, servers, keys, signal);
      if (!file) return undefined;
      // kept here too, found next time under the message's own id
      if (storageId) {
        const bytes = new Uint8Array(file.data) as Uint8Array<ArrayBuffer>;
        void keepHere(bytes, file.mimeType).then((id) => {
          if (id) {
            write(RECOVERED, {
              ...setting<Record<string, string>>(RECOVERED, {}),
              [storageId]: id,
            });
          }
        });
      }
      return toDataUrl(file.data, file.mimeType);
    },

    async store(dataUrl, signal) {
      const file = readable(dataUrl);
      if (!file) return {};
      const [storageId, copies] = await Promise.all([
        keepHere(file.bytes, file.type),
        upload(file.bytes, file.type, signal, SAVE_WAIT_MS),
      ]);
      return storageId ? { storageId, ...copies } : copies;
    },

    async keep(dataUrl) {
      const file = readable(dataUrl);
      return file && keepHere(file.bytes, file.type);
    },

    async copy(dataUrl, signal) {
      const file = readable(dataUrl);
      return file ? upload(file.bytes, file.type, signal) : {};
    },

    sync: () => sync,

    setSync(change) {
      if (change.on !== undefined) write(SYNC, change.on);
      if (change.servers) write(SERVERS, change.servers);
      sync = readSync();
      listeners.forEach((listener) => listener());
    },

    subscribe(listener) {
      listeners.add(listener);
      // changed in another tab
      const heard = (event: StorageEvent) => {
        if (event.key !== SYNC && event.key !== SERVERS) return;
        sync = readSync();
        listener();
      };
      const tab = typeof window === "undefined" ? undefined : window;
      tab?.addEventListener("storage", heard);
      return () => {
        listeners.delete(listener);
        tab?.removeEventListener("storage", heard);
      };
    },
  };
}
