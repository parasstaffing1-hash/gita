/**
 * Filling the local copy of the scripture.
 *
 * Runs on first launch and whenever the server reports a new content version.
 * It is deliberately restartable: content is written chapter by chapter inside
 * a transaction, so a connection dropped halfway leaves the device with fewer
 * chapters rather than a half-written one.
 *
 * User data is never touched here. Only `canonical_*` tables are rewritten.
 */
import { transliterationSkeleton, verseOrdinal } from '@gita/shared-utils';

import { api } from '../api';
import { STATE_KEYS, getDatabase, getState, setState } from './index';

export interface SyncProgress {
  phase: 'checking' | 'chapters' | 'verses' | 'discovery' | 'done' | 'failed';
  chaptersDone: number;
  chaptersTotal: number;
  versesWritten: number;
  message?: string;
}

type ProgressHandler = (progress: SyncProgress) => void;

/**
 * Is the local copy current?
 *
 * The manifest hash is derived from the content itself, so this is one small
 * request rather than a download.
 */
export async function isContentCurrent(): Promise<boolean> {
  try {
    const manifest = await api.contentManifest();
    const local = await getState(STATE_KEYS.contentVersion);
    return local === manifest.version;
  } catch {
    // Offline. Whatever is on the device is what the reader gets, which is
    // the point of storing it in the first place.
    return true;
  }
}

export async function hasLocalContent(): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM canonical_chapters');
  return (row?.n ?? 0) > 0;
}

export async function syncContent(onProgress?: ProgressHandler): Promise<SyncProgress> {
  const db = await getDatabase();
  const report = (progress: SyncProgress) => {
    onProgress?.(progress);
    return progress;
  };

  let state: SyncProgress = {
    phase: 'checking',
    chaptersDone: 0,
    chaptersTotal: 18,
    versesWritten: 0,
  };
  report(state);

  try {
    const manifest = await api.contentManifest();
    const chapters = await api.listChapters();
    state = { ...state, phase: 'chapters', chaptersTotal: chapters.length };
    report(state);

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM canonical_chapters');
      for (const chapter of chapters) {
        await db.runAsync(
          `INSERT INTO canonical_chapters
             (number, slug, name_sanskrit, name_transliteration, name_english, name_hindi,
              verse_count, summary, major_teachings, key_concepts, key_verses, verification_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          chapter.number,
          chapter.slug,
          chapter.nameSanskrit,
          chapter.nameTransliteration,
          chapter.nameEnglish,
          chapter.nameHindi,
          chapter.verseCount,
          chapter.summary,
          JSON.stringify(chapter.majorTeachings ?? []),
          JSON.stringify(chapter.keyConcepts ?? []),
          JSON.stringify((chapter.keyVerses ?? []).map((v) => `${v.chapter}.${v.verse}`)),
          chapter.verificationStatus,
        );
      }
    });

    state = { ...state, phase: 'verses' };
    report(state);

    // One chapter per transaction: an interrupted sync leaves whole chapters
    // rather than a torn one, and the next run simply continues.
    for (const chapter of chapters) {
      const written = await syncChapterVerses(db, chapter.number);
      state = {
        ...state,
        chaptersDone: state.chaptersDone + 1,
        versesWritten: state.versesWritten + written,
      };
      report(state);
    }

    state = { ...state, phase: 'discovery' };
    report(state);
    await syncDiscovery(db);

    await setState(STATE_KEYS.contentVersion, manifest.version);
    await setState(STATE_KEYS.contentSyncedAt, new Date().toISOString());

    state = { ...state, phase: 'done' };
    return report(state);
  } catch (error) {
    return report({
      ...state,
      phase: 'failed',
      message: error instanceof Error ? error.message : 'Content sync failed.',
    });
  }
}

async function syncChapterVerses(
  db: Awaited<ReturnType<typeof getDatabase>>,
  chapterNumber: number,
): Promise<number> {
  const page = await api.listChapterVerses(chapterNumber, { limit: 200 });
  if (page.items.length === 0) return 0;

  // Fetch full verses in small batches so a slow connection still makes
  // visible progress and memory stays flat.
  const details = [] as Awaited<ReturnType<typeof api.getVerse>>[];
  for (let index = 0; index < page.items.length; index += 10) {
    const batch = page.items.slice(index, index + 10);
    const resolved = await Promise.all(
      batch.map((summary) =>
        api.getVerse(summary.chapterNumber, summary.verseNumber).catch(() => null),
      ),
    );
    for (const verse of resolved) if (verse) details.push(verse);
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM canonical_verses WHERE chapter_number = ?', chapterNumber);
    await db.runAsync(
      'DELETE FROM canonical_verses_fts WHERE ref LIKE ?',
      `${chapterNumber}.%`,
    );

    for (const verse of details) {
      const ref = `${verse.chapterNumber}.${verse.verseNumber}`;
      const ordinal = verseOrdinal(verse.chapterNumber, verse.verseNumber) ?? 0;
      const english = verse.translations.find((t) => t.languageCode === 'en')?.text ?? null;
      const hindi = verse.translations.find((t) => t.languageCode.startsWith('hi'))?.text ?? null;

      await db.runAsync(
        `INSERT INTO canonical_verses
           (id, chapter_number, verse_number, verse_number_end, ref, ordinal, speaker,
            sanskrit, transliteration, translation_en, translation_hi,
            words_json, commentaries_json, topics_json, canonical_hash, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        verse.id,
        verse.chapterNumber,
        verse.verseNumber,
        verse.verseNumberEnd,
        ref,
        ordinal,
        verse.speaker,
        verse.sanskrit,
        verse.transliteration,
        english,
        hindi,
        JSON.stringify(
          verse.words.map((word) => ({
            position: word.position,
            wordDevanagari: word.wordDevanagari,
            wordTransliteration: word.wordTransliteration,
            meaningEnglish: word.meaningEnglish,
          })),
        ),
        JSON.stringify(
          verse.commentaries.map((commentary) => ({
            commentatorName: commentary.commentator?.name ?? null,
            text: commentary.text,
            languageCode: commentary.languageCode,
          })),
        ),
        JSON.stringify(verse.topics.map((topic) => ({ slug: topic.slug, name: topic.name }))),
        verse.canonicalHash,
        verse.verificationStatus,
      );

      // The folded key must be produced by the same function the server used
      // to build `search_key`, or offline results diverge from online ones.
      const body = [verse.sanskrit, verse.transliteration, english, hindi]
        .filter(Boolean)
        .join(' ');
      await db.runAsync(
        'INSERT INTO canonical_verses_fts (ref, search_key, body) VALUES (?, ?, ?)',
        ref,
        transliterationSkeleton(`${ref} ${body}`),
        body,
      );
    }
  });

  return details.length;
}

async function syncDiscovery(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  const [topics, glossary, plans] = await Promise.all([
    api.listTopics().catch(() => []),
    api.listGlossary().catch(() => []),
    api.listReadingPlans().catch(() => []),
  ]);

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM canonical_topics');
    for (const topic of topics) {
      // The summary endpoint has no verse list; fetch the full topic so the
      // curated mapping is available offline, which is the whole point of it.
      const full = await api.getTopic(topic.slug).catch(() => null);
      await db.runAsync(
        `INSERT INTO canonical_topics
           (slug, name, name_hindi, category, icon, short_description, introduction,
            verse_refs, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        topic.slug,
        topic.name,
        topic.nameHindi,
        topic.category,
        topic.icon,
        topic.shortDescription,
        full?.introduction ?? null,
        JSON.stringify((full?.verses ?? []).map((entry) => entry.verse.ref)),
        100,
      );
    }

    await db.runAsync('DELETE FROM canonical_glossary');
    for (const term of glossary) {
      await db.runAsync(
        `INSERT INTO canonical_glossary
           (slug, term_sanskrit, term_transliteration, term_english, search_key,
            simple_definition, detailed_definition, variants, related_verse_refs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        term.slug,
        term.termSanskrit,
        term.termTransliteration,
        term.termEnglish,
        transliterationSkeleton(
          [term.termSanskrit, term.termTransliteration, ...term.variants].join(' '),
        ),
        term.simpleDefinition,
        term.detailedDefinition,
        JSON.stringify(term.variants ?? []),
        JSON.stringify((term.relatedVerses ?? []).map((verse) => verse.ref)),
      );
    }

    await db.runAsync('DELETE FROM canonical_plans');
    for (const summary of plans) {
      const full = await api.getReadingPlan(summary.slug).catch(() => null);
      await db.runAsync(
        `INSERT INTO canonical_plans
           (slug, title, subtitle, description, duration_days, level, days_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        summary.slug,
        summary.title,
        summary.subtitle,
        summary.description,
        summary.durationDays,
        summary.level,
        JSON.stringify(
          (full?.days ?? []).map((day) => ({
            dayNumber: day.dayNumber,
            title: day.title,
            intro: day.intro,
            reflection: day.reflection,
            estimatedMinutes: day.estimatedMinutes,
            verseRefs: day.verses.map((verse) => verse.ref),
          })),
        ),
      );
    }
  });
}
