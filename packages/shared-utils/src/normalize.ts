/**
 * Query and term normalisation.
 *
 * Search must treat "Krishna", "Kṛṣṇa", "Krsna", "Krishn" and "कृष्ण" as the
 * same thing. This is the shared normaliser; apps/api/gita_api/utils/normalize.py
 * mirrors it exactly and both are covered by the same fixture cases.
 *
 * Nothing here ever touches stored canonical text — folding is for matching only.
 */

const EXTRA_FOLDS: Array<[string, string]> = [
  ['ḷ', 'l'],
  ['ḹ', 'l'],
  ['ṝ', 'r'],
  ['ऽ', ''],
];

/** Applied in order. Longer digraphs first so "sh" is folded before "s". */
const TRANSLIT_FOLDS: Array<[string, string]> = [
  ['sh', 's'],
  ['ch', 'c'],
  ['kh', 'k'],
  ['gh', 'g'],
  ['jh', 'j'],
  ['th', 't'],
  ['dh', 'd'],
  ['ph', 'f'],
  ['bh', 'b'],
  ['ri', 'r'],
  ['ee', 'i'],
  ['oo', 'u'],
  ['aa', 'a'],
  ['w', 'v'],
  ['z', 'j'],
];

const DEVANAGARI_RANGE = /[ऀ-ॿ]/;
const LATIN_RANGE = /[A-Za-z]/;
const COMBINING_MARKS = /[̀-ͯ॑-॔]/g;
const DOUBLED = /([bcdfgjklmnpqrstvx])\1+/g;
const NON_WORD = /[^a-z0-9\s]/g;
/**
 * Word-final schwa, dropped so "karm" and "karma" agree — Hindi deletes the
 * inherent vowel in speech and people write it both ways. Guarded to words of
 * three characters or more so short words are not reduced to nothing.
 */
const TRAILING_SCHWA = /([a-z]{2})a\b/g;

const DEVA_CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'k', ग: 'g', घ: 'g', ङ: 'n',
  च: 'c', छ: 'c', ज: 'j', झ: 'j', ञ: 'n',
  ट: 't', ठ: 't', ड: 'd', ढ: 'd', ण: 'n',
  त: 't', थ: 't', द: 'd', ध: 'd', न: 'n',
  प: 'p', फ: 'f', ब: 'b', भ: 'b', म: 'm',
  य: 'y', र: 'r', ल: 'l', व: 'v',
  श: 's', ष: 's', स: 's', ह: 'h',
};

const DEVA_VOWELS: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u',
  ऋ: 'r', ॠ: 'r', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
};

/** Dependent vowel signs (matras). Their presence suppresses the inherent "a". */
const DEVA_MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'ृ': 'r', 'ॄ': 'r', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const VIRAMA = '्';
const DEVA_SIGNS: Record<string, string> = { 'ं': 'm', 'ः': 'h', 'ँ': 'm', '़': '', 'ऽ': '' };

/** Strip IAST/ISO diacritics: Kṛṣṇa -> Krsna, ātman -> atman. */
export function stripDiacritics(input: string): string {
  let value = input;
  for (const [from, to] of EXTRA_FOLDS) value = value.split(from).join(to);
  return value.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
}

/**
 * Rough Devanagari to Latin folding.
 *
 * The one thing it must get right is the inherent vowel: a bare consonant
 * carries an "a" unless a virama or a matra follows it. Without that, "आत्मन्"
 * folds to "atmn" and never matches "atman".
 */
export function devanagariToLatinSkeleton(input: string): string {
  const chars = Array.from(input);
  let out = '';
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] as string;
    const following = chars[index + 1] ?? '';
    if (char in DEVA_CONSONANTS) {
      out += DEVA_CONSONANTS[char];
      if (following !== VIRAMA && !(following in DEVA_MATRAS)) out += 'a';
    } else if (char in DEVA_VOWELS) {
      out += DEVA_VOWELS[char];
    } else if (char in DEVA_MATRAS) {
      out += DEVA_MATRAS[char];
    } else if (char in DEVA_SIGNS) {
      out += DEVA_SIGNS[char];
    } else if (char === VIRAMA) {
      continue;
    } else if (DEVANAGARI_RANGE.test(char)) {
      continue; // unmapped Devanagari (rare conjunct forms, digits)
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Fold a term to the matching skeleton used by the `search_key` columns.
 *
 * Deliberately lossy — only used for matching, never for display, and never
 * applied to canonical text that is stored or shown.
 */
export function transliterationSkeleton(input: string): string {
  let s = stripDiacritics(devanagariToLatinSkeleton(input)).toLowerCase();
  s = s.replace(NON_WORD, ' ');
  for (const [from, to] of TRANSLIT_FOLDS) s = s.split(from).join(to);
  s = s.replace(/y\b/g, 'i');
  s = s.replace(DOUBLED, '$1');
  s = s.replace(TRAILING_SCHWA, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** Detected script of a string, used to route language detection. */
export type ScriptGuess = 'devanagari' | 'latin' | 'mixed' | 'unknown';

export function detectScript(input: string): ScriptGuess {
  const hasDeva = DEVANAGARI_RANGE.test(input);
  const hasLatin = LATIN_RANGE.test(input);
  if (hasDeva && hasLatin) return 'mixed';
  if (hasDeva) return 'devanagari';
  if (hasLatin) return 'latin';
  return 'unknown';
}

/**
 * Hinglish detection: Latin script carrying Hindi function words.
 * A small explicit word list rather than a model — it is a routing hint for the
 * answer language, not a linguistic claim.
 */
const HINGLISH_MARKERS = new Set(
  (
    'ka ke ki ko se me mein par hai hain ho hota hoti kya kyu kyun kaise kaisa ' +
    'nahi nahin karna karne karo kar liye sath bina bhi aur lekin magar apna ' +
    'apne mera mere tera tumhara hum humko mujhe tumhe jeevan zindagi dar gussa ' +
    'dukh shanti mann man kaam dharm karm'
  ).split(' '),
);

export function looksHinglish(input: string): boolean {
  if (detectScript(input) !== 'latin') return false;
  const words = input.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return false;
  const hits = words.filter((w) => HINGLISH_MARKERS.has(w)).length;
  return hits / words.length >= 0.25 || hits >= 2;
}

/** en | hi | hi-Latn — the three languages Ask the Gita answers in today. */
export function detectQueryLanguage(input: string): 'en' | 'hi' | 'hi-Latn' {
  const script = detectScript(input);
  if (script === 'devanagari' || script === 'mixed') return 'hi';
  if (looksHinglish(input)) return 'hi-Latn';
  return 'en';
}

/** Collapse whitespace and trim; safe for storing a normalised query. */
export function normalizeQuery(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** URL-safe slug from arbitrary text (Latin output only). */
export function slugify(input: string): string {
  return stripDiacritics(devanagariToLatinSkeleton(input))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}
