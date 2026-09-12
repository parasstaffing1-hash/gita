/**
 * Verse reference parsing.
 *
 * Users type references in many shapes. This is the single place that turns
 * any of them into `{ chapter, verse }`. The Python API mirrors this exactly
 * (apps/api/gita_api/utils/verse_ref.py) and both are tested against the same
 * fixture list so they cannot drift.
 */

export interface ParsedVerseRef {
  chapter: number;
  /** null when the reference points at a whole chapter. */
  verse: number | null;
  /** Set for merged verses such as "1.32-35". */
  verseEnd: number | null;
}

/** Standard verse counts per chapter (Gita Press recension, 700 verses total). */
export const CHAPTER_VERSE_COUNTS: readonly number[] = [
  47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 34, 27, 20, 24, 28, 78,
];

export const TOTAL_CHAPTERS = 18;
export const TOTAL_VERSES = CHAPTER_VERSE_COUNTS.reduce((a, b) => a + b, 0); // 700

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** Convert Devanagari digits (२.४७) to ASCII so the same parser handles them. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const idx = DEVANAGARI_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

const PATTERNS: RegExp[] = [
  // "bg 2.47", "gita 2:47", "2.47", "2-47", "2 47"
  /^(?:bg|gita|bhagavad\s*gita|geeta|श्रीमद्भगवद्गीता|गीता)?\s*[.:]?\s*(\d{1,2})\s*[.:\-\s]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/i,
  // "chapter 2 verse 47", "adhyaya 2 shloka 47"
  /^(?:chapter|ch|adhyaya|अध्याय)\s*(\d{1,2})[,\s]*(?:verse|shloka|sloka|v|श्लोक)\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/i,
  // "chapter 2" alone
  /^(?:chapter|ch|adhyaya|अध्याय)\s*(\d{1,2})$/i,
];

/**
 * Parse a user string into a verse reference.
 * Returns null when the string is not a reference (then it is a text query).
 */
export function parseVerseRef(raw: string): ParsedVerseRef | null {
  const input = normalizeDigits(raw).trim().replace(/\s+/g, ' ');
  if (!input) return null;

  for (const pattern of PATTERNS) {
    const match = pattern.exec(input);
    if (!match) continue;

    const chapter = Number.parseInt(match[1] ?? '', 10);
    if (!isValidChapter(chapter)) return null;

    if (match[2] === undefined) {
      return { chapter, verse: null, verseEnd: null };
    }

    const verse = Number.parseInt(match[2], 10);
    if (!isValidVerse(chapter, verse)) return null;

    const end = match[3] ? Number.parseInt(match[3], 10) : null;
    if (end !== null && (end <= verse || !isValidVerse(chapter, end))) {
      return { chapter, verse, verseEnd: null };
    }
    return { chapter, verse, verseEnd: end };
  }
  return null;
}

export function isValidChapter(chapter: number): boolean {
  return Number.isInteger(chapter) && chapter >= 1 && chapter <= TOTAL_CHAPTERS;
}

export function isValidVerse(chapter: number, verse: number): boolean {
  if (!isValidChapter(chapter)) return false;
  const max = CHAPTER_VERSE_COUNTS[chapter - 1];
  return Number.isInteger(verse) && verse >= 1 && max !== undefined && verse <= max;
}

/** Canonical display form: "2.47" or "1.32-35". */
export function formatVerseRef(ref: {
  chapter: number;
  verse: number | null;
  verseEnd?: number | null;
}): string {
  if (ref.verse === null || ref.verse === undefined) return String(ref.chapter);
  const end = ref.verseEnd ?? null;
  return end ? `${ref.chapter}.${ref.verse}-${end}` : `${ref.chapter}.${ref.verse}`;
}

/** URL slug used on the website: /gita/2/47 -> "2-47". */
export function verseSlug(chapter: number, verse: number): string {
  return `${chapter}-${verse}`;
}

/** Sequential position of a verse across the whole Gita (1..700). */
export function verseOrdinal(chapter: number, verse: number): number | null {
  if (!isValidVerse(chapter, verse)) return null;
  let total = 0;
  for (let c = 1; c < chapter; c += 1) total += CHAPTER_VERSE_COUNTS[c - 1] ?? 0;
  return total + verse;
}

/** Next verse, rolling into the following chapter. Null at 18.78. */
export function nextVerse(chapter: number, verse: number): ParsedVerseRef | null {
  if (!isValidVerse(chapter, verse)) return null;
  const max = CHAPTER_VERSE_COUNTS[chapter - 1] ?? 0;
  if (verse < max) return { chapter, verse: verse + 1, verseEnd: null };
  if (chapter < TOTAL_CHAPTERS) return { chapter: chapter + 1, verse: 1, verseEnd: null };
  return null;
}

/** Previous verse, rolling back into the preceding chapter. Null at 1.1. */
export function previousVerse(chapter: number, verse: number): ParsedVerseRef | null {
  if (!isValidVerse(chapter, verse)) return null;
  if (verse > 1) return { chapter, verse: verse - 1, verseEnd: null };
  if (chapter > 1) {
    const prevChapter = chapter - 1;
    return {
      chapter: prevChapter,
      verse: CHAPTER_VERSE_COUNTS[prevChapter - 1] ?? 1,
      verseEnd: null,
    };
  }
  return null;
}
