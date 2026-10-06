// IndexedDB for node unit tests (fake-indexeddb). Call freshIndexedDBPerTest() at the top of a
// test file: every test then starts with its own empty IndexedDB, so no data leaks between
// tests or files. Code that grabbed `indexedDB` at import time keeps the old one, so read
// the global when you open a database, not at module load.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";

export function freshIndexedDBPerTest(): void {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
}
