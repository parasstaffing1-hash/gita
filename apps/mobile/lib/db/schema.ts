/**
 * The on-device database.
 *
 * The whole Gita has to be readable with no network, so canonical content is
 * mirrored into SQLite and read from there — the API is only ever a source for
 * *filling* this, never something the reader waits on.
 *
 * Two classes of table live here and they behave differently:
 *
 *   canonical_*  — a local copy of server content. Replaceable at any time,
 *                  never edited on device, wiped and refilled on a content
 *                  update.
 *   user_*       — the reader's own bookmarks, notes, highlights and progress.
 *                  Created locally, survives content updates, and syncs with
 *                  the server when there is an account.
 *
 * Every user row carries a client-generated UUID primary key, a `revision`
 * counter and a `dirty` flag. That is what lets a bookmark made on a plane keep
 * its identity when it finally reaches the server, and lets the sync layer tell
 * "changed here" from "already sent".
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Canonical content (read-only mirror of the server)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canonical_chapters (
  number               INTEGER PRIMARY KEY,
  slug                 TEXT    NOT NULL,
  name_sanskrit        TEXT,
  name_transliteration TEXT,
  name_english         TEXT    NOT NULL,
  name_hindi           TEXT,
  verse_count          INTEGER NOT NULL,
  summary              TEXT,
  major_teachings      TEXT    NOT NULL DEFAULT '[]',
  key_concepts         TEXT    NOT NULL DEFAULT '[]',
  key_verses           TEXT    NOT NULL DEFAULT '[]',
  verification_status  TEXT    NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS canonical_verses (
  id                   TEXT    PRIMARY KEY,
  chapter_number       INTEGER NOT NULL,
  verse_number         INTEGER NOT NULL,
  verse_number_end     INTEGER,
  ref                  TEXT    NOT NULL,
  -- Position across the whole text, 1..700. Makes prev/next one indexed read.
  ordinal              INTEGER NOT NULL,
  speaker              TEXT,
  sanskrit             TEXT,
  transliteration      TEXT,
  translation_en       TEXT,
  translation_hi       TEXT,
  -- Denormalised JSON: the reader needs these together and joining four tables
  -- on every swipe is measurably slower on a low-end phone.
  words_json           TEXT    NOT NULL DEFAULT '[]',
  commentaries_json    TEXT    NOT NULL DEFAULT '[]',
  topics_json          TEXT    NOT NULL DEFAULT '[]',
  canonical_hash       TEXT,
  verification_status  TEXT    NOT NULL DEFAULT 'draft',
  UNIQUE (chapter_number, verse_number)
);

CREATE INDEX IF NOT EXISTS ix_verses_ordinal  ON canonical_verses (ordinal);
CREATE INDEX IF NOT EXISTS ix_verses_chapter  ON canonical_verses (chapter_number, verse_number);

-- Offline search. FTS5 over the folded skeleton plus the readable text, so a
-- query works the same on a plane as it does online.
CREATE VIRTUAL TABLE IF NOT EXISTS canonical_verses_fts USING fts5(
  ref,
  search_key,
  body,
  content=''
);

CREATE TABLE IF NOT EXISTS canonical_topics (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  name_hindi        TEXT,
  category          TEXT NOT NULL,
  icon              TEXT,
  short_description TEXT,
  introduction      TEXT,
  verse_refs        TEXT NOT NULL DEFAULT '[]',
  sort_order        INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS canonical_glossary (
  slug                 TEXT PRIMARY KEY,
  term_sanskrit        TEXT NOT NULL,
  term_transliteration TEXT NOT NULL,
  term_english         TEXT,
  search_key           TEXT NOT NULL,
  simple_definition    TEXT NOT NULL,
  detailed_definition  TEXT,
  variants             TEXT NOT NULL DEFAULT '[]',
  related_verse_refs   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS canonical_plans (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  description   TEXT,
  duration_days INTEGER NOT NULL,
  level         TEXT NOT NULL DEFAULT 'beginner',
  days_json     TEXT NOT NULL DEFAULT '[]'
);

-- Audio the device has downloaded. The file itself lives on disk; this is the
-- catalogue the downloads screen and the player read.
CREATE TABLE IF NOT EXISTS canonical_audio (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  chapter_number INTEGER,
  verse_number   INTEGER,
  language_code  TEXT NOT NULL DEFAULT 'sa',
  reciter        TEXT,
  is_synthetic   INTEGER NOT NULL DEFAULT 0,
  remote_url     TEXT,
  local_uri      TEXT,
  duration_secs  INTEGER,
  size_bytes     INTEGER,
  downloaded_at  TEXT
);

CREATE INDEX IF NOT EXISTS ix_audio_lookup ON canonical_audio (kind, chapter_number, verse_number);

-- ---------------------------------------------------------------------------
-- User content (created here, synced when signed in)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_bookmarks (
  id         TEXT PRIMARY KEY,
  verse_ref  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision   INTEGER NOT NULL DEFAULT 1,
  dirty      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bookmarks_ref ON user_bookmarks (verse_ref)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_highlights (
  id         TEXT PRIMARY KEY,
  verse_ref  TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT 'translation',
  color      TEXT NOT NULL DEFAULT 'saffron',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision   INTEGER NOT NULL DEFAULT 1,
  dirty      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_notes (
  id         TEXT PRIMARY KEY,
  verse_ref  TEXT,
  body       TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  -- Private by default. Never included in an analytics event or an AI prompt.
  is_private INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision   INTEGER NOT NULL DEFAULT 1,
  dirty      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  revision    INTEGER NOT NULL DEFAULT 1,
  dirty       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES user_collections (id) ON DELETE CASCADE,
  verse_ref     TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  revision      INTEGER NOT NULL DEFAULT 1,
  dirty         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (collection_id, verse_ref)
);

CREATE TABLE IF NOT EXISTS user_reading_progress (
  chapter_number    INTEGER PRIMARY KEY,
  last_verse_number INTEGER NOT NULL DEFAULT 1,
  verses_read       INTEGER NOT NULL DEFAULT 0,
  completed_at      TEXT,
  updated_at        TEXT NOT NULL,
  revision          INTEGER NOT NULL DEFAULT 1,
  dirty             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_memorization (
  id               TEXT PRIMARY KEY,
  verse_ref        TEXT NOT NULL UNIQUE,
  stage            TEXT NOT NULL DEFAULT 'learning',
  repetitions      INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  -- Reserved so spaced repetition can be switched on without a migration.
  next_review_at   TEXT,
  ease_factor      REAL NOT NULL DEFAULT 2.5,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  hide_level       INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 1,
  dirty            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_plan_progress (
  plan_slug      TEXT PRIMARY KEY,
  started_at     TEXT NOT NULL,
  completed_days TEXT NOT NULL DEFAULT '[]',
  current_day    INTEGER NOT NULL DEFAULT 1,
  completed_at   TEXT,
  updated_at     TEXT NOT NULL,
  revision       INTEGER NOT NULL DEFAULT 1,
  dirty          INTEGER NOT NULL DEFAULT 1
);

-- Small key/value store for things that are not worth a table: reader
-- preferences, the sync cursor, the content version, the streak.
CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Rows that hold user data — never dropped by a content refresh. */
export const USER_TABLES = [
  'user_bookmarks',
  'user_highlights',
  'user_notes',
  'user_collections',
  'user_collection_items',
  'user_reading_progress',
  'user_memorization',
  'user_plan_progress',
] as const;

/** Rows that mirror the server — safe to wipe and refill. */
export const CANONICAL_TABLES = [
  'canonical_chapters',
  'canonical_verses',
  'canonical_topics',
  'canonical_glossary',
  'canonical_plans',
] as const;
