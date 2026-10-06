import type { BookRecord } from "./records";

/** Where the records live. Not main's `cashu_op_<id>`: a main tab still open
 *  on this origin lists and settles every key of that name, and shelves it at
 *  its sign out. Under `cashu_op:` it never reads them, and its sign-out wipe
 *  keeps them. */
export const PREFIX = "cashu_op:book_";

export type KeyValueStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

export const storedKeys = (storage: KeyValueStorage) =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i)!);

/** For tests, and for the server render, where there is no localStorage. */
export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** Every record of money in motion on this device, for every account. */
export class Journal {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: KeyValueStorage) {}

  /** Synchronous, so the record is on disk before the request that needs it
   *  leaves. Throws when storage is full, before anything is sent. */
  put(record: BookRecord): void {
    this.storage.setItem(PREFIX + record.id, JSON.stringify(record));
    this.changed();
  }

  remove(id: string): void {
    this.storage.removeItem(PREFIX + id);
    this.changed();
  }

  /** This account's records. */
  list(owner: string): BookRecord[] {
    return this.all().filter((record) => record.owner === owner);
  }

  /** Called after every change made in this tab. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lets listeners know another tab changed the journal. */
  changed(): void {
    this.listeners.forEach((listener) => listener());
  }

  private all(): BookRecord[] {
    return storedKeys(this.storage)
      .filter((key) => key.startsWith(PREFIX))
      .flatMap((key) => {
        try {
          const record = JSON.parse(this.storage.getItem(key) ?? "");
          return record && typeof record === "object" ? [record] : [];
        } catch {
          // an unreadable record is left in place for a person to look at
          return [];
        }
      });
  }
}
