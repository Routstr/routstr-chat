import { SDK_STORAGE_KEYS } from "../keys";
import type { StorageDriver } from "../types";
import type { ListUsageTrackingOptions, UsageTrackingDriver } from "./interfaces";
import type { UsageTrackingEntry } from "./types";

type BetterSqlite3Database = {
  prepare: (sql: string) => {
    run: (...params: any[]) => { changes: number };
    get: (...params: any[]) => any;
    all: (...params: any[]) => any[];
  };
  exec: (sql: string) => void;
};

export interface SqliteUsageTrackingDriverOptions {
  dbPath?: string;
  tableName?: string;
  legacyStorageDriver?: StorageDriver;
}

const MIGRATION_MARKER_KEY = "usage_tracking_migration_v1";

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

const isBun = (): boolean => {
  return typeof process.versions.bun !== "undefined";
};

// Lazy-load better-sqlite3 to avoid bundling it for client-side code
let cachedDbModule: any = null;

const loadDatabase = async (dbPath: string): Promise<BetterSqlite3Database> => {
  if (isBun()) {
    throw new Error(
      "SQLite driver not supported in Bun. Use createMemoryDriver() instead."
    );
  }

  try {
    if (!cachedDbModule) {
      cachedDbModule = (await import("better-sqlite3")).default;
    }
    return new cachedDbModule(dbPath);
  } catch (error) {
    throw new Error(
      `better-sqlite3 is required for sqlite usage tracking. Install it to use sqlite storage. (${error})`
    );
  }
};

const buildWhereClause = (
  options: Omit<ListUsageTrackingOptions, "limit"> = {}
): { sql: string; params: unknown[] } => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (typeof options.before === "number") {
    clauses.push("timestamp < ?");
    params.push(options.before);
  }
  if (typeof options.after === "number") {
    clauses.push("timestamp > ?");
    params.push(options.after);
  }
  if (options.modelId) {
    clauses.push("model_id = ?");
    params.push(options.modelId);
  }
  if (options.baseUrl) {
    clauses.push("base_url = ?");
    params.push(normalizeBaseUrl(options.baseUrl));
  }
  if (options.sessionId) {
    clauses.push("session_id = ?");
    params.push(options.sessionId);
  }
  if (options.client) {
    clauses.push("client = ?");
    params.push(options.client);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
};

export const createSqliteUsageTrackingDriver = (
  options: SqliteUsageTrackingDriverOptions = {}
): UsageTrackingDriver => {
  const dbPath = options.dbPath || "routstr.sqlite";
  const tableName = options.tableName || "usage_tracking";
  const legacyStorageDriver = options.legacyStorageDriver;

  let db: BetterSqlite3Database;
  let insertStmt: any;
  let preparedStmts: { [key: string]: any } = {};

  const initDb = async () => {
    if (!db) {
      db = await loadDatabase(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          model_id TEXT NOT NULL,
          base_url TEXT NOT NULL,
          request_id TEXT NOT NULL,
          cost REAL NOT NULL,
          sats_cost REAL NOT NULL,
          prompt_tokens INTEGER NOT NULL,
          completion_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          client TEXT,
          session_id TEXT,
          tags TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_${tableName}_timestamp ON ${tableName}(timestamp);
        CREATE INDEX IF NOT EXISTS idx_${tableName}_model_id ON ${tableName}(model_id);
        CREATE INDEX IF NOT EXISTS idx_${tableName}_base_url ON ${tableName}(base_url);
        CREATE INDEX IF NOT EXISTS idx_${tableName}_session_id ON ${tableName}(session_id);
        CREATE INDEX IF NOT EXISTS idx_${tableName}_client ON ${tableName}(client);
      `);

      insertStmt = db.prepare(`
        INSERT OR REPLACE INTO ${tableName} (
          id, timestamp, model_id, base_url, request_id,
          cost, sats_cost, prompt_tokens, completion_tokens, total_tokens,
          client, session_id, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
  };

  // Lazy async initialization
  let initPromise: Promise<void> | null = null;
  const ensureInit = async () => {
    if (!initPromise) {
      initPromise = initDb();
    }
    await initPromise;
  };

  let migrationComplete = false;

  const appendOne = (entry: UsageTrackingEntry): void => {
    insertStmt.run(
      entry.id,
      entry.timestamp,
      entry.modelId,
      normalizeBaseUrl(entry.baseUrl),
      entry.requestId,
      entry.cost,
      entry.satsCost,
      entry.promptTokens,
      entry.completionTokens,
      entry.totalTokens,
      entry.client ?? null,
      entry.sessionId ?? null,
      JSON.stringify(entry.tags ?? [])
    );
  };

  const ensureMigrated = async (): Promise<void> => {
    if (!legacyStorageDriver || migrationComplete) return;

    const migrated = await legacyStorageDriver.getItem<boolean>(
      MIGRATION_MARKER_KEY,
      false
    );
    if (migrated) {
      migrationComplete = true;
      return;
    }

    const legacyEntries = await legacyStorageDriver.getItem<UsageTrackingEntry[]>(
      SDK_STORAGE_KEYS.USAGE_TRACKING,
      []
    );

    for (const entry of legacyEntries) {
      appendOne(entry);
    }

    if (legacyEntries.length > 0) {
      await legacyStorageDriver.removeItem(SDK_STORAGE_KEYS.USAGE_TRACKING);
    }
    await legacyStorageDriver.setItem(MIGRATION_MARKER_KEY, true);
    migrationComplete = true;
  };

  const mapRow = (row: any): UsageTrackingEntry => ({
    id: row.id,
    timestamp: row.timestamp,
    modelId: row.model_id,
    baseUrl: row.base_url,
    requestId: row.request_id,
    cost: row.cost,
    satsCost: row.sats_cost,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    client: row.client ?? undefined,
    sessionId: row.session_id ?? undefined,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : undefined,
  });

  const getStatement = (sql: string): any => {
    if (!preparedStmts[sql]) {
      preparedStmts[sql] = db.prepare(sql);
    }
    return preparedStmts[sql];
  };

  return {
    async migrate(): Promise<void> {
      await ensureInit();
      await ensureMigrated();
    },

    async append(entry: UsageTrackingEntry): Promise<void> {
      await ensureInit();
      await ensureMigrated();
      appendOne(entry);
    },

    async appendMany(entries: UsageTrackingEntry[]): Promise<void> {
      await ensureInit();
      await ensureMigrated();
      for (const entry of entries) {
        appendOne(entry);
      }
    },

    async list(options: ListUsageTrackingOptions = {}): Promise<UsageTrackingEntry[]> {
      await ensureInit();
      await ensureMigrated();
      const { sql, params } = buildWhereClause(options);
      const limitSql = typeof options.limit === "number" ? " LIMIT ?" : "";
      const stmt = getStatement(
        `SELECT * FROM ${tableName} ${sql} ORDER BY timestamp DESC${limitSql}`
      );
      const rows = stmt.all(
        ...(typeof options.limit === "number" ? [...params, options.limit] : params)
      );
      return rows.map(mapRow);
    },

    async count(options: Omit<ListUsageTrackingOptions, "limit"> = {}): Promise<number> {
      await ensureInit();
      await ensureMigrated();
      const { sql, params } = buildWhereClause(options);
      const stmt = getStatement(`SELECT COUNT(*) as count FROM ${tableName} ${sql}`);
      const row = stmt.get(...params);
      return Number(row?.count ?? 0);
    },

    async deleteOlderThan(timestamp: number): Promise<number> {
      await ensureInit();
      await ensureMigrated();
      const stmt = getStatement(`DELETE FROM ${tableName} WHERE timestamp < ?`);
      const result = stmt.run(timestamp);
      return result.changes;
    },

    async clear(): Promise<void> {
      await ensureInit();
      await ensureMigrated();
      getStatement(`DELETE FROM ${tableName}`).run();
    },
  };
};
