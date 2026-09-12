/**
 * The TypeScript half of the shared normalisation contract.
 *
 * The folding here has to match apps/api/gita_api/utils/normalize.py exactly.
 * The API writes `search_key` with the Python version and matches queries
 * against it; the mobile app folds locally for offline search. If they drift,
 * offline search silently stops agreeing with online search.
 */
import { describe, expect, it } from 'vitest';

import {
  detectQueryLanguage,
  detectScript,
  looksHinglish,
  slugify,
  stripDiacritics,
  transliterationSkeleton,
} from '@gita/shared-utils';
import { canonicalHash, normalizeForHash } from '@gita/shared-utils';

describe('diacritic folding', () => {
  it.each([
    ['Kṛṣṇa', 'Krsna'],
    ['ātman', 'atman'],
    ['mokṣa', 'moksa'],
    ['yajña', 'yajna'],
    ['Bhagavad Gītā', 'Bhagavad Gita'],
  ])('%s -> %s', (input, expected) => {
    expect(stripDiacritics(input)).toBe(expected);
  });
});

describe('transliteration skeleton', () => {
  it('folds every common spelling of Krishna together', () => {
    const spellings = ['Krishna', 'Kṛṣṇa', 'Krsna', 'Krishn', 'krishna', 'KRISHNA', 'कृष्ण'];
    const skeletons = new Set(spellings.map(transliterationSkeleton));
    expect(skeletons.size).toBe(1);
  });

  it.each([
    [['karma', 'karm', 'कर्म']],
    [['dharma', 'dharm', 'धर्म']],
    [['atman', 'ātman', 'आत्मन्']],
    [['moksha', 'moksh', 'mokṣa']],
  ])('folds %j together', (group) => {
    expect(new Set(group.map(transliterationSkeleton)).size).toBe(1);
  });

  it('does not merge unrelated terms', () => {
    expect(transliterationSkeleton('dharma')).not.toBe(transliterationSkeleton('karma'));
    expect(transliterationSkeleton('moksha')).not.toBe(transliterationSkeleton('maya'));
  });

  it('gives Devanagari its inherent vowel', () => {
    // Without the inherent "a", आत्मन् folds to "atmn" and never matches "atman".
    expect(transliterationSkeleton('आत्मन्')).toBe(transliterationSkeleton('atman'));
  });
});

describe('language routing', () => {
  it.each([
    ['कर्म', 'devanagari'],
    ['karma', 'latin'],
    ['karma कर्म', 'mixed'],
    ['2.47', 'unknown'],
  ] as const)('detects the script of %s', (input, expected) => {
    expect(detectScript(input)).toBe(expected);
  });

  it.each(['failure ka dar', 'gussa kaise control kare', 'mann ko kaise shant kare'])(
    'recognises %j as Hinglish',
    (input) => {
      expect(looksHinglish(input)).toBe(true);
    },
  );

  it.each(['what does the gita say about duty', 'how do i deal with anger', 'karma yoga'])(
    'does not mistake %j for Hinglish',
    (input) => {
      expect(looksHinglish(input)).toBe(false);
    },
  );

  it.each([
    ['क्रोध को कैसे नियंत्रित करें', 'hi'],
    ['failure ka dar', 'hi-Latn'],
    ['how do I deal with failure', 'en'],
  ] as const)('routes %j to %s', (input, expected) => {
    expect(detectQueryLanguage(input)).toBe(expected);
  });
});

describe('canonical hashing', () => {
  const verse = 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।';

  it('ignores insignificant whitespace', async () => {
    const a = await canonicalHash(verse);
    const b = await canonicalHash(`  ${verse}  `);
    const c = await canonicalHash(verse.replace(' ', '\n'));
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('changes when the text changes', async () => {
    const a = await canonicalHash(verse);
    const b = await canonicalHash(verse.replace('कदाचन', 'कदाचित्'));
    expect(a).not.toBe(b);
  });

  it('is independent of Unicode normalisation form', async () => {
    const a = await canonicalHash('Kṛṣṇa'.normalize('NFC'));
    const b = await canonicalHash('Kṛṣṇa'.normalize('NFD'));
    expect(a).toBe(b);
  });

  it('documents its normalisation', () => {
    expect(normalizeForHash('  a   b \n c ')).toBe('a b c');
  });

  it('produces a 64-character hex digest', async () => {
    expect(await canonicalHash('dharma')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('slugify', () => {
  it('produces URL-safe ASCII', () => {
    expect(slugify('Kṛṣṇa & Arjuna')).toBe('krsna-arjuna');
    expect(slugify('The Yoga of Action')).toBe('the-yoga-of-action');
    expect(slugify('a/b')).not.toContain('/');
  });
});
