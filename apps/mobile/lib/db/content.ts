/**
 * Local content queries.
 *
 * The reader reads from here, always. Nothing on this path touches the
 * network, so a verse opens at the same speed on a train as on wifi.
 */
import type { Chapter, TopicSummary, VerseSummary } from '@gita/types';

import { getDatabase } from './index';

export interface LocalVerse {
  id: string;
  chapterNumber: number;
  verseNumber: number;
  verseNumberEnd: number | null;
  ref: string;
  ordinal: number;
  speaker: string | null;
  sanskrit: string | null;
  transliteration: string | null;
  translationEn: string | null;
  translationHi: string | null;
  words: Array<{
    position: number;
    wordDevanagari: string;
    wordTransliteration: string | null;
    meaningEnglish: string | null;
  }>;
  commentaries: Array<{ commentatorName: string | null; text: string; languageCode: string }>;
  topics: Array<{ slug: string; name: string }>;
  canonicalHash: string | null;
  verificationStatus: string;
}

interface VerseRow {
  id: string;
  chapter_number: number;
  verse_number: number;
  verse_number_end: number | null;
  ref: string;
  ordinal: number;
  speaker: string | null;
  sanskrit: string | null;
  transliteration: string | null;
  translation_en: string | null;
  translation_hi: string | null;
  words_json: string;
  commentaries_json: string;
  topics_json: string;
  canonical_hash: string | null;
  verification_status: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toVerse(row: VerseRow): LocalVerse {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    verseNumber: row.verse_number,
    verseNumberEnd: row.verse_number_end,
    ref: row.ref,
    ordinal: row.ordinal,
    speaker: row.speaker,
    sanskrit: row.sanskrit,
    transliteration: row.transliteration,
    translationEn: row.translation_en,
    translationHi: row.translation_hi,
    words: parseJson(row.words_json, []),
    commentaries: parseJson(row.commentaries_json, []),
    topics: parseJson(row.topics_json, []),
    canonicalHash: row.canonical_hash,
    verificationStatus: row.verification_status,
  };
}

// --- Chapters -------------------------------------------------------------

export interface LocalChapter extends Omit<Chapter, 'keyVerses' | 'audioTrackId' | 'summaryHindi'> {
  keyVerseRefs: string[];
}

export async function listChapters(): Promise<LocalChapter[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, never>>(
    'SELECT * FROM canonical_chapters ORDER BY number',
  );
  return rows.map((row: any) => ({
    id: String(row.number),
    number: row.number,
    slug: row.slug,
    nameSanskrit: row.name_sanskrit,
    nameTransliteration: row.name_transliteration,
    nameEnglish: row.name_english,
    nameHindi: row.name_hindi,
    verseCount: row.verse_count,
    summary: row.summary,
    majorTeachings: parseJson<string[]>(row.major_teachings, []),
    keyConcepts: parseJson<string[]>(row.key_concepts, []),
    keyVerseRefs: parseJson<string[]>(row.key_verses, []),
    verificationStatus: row.verification_status,
  })) as LocalChapter[];
}

export async function getChapter(number: number): Promise<LocalChapter | null> {
  const chapters = await listChapters();
  return chapters.find((chapter) => chapter.number === number) ?? null;
}

// --- Verses ---------------------------------------------------------------

export async function getVerse(chapter: number, verse: number): Promise<LocalVerse | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<VerseRow>(
    'SELECT * FROM canonical_verses WHERE chapter_number = ? AND verse_number = ?',
    chapter,
    verse,
  );
  return row ? toVerse(row) : null;
}

export async function listChapterVerses(chapter: number): Promise<LocalVerse[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<VerseRow>(
    'SELECT * FROM canonical_verses WHERE chapter_number = ? ORDER BY verse_number',
    chapter,
  );
  return rows.map(toVerse);
}

export async function getVersesByRefs(refs: string[]): Promise<LocalVerse[]> {
  if (refs.length === 0) return [];
  const db = await getDatabase();
  const placeholders = refs.map(() => '?').join(',');
  const rows = await db.getAllAsync<VerseRow>(
    `SELECT * FROM canonical_verses WHERE ref IN (${placeholders}) ORDER BY ordinal`,
    ...refs,
  );
  return rows.map(toVerse);
}

/**
 * The verse at a given position in the whole text.
 *
 * Ordinal-based rather than chapter-relative, so paging the reader across a
 * chapter boundary is the same operation as paging within one.
 */
export async function getVerseByOrdinal(ordinal: number): Promise<LocalVerse | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<VerseRow>(
    'SELECT * FROM canonical_verses WHERE ordinal = ?',
    ordinal,
  );
  return row ? toVerse(row) : null;
}

export async function countVerses(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM canonical_verses');
  return row?.n ?? 0;
}

/** A deterministic verse for a date: same day, same verse, on every device. */
export async function getDailyVerse(dateKey: string): Promise<LocalVerse | null> {
  const total = await countVerses();
  if (total === 0) return null;

  // A small string hash, so the sequence does not simply walk the text in order.
  let hash = 0;
  for (let index = 0; index < dateKey.length; index += 1) {
    hash = (hash * 31 + dateKey.charCodeAt(index)) >>> 0;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<VerseRow>(
    'SELECT * FROM canonical_verses ORDER BY ordinal LIMIT 1 OFFSET ?',
    hash % total,
  );
  return row ? toVerse(row) : null;
}

// --- Offline search -------------------------------------------------------

/**
 * Search the local copy.
 *
 * `foldedQuery` must come from the same `transliterationSkeleton` the indexer
 * used, or "krsna" stops matching "कृष्ण" offline while still matching online.
 */
export async function searchVerses(
  rawQuery: string,
  foldedQuery: string,
  limit = 30,
): Promise<LocalVerse[]> {
  const db = await getDatabase();

  // A direct reference short-circuits everything else.
  const referenceMatch = rawQuery.trim().match(/^(\d{1,2})[.: -](\d{1,3})$/);
  if (referenceMatch) {
    const verse = await getVerse(
      Number.parseInt(referenceMatch[1] as string, 10),
      Number.parseInt(referenceMatch[2] as string, 10),
    );
    if (verse) return [verse];
  }

  const terms = foldedQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  // FTS5 prefix match on each term, ORed so a question still returns results.
  const ftsQuery = terms.map((term) => `"${term.replace(/"/g, '')}"*`).join(' OR ');

  const rows = await db.getAllAsync<VerseRow>(
    `SELECT v.* FROM canonical_verses_fts f
     JOIN canonical_verses v ON v.ref = f.ref
     WHERE canonical_verses_fts MATCH ?
     ORDER BY bm25(canonical_verses_fts), v.ordinal
     LIMIT ?`,
    ftsQuery,
    limit,
  );
  return rows.map(toVerse);
}

// --- Topics and glossary --------------------------------------------------

export async function listTopics(category?: string): Promise<TopicSummary[]> {
  const db = await getDatabase();
  const rows = category
    ? await db.getAllAsync<any>(
        'SELECT * FROM canonical_topics WHERE category = ? ORDER BY sort_order, name',
        category,
      )
    : await db.getAllAsync<any>('SELECT * FROM canonical_topics ORDER BY sort_order, name');

  return rows.map((row) => ({
    id: row.slug,
    slug: row.slug,
    name: row.name,
    nameHindi: row.name_hindi,
    category: row.category,
    shortDescription: row.short_description,
    verseCount: parseJson<string[]>(row.verse_refs, []).length,
    icon: row.icon,
  }));
}

export async function getTopic(slug: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM canonical_topics WHERE slug = ?', slug);
  if (!row) return null;
  const refs = parseJson<string[]>(row.verse_refs, []);
  return {
    slug: row.slug,
    name: row.name,
    nameHindi: row.name_hindi,
    category: row.category,
    icon: row.icon,
    shortDescription: row.short_description,
    introduction: row.introduction,
    verses: await getVersesByRefs(refs),
  };
}

export async function listGlossary() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM canonical_glossary ORDER BY term_transliteration',
  );
  return rows.map((row) => ({
    slug: row.slug,
    termSanskrit: row.term_sanskrit,
    termTransliteration: row.term_transliteration,
    termEnglish: row.term_english,
    simpleDefinition: row.simple_definition,
    detailedDefinition: row.detailed_definition,
    variants: parseJson<string[]>(row.variants, []),
    relatedVerseRefs: parseJson<string[]>(row.related_verse_refs, []),
  }));
}

export async function getGlossaryTerm(slug: string) {
  const terms = await listGlossary();
  return terms.find((term) => term.slug === slug) ?? null;
}

/**
 * Find a glossary term by a word taken from the text.
 *
 * This is what makes tapping a word while reading useful: the tapped form is
 * folded and matched against the same skeleton the glossary stores.
 */
export async function findGlossaryBySearchKey(searchKey: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM canonical_glossary WHERE search_key LIKE ? LIMIT 1',
    `%${searchKey}%`,
  );
  if (!row) return null;
  return {
    slug: row.slug,
    termSanskrit: row.term_sanskrit,
    termTransliteration: row.term_transliteration,
    simpleDefinition: row.simple_definition,
  };
}

export async function listPlans() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>('SELECT * FROM canonical_plans ORDER BY title');
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    durationDays: row.duration_days,
    level: row.level,
    days: parseJson<any[]>(row.days_json, []),
  }));
}

export async function getPlan(slug: string) {
  const plans = await listPlans();
  return plans.find((plan) => plan.slug === slug) ?? null;
}

/** Shape a local verse for components that take the shared `VerseSummary`. */
export function toVerseSummary(verse: LocalVerse): VerseSummary {
  return {
    id: verse.id,
    chapterNumber: verse.chapterNumber,
    verseNumber: verse.verseNumber,
    verseNumberEnd: verse.verseNumberEnd,
    ref: verse.ref,
    slug: `${verse.chapterNumber}-${verse.verseNumber}`,
    sanskrit: verse.sanskrit,
    transliteration: verse.transliteration,
    translationEnglish: verse.translationEn,
    translationHindi: verse.translationHi,
  };
}
