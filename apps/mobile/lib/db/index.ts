/**
 * Database access.
 *
 * One connection, opened once and reused. Every read the reader performs goes
 * through here, so the reading experience never depends on the network.
 */
import * as SQLite from 'expo-sqlite';

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

const DATABASE_NAME = 'gita.db';

let database: SQLite.SQLiteDatabase | null = null;
let ready: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  // Concurrent callers during startup must not each open a connection.
  if (!ready) ready = open();
  database = await ready;
  return database;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(SCHEMA_SQL);
  await migrate(db);
  return db;
}

/**
 * Schema migrations.
 *
 * `user_version` is SQLite's own counter, so it survives an app update without
 * needing a table of our own. Canonical tables can always be rebuilt from the
 * server, so a migration that only touches those may drop and refill; anything
 * touching a `user_*` table has to preserve rows.
 */
async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  // v0 -> v1 is the initial schema, already applied by SCHEMA_SQL above.
  // Later versions add their steps here, each guarded by `current < n`.

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// --- Key/value app state --------------------------------------------------

export async function getState(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?',
    key,
    value,
    value,
  );
}

export async function getJsonState<T>(key: string, fallback: T): Promise<T> {
  const raw = await getState(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonState(key: string, value: unknown): Promise<void> {
  await setState(key, JSON.stringify(value));
}

export const STATE_KEYS = {
  contentVersion: 'content:version',
  contentSyncedAt: 'content:synced_at',
  readerPreferences: 'reader:preferences',
  lastRead: 'reader:last_read',
  syncCursor: 'sync:cursor',
  deviceId: 'device:id',
  streak: 'progress:streak',
  notificationPrefs: 'notifications:preferences',
} as const;

/** Wipe everything. Used by "reset app" in settings; never called implicitly. */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  database = null;
  ready = null;
}

export { SCHEMA_VERSION };
