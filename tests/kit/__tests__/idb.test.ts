import { describe, expect, it } from "vitest";
import { useFreshIndexedDB } from "../idb";

useFreshIndexedDB();

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("kit-check", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("s");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const run = <T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
) =>
  new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction("s", mode).objectStore("s"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

describe("useFreshIndexedDB", () => {
  it("stores and reads back", async () => {
    const db = await open();
    await run(db, "readwrite", (s) => s.put("coins", "k"));
    expect(await run(db, "readonly", (s) => s.get("k"))).toBe("coins");
  });

  it("starts the next test empty", async () => {
    const db = await open();
    expect(await run(db, "readonly", (s) => s.get("k"))).toBeUndefined();
  });
});
