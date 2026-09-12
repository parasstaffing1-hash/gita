/**
 * Data for the quote maker.
 *
 * This is the one screen in the app that cannot be served from SQLite. The
 * local mirror holds the canon, not the wallpaper library, and a card is only
 * worth making against the images the server actually has — so everything here
 * is network-first and every call degrades to an empty result rather than an
 * error. A composer with no backgrounds is still usable; a thrown promise is
 * not.
 *
 * The verse text is fetched, never typed. `searchVerses` and `fetchVerse`
 * return what the library holds and nothing else, which is what keeps the
 * "scripture comes from the database" rule true on this platform as well.
 */
import { parseVerseRef } from '@gita/shared-utils';

import { API_URL } from '@/lib/api';

export interface WallpaperSummary {
  id: string;
  slug: string;
  title: string | null;
  width: number;
  height: number;
  orientation: string;
  /** Which third of the frame was measured as quietest, at import. */
  textZone: string;
  luminance: number | null;
  dominantColor: string | null;
  moods: string[];
  thumbUrl: string | null;
  previewUrl: string | null;
  fullUrl: string | null;
  attribution: string | null;
  photographer: string | null;
}

export interface ComposerVerse {
  ref: string;
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
 * The same editorial shortlist the website carries.
 *
 * Not a ranking — the search box only helps someone who already knows what
 * they are looking for, and these are the verses people ask for by name. The
 * list is filtered against the library before it reaches the UI, because
 * several of these references are not imported yet and a chip that does
 * nothing is worse than a shorter row of chips.
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

const LOOPBACK_MEDIA = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/.*)$/;

/**
 * Point an image URL at the host this device can actually reach.
 *
 * While R2 is unconfigured the API hands out absolute
 * `http://localhost:8000/media/...` URLs. On a phone or an emulator
 * `localhost` is the device itself, so those load in a laptop browser and fail
 * silently here. `API_URL` has already been resolved against the Expo host, so
 * re-basing on it is enough. A real CDN URL has a different origin and is left
 * alone.
 */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(LOOPBACK_MEDIA);
  if (!match) return url;
  return `${API_URL.replace(/\/$/, '')}${match[1]}`;
}

/** Every call goes through here: a failure degrades the screen, never breaks it. */
async function get<T>(path: string, fallback: T, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, { signal });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export interface WallpaperPage {
  items: WallpaperSummary[];
  total: number;
}

export async function listWallpapers(
  params: {
    orientation: 'portrait' | 'landscape';
    mood?: string | null;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<WallpaperPage> {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 40),
    offset: String(params.offset ?? 0),
    orientation: params.orientation,
  });
  if (params.mood) query.set('mood', params.mood);

  const page = await get<WallpaperPage>(
    `/v1/wallpapers?${query.toString()}`,
    { items: [], total: 0 },
    signal,
  );
  return { items: page.items ?? [], total: page.total ?? 0 };
}

export function listMoods(signal?: AbortSignal): Promise<string[]> {
  return get<string[]>('/v1/wallpapers/moods', [], signal);
}

export async function fetchVerse(ref: string, signal?: AbortSignal): Promise<ComposerVerse | null> {
  const parsed = parseVerseRef(ref);
  if (!parsed) return null;
  return get<ComposerVerse | null>(`/v1/verses/${parsed.chapter}/${parsed.verse}`, null, signal);
}

/** The shortlist, minus anything the library does not hold yet. */
export async function availableSuggestions(signal?: AbortSignal): Promise<VerseSuggestion[]> {
  const checked = await Promise.all(
    WELL_KNOWN.map(async (item) => ((await fetchVerse(item.ref, signal)) ? item : null)),
  );
  return checked.filter((item): item is VerseSuggestion => item !== null);
}

export async function searchVerses(query: string, signal?: AbortSignal): Promise<ComposerVerse[]> {
  const data = await get<{ hits?: Array<{ verse: ComposerVerse }> }>(
    `/v1/search?q=${encodeURIComponent(query)}&limit=8`,
    {},
    signal,
  );
  return (data.hits ?? []).map((hit) => hit.verse).filter(Boolean);
}

/**
 * A bare counter, so the picker can lead with what people use.
 *
 * No verse, no identity, and deliberately fire-and-forget at the call site: an
 * export must not fail because a statistics endpoint did.
 */
export function recordWallpaperUse(slug: string): void {
  void fetch(`${API_URL}/v1/wallpapers/${encodeURIComponent(slug)}/used`, {
    method: 'POST',
  }).catch(() => undefined);
}
