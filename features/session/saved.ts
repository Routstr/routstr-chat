import { openDB, type IDBPDatabase } from "idb";

/* The accounts and their keys are kept for good in IndexedDB; localStorage
   only mirrors them. A main tab left open from before the update still clears
   all of localStorage but its own shelf when someone signs out there, and
   IndexedDB is out of its reach. */

export interface Saved {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The saved copy in this browser's IndexedDB. */
export function savedInIndexedDB(): Saved {
  let db: Promise<IDBPDatabase> | undefined;
  const open = () =>
    (db ??= openDB("routstr-chat-session", 1, {
      upgrade: (store) => void store.createObjectStore("saved"),
    }));
  return {
    get: async (key) => (await open()).get("saved", key),
    put: async (key, value) => void (await open()).put("saved", value, key),
    delete: async (key) => (await open()).delete("saved", key),
  };
}
