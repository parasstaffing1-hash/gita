/**
 * The composition model.
 *
 * A quote card is fully described by this object — which verse, which
 * wallpaper, and how the type sits on it. Nothing about the *content* of the
 * verse lives here: the text is always fetched from the database by `ref`, so
 * a card cannot carry scripture that was typed by hand.
 *
 * The model is deliberately small and serialisable, because the same value has
 * to drive three renderers that must agree pixel for pixel:
 *
 *   - the live canvas preview in the browser
 *   - the full-resolution canvas export the reader downloads
 *   - the server-side card that social crawlers fetch for a shared link
 */

import { parseVerseRef } from '@gita/shared-utils';

export const LAYOUTS = ['centered', 'lower', 'panel', 'minimal', 'banner'] as const;
export type LayoutName = (typeof LAYOUTS)[number];

export const TONES = ['auto', 'dark', 'light'] as const;
export type ToneName = (typeof TONES)[number];

export const ACCENTS = ['gold', 'saffron', 'none'] as const;
export type AccentName = (typeof ACCENTS)[number];

export const FORMATS = ['story', 'square', 'post', 'link', 'phone4k', 'desktop4k'] as const;
export type FormatName = (typeof FORMATS)[number];

export interface FormatSpec {
  width: number;
  height: number;
  label: string;
  /** What this size is actually for, shown in the picker. */
  hint: string;
}

export const FORMAT_SPECS: Record<FormatName, FormatSpec> = {
  story: { width: 1080, height: 1920, label: 'Story', hint: 'Instagram / WhatsApp status' },
  square: { width: 1080, height: 1080, label: 'Square', hint: 'Instagram post' },
  // 4:5 rather than 1:1 — a verse needs vertical room, and the taller crop is
  // what Instagram actually shows at full size in the feed.
  post: { width: 1080, height: 1350, label: 'Portrait', hint: 'Instagram feed' },
  link: { width: 1200, height: 630, label: 'Link card', hint: 'X, Facebook, Slack' },
  phone4k: { width: 2160, height: 3840, label: 'Phone 4K', hint: 'Lock screen wallpaper' },
  desktop4k: { width: 3840, height: 2160, label: 'Desktop 4K', hint: 'Desktop wallpaper' },
};

export interface QuoteLayers {
  sanskrit: boolean;
  transliteration: boolean;
  translation: boolean;
}

export interface QuoteComposition {
  /** Verse reference, e.g. "2.47". The text itself comes from the database. */
  ref: string;
  /** Wallpaper id, or null for a plain tinted ground. */
  wallpaperId: string | null;
  layout: LayoutName;
  tone: ToneName;
  layers: QuoteLayers;
  translationLanguage: 'en' | 'hi';
  /** Type size multiplier. Clamped; the layout stays legible across the range. */
  scale: number;
  accent: AccentName;
  /**
   * The reader's own line — a name, a handle, a dedication. Rendered small and
   * in a different voice from the verse, so it can never read as scripture.
   */
  caption: string | null;
  format: FormatName;
}

export const SCALE_RANGE = { min: 0.75, max: 1.4, step: 0.05 } as const;

/**
 * Which layout puts the verse in the calmest part of a given image.
 *
 * `textZone` is measured once at import: the frame is split into thirds and
 * the band with the least variance wins. `any` means no third was clearly
 * quieter, so there is nothing to follow and the current layout stands.
 */
export const ZONE_LAYOUT: Record<string, LayoutName | undefined> = {
  top: 'banner',
  middle: 'centered',
  bottom: 'lower',
  any: undefined,
};

export const DEFAULT_COMPOSITION: QuoteComposition = {
  ref: '2.47',
  wallpaperId: null,
  layout: 'lower',
  tone: 'auto',
  layers: { sanskrit: true, transliteration: false, translation: true },
  translationLanguage: 'en',
  scale: 1,
  accent: 'gold',
  caption: null,
  format: 'story',
};

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, value));
}

/** Presets, so someone can get a good result without touching a control. */
export interface QuotePreset {
  id: string;
  name: string;
  description: string;
  patch: Partial<QuoteComposition>;
}

export const PRESETS: QuotePreset[] = [
  {
    id: 'verse-first',
    name: 'Verse first',
    description: 'Sanskrit large, translation beneath. The default for sharing a shloka.',
    patch: {
      layout: 'lower',
      layers: { sanskrit: true, transliteration: false, translation: true },
      scale: 1,
      accent: 'gold',
    },
  },
  {
    id: 'sanskrit-only',
    name: 'Sanskrit only',
    description: 'The verse alone, centred. For readers who do not need the translation.',
    patch: {
      layout: 'centered',
      layers: { sanskrit: true, transliteration: false, translation: false },
      scale: 1.15,
      accent: 'gold',
    },
  },
  {
    id: 'study',
    name: 'Study card',
    description: 'All three layers on a panel. Built to be read, not just looked at.',
    patch: {
      layout: 'panel',
      layers: { sanskrit: true, transliteration: true, translation: true },
      scale: 0.9,
      accent: 'none',
    },
  },
  {
    id: 'quiet',
    name: 'Quiet',
    description: 'Small type at the edge. Lets the photograph carry the frame.',
    patch: {
      layout: 'minimal',
      layers: { sanskrit: false, transliteration: false, translation: true },
      scale: 0.9,
      accent: 'none',
    },
  },
  {
    id: 'wallpaper',
    name: 'Wallpaper',
    description: 'Type kept clear of the clock and app icons on a phone lock screen.',
    patch: {
      layout: 'banner',
      layers: { sanskrit: true, transliteration: false, translation: false },
      scale: 1,
      accent: 'gold',
      format: 'phone4k',
    },
  },
];

// --- URL encoding ---------------------------------------------------------
//
// A composition travels in the URL rather than in a database row, so a card is
// shareable and reproducible without storing anything per share. The encoding
// is compact and readable, and versioned so an old link keeps working when the
// model grows.

const VERSION = '1';

const LAYER_FLAGS: Array<[keyof QuoteLayers, string]> = [
  ['sanskrit', 's'],
  ['transliteration', 't'],
  ['translation', 'e'],
];

export function encodeComposition(composition: QuoteComposition): string {
  const layers = LAYER_FLAGS.filter(([key]) => composition.layers[key])
    .map(([, flag]) => flag)
    .join('');

  const parts = [
    `v${VERSION}`,
    `r${composition.ref}`,
    composition.wallpaperId ? `w${composition.wallpaperId}` : 'w-',
    `l${composition.layout}`,
    `t${composition.tone}`,
    `y${layers || '-'}`,
    `g${composition.translationLanguage}`,
    `z${composition.scale.toFixed(2)}`,
    `a${composition.accent}`,
    `f${composition.format}`,
  ];

  const encoded = parts.join('~');
  // A caption is free text, so it is base64url'd rather than inlined — it must
  // never be able to introduce a separator and shift every field after it.
  const caption = sanitiseCaption(composition.caption);
  if (caption) {
    return `${encoded}~c${base64UrlEncode(caption)}`;
  }
  return encoded;
}

export function decodeComposition(encoded: string): QuoteComposition {
  const result: QuoteComposition = {
    ...DEFAULT_COMPOSITION,
    layers: { ...DEFAULT_COMPOSITION.layers },
  };
  if (!encoded) return result;

  for (const part of encoded.split('~')) {
    const key = part[0];
    const value = part.slice(1);
    switch (key) {
      case 'r':
        // Shape is not enough. "2.99" is well-formed and does not exist, and a
        // link carrying it renders a card with no scripture on it at all -
        // leaving the caption as the only body text under a "Bhagavad Gita
        // 2.99" heading. Check it against the actual chapter lengths.
        if (parseVerseRef(value)) result.ref = value;
        break;
      case 'w':
        // A link is untrusted input and this value ends up in a request path.
        // Slugs are lowercase words and digits joined by hyphens; anything
        // else is dropped rather than sanitised, so a malformed link renders
        // on a plain ground instead of reaching for an arbitrary URL.
        result.wallpaperId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
        break;
      case 'l':
        if ((LAYOUTS as readonly string[]).includes(value)) result.layout = value as LayoutName;
        break;
      case 't':
        if ((TONES as readonly string[]).includes(value)) result.tone = value as ToneName;
        break;
      case 'y':
        result.layers = {
          sanskrit: value.includes('s'),
          transliteration: value.includes('t'),
          translation: value.includes('e'),
        };
        break;
      case 'g':
        if (value === 'en' || value === 'hi') result.translationLanguage = value;
        break;
      case 'z':
        result.scale = clampScale(Number.parseFloat(value));
        break;
      case 'a':
        if ((ACCENTS as readonly string[]).includes(value)) result.accent = value as AccentName;
        break;
      case 'f':
        if ((FORMATS as readonly string[]).includes(value)) result.format = value as FormatName;
        break;
      case 'c':
        result.caption = sanitiseCaption(base64UrlDecode(value));
        break;
      default:
        // Unknown key: a link made by a newer build. Ignore it and keep the
        // default rather than refusing to render.
        break;
    }
  }

  // A card with no visible text layer is not a card. Fall back rather than
  // rendering an empty frame.
  if (!result.layers.sanskrit && !result.layers.transliteration && !result.layers.translation) {
    result.layers = { ...DEFAULT_COMPOSITION.layers };
  }
  return result;
}

/**
 * The reader's own line, from an untrusted link.
 *
 * Two things matter. Newlines would let 80 characters become eight lines of
 * body copy, which is a paragraph rather than a signature. And Devanagari in
 * the caption would sit under a "Bhagavad Gita 2.47" heading looking exactly
 * like the verse - the one thing a card must never be able to do, since the
 * scripture on it is supposed to come only from the library.
 */
export function sanitiseCaption(raw: string | null): string | null {
  if (!raw) return null;
  const flattened = raw.replace(/\s+/gu, ' ').trim();
  // U+0900-U+097F Devanagari, U+A8E0-U+A8FF its extended block.
  const withoutDevanagari = flattened.replace(/[ऀ-ॿ꣠-ꣿ]/gu, '');
  return withoutDevanagari.slice(0, 80).trim() || null;
}

/**
 * Base64 without `Buffer`.
 *
 * This package runs in four places — a browser canvas, a Next server render,
 * a Node test runner and a React Native bundle — and only one of them has
 * Node's `Buffer`. Reaching for it meant React Native could not typecheck this
 * file without pulling `@types/node` into an app that has no Node in it.
 *
 * `btoa`/`atob` are present in browsers, Node 16+, Hermes and the edge
 * runtimes, so they are the fallback-free path. The manual table exists for
 * the one case none of that covers, and is small enough not to be worth
 * avoiding.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(binary: string): string {
  if (typeof btoa === 'function') return btoa(binary);

  // `charAt` rather than indexing: every index below is masked to 0..63 and the
  // table is 64 long, but only `charAt` says so in the type.
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const chunk = (a << 16) | (b << 8) | c;
    out += B64.charAt((chunk >> 18) & 63) + B64.charAt((chunk >> 12) & 63);
    out += i + 1 < binary.length ? B64.charAt((chunk >> 6) & 63) : '=';
    out += i + 2 < binary.length ? B64.charAt(chunk & 63) : '=';
  }
  return out;
}

function fromBase64(padded: string): string {
  if (typeof atob === 'function') return atob(padded);

  let out = '';
  const clean = padded.replace(/=+$/, '');
  for (let i = 0; i < clean.length; i += 4) {
    // A character outside the table gives -1, which the masks below turn into
    // a zero byte rather than a throw - the caller already treats a malformed
    // caption as absent.
    const chunk =
      (Math.max(B64.indexOf(clean.charAt(i)), 0) << 18) |
      (Math.max(B64.indexOf(clean.charAt(i + 1)), 0) << 12) |
      (Math.max(B64.indexOf(clean.charAt(i + 2)), 0) << 6) |
      Math.max(B64.indexOf(clean.charAt(i + 3)), 0);
    out += String.fromCharCode((chunk >> 16) & 255);
    if (i + 2 < clean.length) out += String.fromCharCode((chunk >> 8) & 255);
    if (i + 3 < clean.length) out += String.fromCharCode(chunk & 255);
  }
  return out;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toBase64(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = fromBase64(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}
