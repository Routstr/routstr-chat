import { openDB, DBSchema, IDBPDatabase } from "idb";

// Constants
const DB_NAME = "routstr-files";
const DB_VERSION = 1;
const MAX_FILE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

interface RoutstrFilesDB extends DBSchema {
  files: {
    key: string;
    value: {
      id: string;
      file: File;
      timestamp: number;
    };
    indexes: { "by-date": number };
  };
}

let dbPromise: Promise<IDBPDatabase<RoutstrFilesDB>> | null = null;
let cleanupInitialized = false;

/**
 * Initializes the IndexedDB database for file storage.
 * Creates the database and object store if they don't exist.
 * @returns Promise resolving to the database instance
 */
export const initDB = async (): Promise<IDBPDatabase<RoutstrFilesDB>> => {
  if (!dbPromise) {
    try {
      dbPromise = openDB<RoutstrFilesDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("files")) {
            const store = db.createObjectStore("files", { keyPath: "id" });
            store.createIndex("by-date", "timestamp");
          }
        },
      });

      // Initialize cleanup on first database access
      if (!cleanupInitialized) {
        cleanupInitialized = true;
        // Run cleanup in background, don't await
        clearOldFiles().catch((error) => {
          console.warn("Failed to clean up old files:", error);
        });
      }
    } catch (error) {
      dbPromise = null;
      throw new Error(
        `Failed to initialize IndexedDB: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }
  return dbPromise;
};

/**
 * Checks if there's enough storage quota available.
 * @param requiredBytes Number of bytes needed
 * @returns Promise resolving to true if enough quota is available
 */
export const checkStorageQuota = async (
  requiredBytes: number,
): Promise<boolean> => {
  if (!navigator.storage || !navigator.storage.estimate) {
    // If Storage API is not available, assume we have space
    return true;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;

    // Require at least 10MB buffer
    const available = quota - usage;
    return available > requiredBytes + 10 * 1024 * 1024;
  } catch (error) {
    console.warn("Failed to check storage quota:", error);
    return true; // Assume we have space if check fails
  }
};

/**
 * Saves a file to IndexedDB storage.
 * @param file The file to save
 * @returns Promise resolving to the unique storage ID
 * @throws Error if file is too large, storage quota is exceeded, or save fails
 */
export const saveFile = async (file: File): Promise<string> => {
  // Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File size (${(file.size / 1024 / 1024).toFixed(
        1,
      )}MB) exceeds maximum allowed size (${
        MAX_FILE_SIZE_BYTES / 1024 / 1024
      }MB)`,
    );
  }

  // Check storage quota
  const hasQuota = await checkStorageQuota(file.size);
  if (!hasQuota) {
    throw new Error(
      "Storage quota exceeded. Please clear some space or delete old files.",
    );
  }

  try {
    const db = await initDB();
    const id = crypto.randomUUID();
    await db.put("files", {
      id,
      file,
      timestamp: Date.now(),
    });
    return id;
  } catch (error) {
    if (error instanceof Error && error.message.includes("quota")) {
      throw new Error(
        "Storage quota exceeded. Please clear some space or delete old files.",
      );
    }
    throw new Error(
      `Failed to save file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
};

/**
 * Retrieves a file from IndexedDB storage.
 * @param id The unique storage ID of the file
 * @returns Promise resolving to the File object, or undefined if not found
 * @throws Error if retrieval fails
 */
export const getFile = async (id: string): Promise<File | undefined> => {
  try {
    const db = await initDB();
    const record = await db.get("files", id);
    return record?.file;
  } catch (error) {
    throw new Error(
      `Failed to retrieve file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
};

/**
 * Deletes a file from IndexedDB storage.
 * @param id The unique storage ID of the file to delete
 * @throws Error if deletion fails
 */
export const deleteFile = async (id: string): Promise<void> => {
  try {
    const db = await initDB();
    await db.delete("files", id);
  } catch (error) {
    throw new Error(
      `Failed to delete file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
};

/**
 * Clears files older than the specified age from IndexedDB storage.
 * @param maxAgeMs Maximum age in milliseconds (default: 7 days)
 * @returns Promise resolving to the number of files deleted
 * @throws Error if cleanup fails
 */
export const clearOldFiles = async (
  maxAgeMs: number = MAX_FILE_AGE_MS,
): Promise<number> => {
  try {
    const db = await initDB();
    const tx = db.transaction("files", "readwrite");
    const index = tx.store.index("by-date");
    const cutoff = Date.now() - maxAgeMs;

    let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
    let deletedCount = 0;

    while (cursor) {
      await cursor.delete();
      deletedCount++;
      cursor = await cursor.continue();
    }

    await tx.done;
    return deletedCount;
  } catch (error) {
    throw new Error(
      `Failed to clear old files: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
};

/**
 * Gets the total storage usage and quota information.
 * @returns Promise resolving to storage information
 */
export const getStorageInfo = async (): Promise<{
  usage: number;
  quota: number;
  available: number;
}> => {
  if (!navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0, available: 0 };
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const available = quota - usage;

    return { usage, quota, available };
  } catch (error) {
    console.warn("Failed to get storage info:", error);
    return { usage: 0, quota: 0, available: 0 };
  }
};
