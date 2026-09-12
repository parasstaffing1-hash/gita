/**
 * The TypeScript half of the shared verse-reference contract.
 *
 * These load the same fixture file the Python tests use
 * (apps/api/tests/fixtures/verse_refs.json). If the two parsers ever disagree,
 * one of the two suites fails — which is the point, because the mobile app
 * parses references on-device while the API parses them on the server.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CHAPTER_VERSE_COUNTS,
  TOTAL_VERSES,
  formatVerseRef,
  nextVerse,
  parseVerseRef,
  previousVerse,
  verseOrdinal,
} from '@gita/shared-utils';

// Resolved from the Vitest root (apps/web) rather than import.meta.url, which
// is not a file: URL under the jsdom environment.
const fixturePath = resolve(process.cwd(), '../api/tests/fixtures/verse_refs.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  valid: Array<{ input: string; chapter: number; verse: number | null }>;
  invalid: string[];
};

describe('shared verse-reference fixtures', () => {
  it('the fixture file is the one the API tests use', () => {
    expect(fixtures.valid.length).toBeGreaterThan(10);
    expect(fixtures.invalid.length).toBeGreaterThan(5);
  });

  it.each(fixtures.valid)('parses $input', ({ input, chapter, verse }) => {
    const parsed = parseVerseRef(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.chapter).toBe(chapter);
    expect(parsed?.verse).toBe(verse);
  });

  it.each(fixtures.invalid)('does not treat %j as a reference', (value) => {
    expect(parseVerseRef(value)).toBeNull();
  });
});

describe('verse numbering', () => {
  it('the Gita has 700 verses across 18 chapters', () => {
    expect(TOTAL_VERSES).toBe(700);
    expect(CHAPTER_VERSE_COUNTS).toHaveLength(18);
  });

  it('rejects verses outside a chapter', () => {
    // Chapter 2 has 72 verses.
    expect(parseVerseRef('2.72')).not.toBeNull();
    expect(parseVerseRef('2.73')).toBeNull();
    expect(parseVerseRef('19.1')).toBeNull();
  });

  it('assigns every verse a unique, contiguous ordinal', () => {
    const seen = new Set<number>();
    CHAPTER_VERSE_COUNTS.forEach((count, index) => {
      for (let verse = 1; verse <= count; verse += 1) {
        const ordinal = verseOrdinal(index + 1, verse);
        expect(ordinal).not.toBeNull();
        expect(seen.has(ordinal as number)).toBe(false);
        seen.add(ordinal as number);
      }
    });
    expect(seen.size).toBe(700);
  });

  it('walks from 1.1 to 18.78 in exactly 700 steps', () => {
    let chapter = 1;
    let verse = 1;
    let count = 1;
    let next = nextVerse(chapter, verse);
    while (next) {
      chapter = next.chapter;
      verse = next.verse as number;
      count += 1;
      next = nextVerse(chapter, verse);
    }
    expect([chapter, verse]).toEqual([18, 78]);
    expect(count).toBe(700);
  });

  it('has no neighbour past either end', () => {
    expect(nextVerse(18, 78)).toBeNull();
    expect(previousVerse(1, 1)).toBeNull();
  });

  it('formats merged verse ranges', () => {
    expect(formatVerseRef({ chapter: 2, verse: 47, verseEnd: null })).toBe('2.47');
    expect(formatVerseRef({ chapter: 1, verse: 32, verseEnd: 35 })).toBe('1.32-35');
  });
});
