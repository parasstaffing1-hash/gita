import {
  ACCENTS,
  DEFAULT_COMPOSITION,
  FORMATS,
  LAYOUTS,
  TONES,
  ZONE_LAYOUT,
  clampScale,
  decodeComposition,
  type QuoteComposition,
} from '@gita/quote-composer';
import { parseVerseRef } from '@gita/shared-utils';

import type { WallpaperSummary } from '@/components/quote-maker';
import { API_URL, SITE_URL } from '@/lib/api';

/**
 * Server-side data for the composer and for shared links.
 *
 * The verse is fetched here rather than in the client so a shared card renders
 * its scripture on the first paint — and so a link someone opens on a slow
 * connection is never briefly a blank frame with a stranger's caption on it.
 */

export interface ComposerVerse {
  ref: string;
  /** Set when this record covers several verses read as one, e.g. 1.32-35. */
  verseNumberEnd?: number | null;
  sanskrit: string | null;
  transliteration: string | null;
  translationEnglish: string | null;
  translationHindi: string | null;
  verificationStatus: string;
}

export interface VerseSuggestion {
  ref: string;
  hint: string;
}

/**
 * A short editorial shortlist, not a ranking.
 *
 * The search box only helps someone who already knows what they want. These
 * are verses people most often ask for, with a word each so the reference is
 * not the only thing to go on. Filtered against the library before it reaches
 * the page: offering a verse the database does not hold yet is a button that
 * does nothing.
 */
const WELL_KNOWN: VerseSuggestion[] = [
  { ref: '2.47', hint: 'work' },
  { ref: '2.13', hint: 'change' },
  { ref: '2.62', hint: 'anger' },
  { ref: '3.35', hint: 'your own path' },
  { ref: '4.7', hint: 'dharma' },
  { ref: '6.5', hint: 'self' },
  { ref: '12.15', hint: 'calm' },
  { ref: '18.66', hint: 'surrender' },
];

export interface ComposerData {
  composition: QuoteComposition;
  verse: ComposerVerse | null;
  wallpapers: WallpaperSummary[];
  /** Size of the whole library for this orientation, not of the page above. */
  total: number;
  suggestions: VerseSuggestion[];
  moods: string[];
  siteUrl: string;
}

/** Anything that fails here degrades the page rather than breaking it: an empty
 * picker is usable, a 500 is not. */
async function get<T>(path: string, fallback: T, revalidate = 300): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, { next: { revalidate } });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function fetchVerse(ref: string): Promise<ComposerVerse | null> {
  const parsed = parseVerseRef(ref);
  if (!parsed) return null;
  return get<ComposerVerse | null>(
    `/v1/verses/${parsed.chapter}/${parsed.verse}`,
    null,
    3600,
  );
}

async function availableSuggestions(): Promise<VerseSuggestion[]> {
  const checked = await Promise.all(
    WELL_KNOWN.map(async (item) => ((await fetchVerse(item.ref)) ? item : null)),
  );
  return checked.filter((item): item is VerseSuggestion => item !== null);
}

// --- Share codes -----------------------------------------------------------
//
// `decodeComposition` is deliberately forgiving: it never throws, and every
// field it cannot read falls back to a default. That is right for a link made
// by an older build, but it means the decoder on its own cannot tell a
// composition from a random string. A route that renders whatever it is handed
// is a page generator — every distinct path becomes its own ISR entry and its
// own indexable URL declaring its own canonical — so the shape is checked here,
// before anything is fetched, rendered or cached.

/** The version prefix `encodeComposition` writes. Another scheme is not one
 *  this build can claim to render faithfully. */
const CODE_VERSION = 'v1';

/** Room for the longest caption the encoder can produce, and no more. */
const MAX_CODE_LENGTH = 600;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CODE_FIELDS: Record<string, ((value: string) => boolean) | undefined> = {
  // Canonical `chapter.verse` only, for a chapter and verse that exist. The
  // decoder accepts every spelling `parseVerseRef` does — "2 47", "Chapter 2
  // Verse 47" — and honouring those here would make one card reachable at a
  // great many addresses.
  r: (value) => /^[1-9]\d*\.[1-9]\d*$/.test(value) && parseVerseRef(value) !== null,
  // Same slug rule the decoder enforces before this value reaches a request path.
  w: (value) => value === '-' || SLUG.test(value),
  l: (value) => (LAYOUTS as readonly string[]).includes(value),
  t: (value) => (TONES as readonly string[]).includes(value),
  // Layer flags in the order the encoder writes them, or `-` for none of them.
  y: (value) => value !== '' && /^(?:s?t?e?|-)$/.test(value),
  g: (value) => value === 'en' || value === 'hi',
  // Two decimals, as `toFixed(2)` writes it, and within the range the slider
  // can reach — so one size is not spelled a hundred ways.
  z: (value) =>
    /^\d+\.\d{2}$/.test(value) &&
    Number.parseFloat(value) === clampScale(Number.parseFloat(value)),
  a: (value) => (ACCENTS as readonly string[]).includes(value),
  f: (value) => (FORMATS as readonly string[]).includes(value),
  // 80 sanitised characters, worst case four bytes each, base64url'd.
  c: (value) => value.length > 0 && value.length <= 448 && /^[A-Za-z0-9_-]+$/.test(value),
};

/** Every field `encodeComposition` always writes. A code missing one of them
 *  did not come out of this scheme. */
const REQUIRED_CODE_FIELDS = ['r', 'w', 'l', 't', 'y', 'g', 'z', 'a', 'f'];

/**
 * The composition a share code carries, or null when it carries none.
 *
 * Null is the caller's cue to 404 rather than to fall back. A string that is
 * not a composition has no card behind it, and rendering the default in its
 * place mints a cacheable, indexable page for every string anyone ever tries.
 */
export function parseCompositionCode(code: string): QuoteComposition | null {
  if (!code || code.length > MAX_CODE_LENGTH) return null;

  const parts = code.split('~');
  if (parts[0] !== CODE_VERSION) return null;

  const present = new Set<string>();
  for (const part of parts.slice(1)) {
    const key = part.slice(0, 1);
    const valid = CODE_FIELDS[key];
    // A repeated or unrecognised key is not forward compatibility; it is a
    // second spelling of the same card, which is the unbounded set of addresses
    // this check exists to close.
    if (!valid || present.has(key)) return null;
    present.add(key);
    if (!valid(part.slice(1))) return null;
  }
  if (!REQUIRED_CODE_FIELDS.every((key) => present.has(key))) return null;

  const composition = decodeComposition(code);
  // The one field the shape check cannot finish alone: base64url that decodes
  // to nothing, or to nothing but Devanagari, passes every test above.
  if (present.has('c') && composition.caption === null) return null;
  return composition;
}

export async function loadComposerData(
  input: { ref?: string; composition?: QuoteComposition } = {},
): Promise<ComposerData> {
  // A shared card arrives already decoded and validated, so this never has to
  // decide whether to trust a code.
  const shared = input.composition ?? null;
  let composition = shared ?? DEFAULT_COMPOSITION;

  if (!shared && input.ref && parseVerseRef(input.ref)) {
    composition = { ...DEFAULT_COMPOSITION, ref: input.ref };
  }

  const orientation = composition.format === 'desktop4k' || composition.format === 'link'
    ? 'landscape'
    : 'portrait';

  const [verse, list, moods, suggestions] = await Promise.all([
    fetchVerse(composition.ref),
    get<{ items: WallpaperSummary[]; total: number }>(
      `/v1/wallpapers?limit=60&orientation=${orientation}`,
      { items: [], total: 0 },
    ),
    get<string[]>('/v1/wallpapers/moods', []),
    availableSuggestions(),
  ]);

  const wallpapers = list.items ?? [];

  // A first visit opens on an actual photograph rather than a black rectangle —
  // the point of the page is the library, and an empty frame does not show it.
  // A shared link is left exactly as its author composed it, plain ground
  // included.
  const opener = wallpapers[0];
  if (!shared && composition.wallpaperId === null && opener) {
    composition = {
      ...composition,
      wallpaperId: opener.slug,
      // Same rule the picker uses once the page is interactive: set the verse
      // in whichever third of this image was measured as the quietest.
      layout: ZONE_LAYOUT[opener.textZone] ?? composition.layout,
    };
  }

  return {
    composition,
    verse,
    wallpapers,
    total: list.total ?? wallpapers.length,
    suggestions,
    moods,
    siteUrl: SITE_URL,
  };
}
