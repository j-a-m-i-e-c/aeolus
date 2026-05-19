import type { Database as DatabaseType } from "better-sqlite3";
import type { EventEmitter } from "node:events";
import { DataStore, type DataStoreConfig } from "../data-store/data-store.js";

/**
 * Create a DataStore instance backed by the provided in-memory database.
 * Enabled by default with generous limits for testing.
 */
export function createTestDataStore(
  db: DatabaseType,
  eventBus: EventEmitter,
  config?: Partial<DataStoreConfig>,
): DataStore {
  return new DataStore(db, eventBus, {
    enabled: true,
    maxStorageMb: 100,
    maxRecordsPerCollection: 10_000,
    maxCollections: 50,
    ...config,
  });
}
