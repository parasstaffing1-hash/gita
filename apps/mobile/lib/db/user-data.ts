/**
 * The reader's own data: bookmarks, highlights, notes, collections, progress.
 *
 * Everything here works signed out. Rows are written locally with a
 * client-generated id and `dirty = 1`; if there is an account, the sync layer
 * later pushes them and clears the flag. Deletes are tombstones so a removal
 * propagates instead of the row reappearing from another device.
 */
import { getDatabase } from './index';

function uuid(): string {
  // crypto.randomUUID exists in Hermes on modern React Native; the fallback
  // keeps this working on older runtimes rather than throwing at write time.
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const now = () => new Date().toISOString();

// --- Bookmarks ------------------------------------------------------------

export interface Bookmark {
  id: string;
  verseRef: string;
  note: string | null;
  createdAt: string;
}

export async function listBookmarks(): Promise<Bookmark[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT id, verse_ref, note, created_at FROM user_bookmarks
     WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    verseRef: row.verse_ref,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export async function isBookmarked(verseRef: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM user_bookmarks WHERE verse_ref = ? AND deleted_at IS NULL',
    verseRef,
  );
  return (row?.n ?? 0) > 0;
}

/** Returns the state after toggling, so the caller can update the icon. */
export async function toggleBookmark(verseRef: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string; revision: number }>(
    'SELECT id, revision FROM user_bookmarks WHERE verse_ref = ? AND deleted_at IS NULL',
    verseRef,
  );

  if (existing) {
    // A tombstone, not a DELETE: the removal has to reach other devices.
    await db.runAsync(
      `UPDATE user_bookmarks
       SET deleted_at = ?, updated_at = ?, revision = ?, dirty = 1 WHERE id = ?`,
      now(),
      now(),
      existing.revision + 1,
      existing.id,
    );
    return false;
  }

  await db.runAsync(
    `INSERT INTO user_bookmarks (id, verse_ref, created_at, updated_at, revision, dirty)
     VALUES (?, ?, ?, ?, 1, 1)`,
    uuid(),
    verseRef,
    now(),
    now(),
  );
  return true;
}

// --- Highlights -----------------------------------------------------------

export type HighlightColor = 'saffron' | 'gold' | 'sage' | 'sky' | 'rose';

export async function listHighlights(verseRef?: string) {
  const db = await getDatabase();
  const rows = verseRef
    ? await db.getAllAsync<any>(
        'SELECT * FROM user_highlights WHERE verse_ref = ? AND deleted_at IS NULL',
        verseRef,
      )
    : await db.getAllAsync<any>(
        'SELECT * FROM user_highlights WHERE deleted_at IS NULL ORDER BY created_at DESC',
      );
  return rows.map((row) => ({
    id: row.id,
    verseRef: row.verse_ref,
    target: row.target as 'sanskrit' | 'transliteration' | 'translation' | 'commentary',
    color: row.color as HighlightColor,
  }));
}

export async function setHighlight(
  verseRef: string,
  target: string,
  color: HighlightColor | null,
): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string; revision: number }>(
    'SELECT id, revision FROM user_highlights WHERE verse_ref = ? AND target = ? AND deleted_at IS NULL',
    verseRef,
    target,
  );

  if (color === null) {
    if (existing) {
      await db.runAsync(
        'UPDATE user_highlights SET deleted_at = ?, updated_at = ?, revision = ?, dirty = 1 WHERE id = ?',
        now(),
        now(),
        existing.revision + 1,
        existing.id,
      );
    }
    return;
  }

  if (existing) {
    await db.runAsync(
      'UPDATE user_highlights SET color = ?, updated_at = ?, revision = ?, dirty = 1 WHERE id = ?',
      color,
      now(),
      existing.revision + 1,
      existing.id,
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO user_highlights (id, verse_ref, target, color, created_at, updated_at, revision, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    uuid(),
    verseRef,
    target,
    color,
    now(),
    now(),
  );
}

// --- Notes ----------------------------------------------------------------

export interface Note {
  id: string;
  verseRef: string | null;
  body: string;
  tags: string[];
  isPrivate: boolean;
  updatedAt: string;
}

export async function listNotes(verseRef?: string): Promise<Note[]> {
  const db = await getDatabase();
  const rows = verseRef
    ? await db.getAllAsync<any>(
        'SELECT * FROM user_notes WHERE verse_ref = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
        verseRef,
      )
    : await db.getAllAsync<any>(
        'SELECT * FROM user_notes WHERE deleted_at IS NULL ORDER BY updated_at DESC',
      );
  return rows.map((row) => ({
    id: row.id,
    verseRef: row.verse_ref,
    body: row.body,
    tags: JSON.parse(row.tags || '[]'),
    isPrivate: row.is_private === 1,
    updatedAt: row.updated_at,
  }));
}

export async function saveNote(
  input: { id?: string; verseRef: string | null; body: string; tags?: string[] },
): Promise<string> {
  const db = await getDatabase();
  const body = input.body.trim();
  if (!body) throw new Error('A note needs some text.');

  if (input.id) {
    const existing = await db.getFirstAsync<{ revision: number }>(
      'SELECT revision FROM user_notes WHERE id = ?',
      input.id,
    );
    await db.runAsync(
      'UPDATE user_notes SET body = ?, tags = ?, updated_at = ?, revision = ?, dirty = 1 WHERE id = ?',
      body,
      JSON.stringify(input.tags ?? []),
      now(),
      (existing?.revision ?? 1) + 1,
      input.id,
    );
    return input.id;
  }

  const id = uuid();
  await db.runAsync(
    `INSERT INTO user_notes (id, verse_ref, body, tags, is_private, created_at, updated_at, revision, dirty)
     VALUES (?, ?, ?, ?, 1, ?, ?, 1, 1)`,
    id,
    input.verseRef,
    body,
    JSON.stringify(input.tags ?? []),
    now(),
    now(),
  );
  return id;
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ revision: number }>(
    'SELECT revision FROM user_notes WHERE id = ?',
    id,
  );
  await db.runAsync(
    'UPDATE user_notes SET deleted_at = ?, updated_at = ?, revision = ?, dirty = 1 WHERE id = ?',
    now(),
    now(),
    (existing?.revision ?? 1) + 1,
    id,
  );
}

// --- Collections ----------------------------------------------------------

export async function listCollections() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT c.*, (
        SELECT COUNT(*) FROM user_collection_items i
        WHERE i.collection_id = c.id AND i.deleted_at IS NULL
      ) AS item_count
     FROM user_collections c
     WHERE c.deleted_at IS NULL
     ORDER BY c.sort_order, c.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    isSystem: row.is_system === 1,
    itemCount: row.item_count as number,
  }));
}

/**
 * Every install starts with these, so "add to collection" is useful straight
 * away rather than asking the reader to invent structure first.
 */
export async function ensureDefaultCollections(): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM user_collections WHERE is_system = 1',
  );
  if ((row?.n ?? 0) > 0) return;

  const defaults = ['Favorites', 'Memorize', 'Difficult Times'];
  for (const [index, name] of defaults.entries()) {
    await db.runAsync(
      `INSERT INTO user_collections (id, name, is_system, sort_order, created_at, updated_at, revision, dirty)
       VALUES (?, ?, 1, ?, ?, ?, 1, 1)`,
      uuid(),
      name,
      index,
      now(),
      now(),
    );
  }
}

export async function createCollection(name: string): Promise<string> {
  const db = await getDatabase();
  const id = uuid();
  await db.runAsync(
    `INSERT INTO user_collections (id, name, created_at, updated_at, revision, dirty)
     VALUES (?, ?, ?, ?, 1, 1)`,
    id,
    name.trim(),
    now(),
    now(),
  );
  return id;
}

export async function addToCollection(collectionId: string, verseRef: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO user_collection_items (id, collection_id, verse_ref, created_at, updated_at, revision, dirty)
     VALUES (?, ?, ?, ?, ?, 1, 1)
     ON CONFLICT (collection_id, verse_ref)
     DO UPDATE SET deleted_at = NULL, updated_at = ?, revision = revision + 1, dirty = 1`,
    uuid(),
    collectionId,
    verseRef,
    now(),
    now(),
    now(),
  );
}

export async function listCollectionItems(collectionId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ verse_ref: string }>(
    `SELECT verse_ref FROM user_collection_items
     WHERE collection_id = ? AND deleted_at IS NULL ORDER BY position, created_at`,
    collectionId,
  );
  return rows.map((row) => row.verse_ref);
}

// --- Reading progress -----------------------------------------------------

export async function recordVerseRead(chapter: number, verse: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO user_reading_progress
       (chapter_number, last_verse_number, verses_read, updated_at, revision, dirty)
     VALUES (?, ?, 1, ?, 1, 1)
     ON CONFLICT (chapter_number) DO UPDATE SET
       last_verse_number = MAX(last_verse_number, ?),
       verses_read = verses_read + 1,
       updated_at = ?,
       revision = revision + 1,
       dirty = 1`,
    chapter,
    verse,
    now(),
    verse,
    now(),
  );
}

export async function listReadingProgress() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM user_reading_progress ORDER BY updated_at DESC',
  );
  return rows.map((row) => ({
    chapterNumber: row.chapter_number,
    lastVerseNumber: row.last_verse_number,
    versesRead: row.verses_read,
    updatedAt: row.updated_at,
  }));
}

export async function getContinueReading(): Promise<{ chapter: number; verse: number } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT chapter_number, last_verse_number FROM user_reading_progress ORDER BY updated_at DESC LIMIT 1',
  );
  if (!row) return null;
  return { chapter: row.chapter_number, verse: row.last_verse_number };
}

// --- Memorisation ---------------------------------------------------------

export async function listMemorization() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM user_memorization ORDER BY updated_at DESC',
  );
  return rows.map((row) => ({
    id: row.id,
    verseRef: row.verse_ref,
    stage: row.stage as 'learning' | 'reviewing' | 'memorized',
    repetitions: row.repetitions as number,
    hideLevel: row.hide_level as number,
  }));
}

export async function startMemorizing(verseRef: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO user_memorization (id, verse_ref, stage, updated_at, revision, dirty)
     VALUES (?, ?, 'learning', ?, 1, 1)
     ON CONFLICT (verse_ref) DO NOTHING`,
    uuid(),
    verseRef,
    now(),
  );
}

/**
 * Record a review.
 *
 * Only the counters move today. The SM-2 fields are already in the schema, so
 * turning on real spaced repetition later means changing this function, not
 * migrating anyone's data.
 */
export async function recordMemorizationReview(
  verseRef: string,
  outcome: 'again' | 'good',
): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM user_memorization WHERE verse_ref = ?',
    verseRef,
  );
  if (!row) return;

  const repetitions = outcome === 'good' ? row.repetitions + 1 : 0;
  const hideLevel =
    outcome === 'good' ? Math.min(100, row.hide_level + 20) : Math.max(0, row.hide_level - 20);
  const stage = repetitions >= 5 ? 'memorized' : repetitions >= 2 ? 'reviewing' : 'learning';

  await db.runAsync(
    `UPDATE user_memorization
     SET repetitions = ?, hide_level = ?, stage = ?, last_reviewed_at = ?,
         updated_at = ?, revision = revision + 1, dirty = 1
     WHERE verse_ref = ?`,
    repetitions,
    hideLevel,
    stage,
    now(),
    now(),
    verseRef,
  );
}

// --- Sync support ---------------------------------------------------------

/** Everything changed locally since the last successful push. */
export async function collectDirtyChanges() {
  const db = await getDatabase();
  const entities = [
    ['bookmarks', 'user_bookmarks'],
    ['highlights', 'user_highlights'],
    ['notes', 'user_notes'],
    ['collections', 'user_collections'],
    ['collection_items', 'user_collection_items'],
    ['memorization_progress', 'user_memorization'],
  ] as const;

  const changes: Array<{
    entity: string;
    clientId: string;
    revision: number;
    updatedAt: string;
    deleted: boolean;
    payload: Record<string, unknown>;
  }> = [];

  for (const [entity, table] of entities) {
    const rows = await db.getAllAsync<any>(`SELECT * FROM ${table} WHERE dirty = 1 LIMIT 200`);
    for (const row of rows) {
      const { id, updated_at: updatedAt, deleted_at: deletedAt, revision, dirty, ...rest } = row;
      changes.push({
        entity,
        clientId: id,
        revision,
        updatedAt,
        deleted: Boolean(deletedAt),
        payload: rest,
      });
    }
  }
  return changes;
}

export async function markSynced(entity: string, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const table = {
    bookmarks: 'user_bookmarks',
    highlights: 'user_highlights',
    notes: 'user_notes',
    collections: 'user_collections',
    collection_items: 'user_collection_items',
    memorization_progress: 'user_memorization',
  }[entity];
  if (!table) return;

  const db = await getDatabase();
  const placeholders = clientIds.map(() => '?').join(',');
  await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE id IN (${placeholders})`, ...clientIds);
}
