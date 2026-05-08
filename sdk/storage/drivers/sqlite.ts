import type { StorageDriver } from "../types";
import type { SdkLogger } from "../../core/types";
import { consoleLogger } from "../../core/types";

type BetterSqlite3Database = {
  prepare: (sql: string) => {
    run: (...params: any[]) => { changes: number };
    get: (...params: any[]) => any;
  };
  exec: (sql: string) => void;
  close?: () => void;
};

export interface SqliteDriverOptions {
  dbPath?: string;
  tableName?: string;
}

const isBun = (): boolean => {
  return typeof process.versions.bun !== "undefined";
};

let cachedDbModule: any = null;

const loadDatabase = async (dbPath: string): Promise<BetterSqlite3Database> => {
  if (isBun()) {
    throw new Error(
      "SQLite driver not supported in Bun. Use createBunSqliteDriver() instead."
    );
  }

  try {
    if (!cachedDbModule) {
      cachedDbModule = (await import("better-sqlite3")).default;
    }
    return new cachedDbModule(dbPath);
  } catch (error) {
    throw new Error(
      `better-sqlite3 is required for sqlite storage. Install it to use sqlite storage. (${error})`
    );
  }
};

export const createSqliteDriver = (
  options: SqliteDriverOptions = {}
): StorageDriver => {
  const dbPath = options.dbPath || "routstr.sqlite";
  const tableName = options.tableName || "sdk_storage";

  let db: BetterSqlite3Database;
  let selectStmt: any;
  let upsertStmt: any;
  let deleteStmt: any;

  const initDb = async () => {
    if (!db) {
      db = await loadDatabase(dbPath);
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
      );

      selectStmt = db.prepare(`SELECT value FROM ${tableName} WHERE key = ?`);
      upsertStmt = db.prepare(
        `INSERT INTO ${tableName} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE key = ?`);
    }
  };

  const ensureInit = async () => {
    if (!db) {
      await initDb();
    }
  };

  return {
    async getItem<T>(key: string, defaultValue: T): Promise<T> {
      try {
        await ensureInit();
        const row = selectStmt.get(key);
        if (!row || typeof row.value !== "string") return defaultValue;
        try {
          return JSON.parse(row.value) as T;
        } catch (parseError) {
          if (typeof defaultValue === "string") {
            return row.value as T;
          }
          throw parseError;
        }
      } catch (error) {
        console.error(`SQLite getItem failed for key "${key}":`, error);
        return defaultValue;
      }
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      try {
        await ensureInit();
        upsertStmt.run(key, JSON.stringify(value));
      } catch (error) {
        console.error(`SQLite setItem failed for key "${key}":`, error);
      }
    },
    async removeItem(key: string): Promise<void> {
      try {
        await ensureInit();
        deleteStmt.run(key);
      } catch (error) {
        console.error(`SQLite removeItem failed for key "${key}":`, error);
      }
    },
  };
};

// Bun-specific SQLite driver - requires bun:sqlite at runtime
// This function is only meant to be used in Bun environments
export async function createBunSqliteDriver(
  dbPath: string,
  options?: { logger?: SdkLogger }
): Promise<StorageDriver> {
  const logger = (options?.logger ?? consoleLogger).child("BunSqliteDriver");
  // @ts-ignore - bun:sqlite is only available at runtime in Bun environments
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const SQLite = (await import(/* webpackIgnore: true */ "bun:sqlite")).default;
  const db = new SQLite(dbPath);

  db.run(`
    CREATE TABLE IF NOT EXISTS sdk_storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  return {
    async getItem<T>(key: string, defaultValue: T): Promise<T> {
      try {
        const row = db
          .query("SELECT value FROM sdk_storage WHERE key = ?")
          .get(key) as { value: string } | undefined;
        if (!row || typeof row.value !== "string") return defaultValue;
        try {
          return JSON.parse(row.value) as T;
        } catch (parseError) {
          if (typeof defaultValue === "string") {
            return row.value as T;
          }
          throw parseError;
        }
      } catch (error) {
        logger.error(`getItem failed for key "${key}":`, error);
        return defaultValue;
      }
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      try {
        db.query(
          "INSERT INTO sdk_storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(key, JSON.stringify(value));
      } catch (error) {
        logger.error(`setItem failed for key "${key}":`, error);
      }
    },
    async removeItem(key: string): Promise<void> {
      try {
        db.query("DELETE FROM sdk_storage WHERE key = ?").run(key);
      } catch (error) {
        logger.error(`removeItem failed for key "${key}":`, error);
      }
    },
  };
}
