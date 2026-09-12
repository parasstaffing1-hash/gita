'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCENTS,
  DEFAULT_COMPOSITION,
  FORMATS,
  FORMAT_SPECS,
  LAYOUTS,
  LAYOUT_INFO,
  PRESETS,
  SCALE_RANGE,
  ZONE_LAYOUT,
  clampScale,
  encodeComposition,
  type AccentName,
  type FormatName,
  type LayoutName,
  type QuoteComposition,
  type QuoteContent,
} from '@gita/quote-composer';

import { QuoteCanvas, type QuoteCanvasHandle } from '@/components/quote-canvas';
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/**
 * How a verse is cited on a card.
 *
 * Most records are a single verse and cite as `2.47`. Some editions merge
 * several into one unit — 1.32 through 1.35 is read as one passage — and a card
 * carrying that text has to say so, or it credits four verses' worth of
 * scripture to the first of them.
 */
export function citationRef(ref: string, verseNumberEnd: number | null): string {
  if (!verseNumberEnd) return ref;
  const [chapter, verse] = ref.split('.');
  if (!chapter || !verse || Number(verse) >= verseNumberEnd) return ref;
  // An en dash, not a hyphen: this is a range, and it is set in a serif face.
  return `${chapter}.${verse}–${verseNumberEnd}`;
}

export interface WallpaperSummary {
  id: string;
  slug: string;
  title: string | null;
  width: number;
  height: number;
  orientation: string;
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

interface VerseData {
  ref: string;
  /** Set when this record covers several verses read as one, e.g. 1.32-35. */
  verseNumberEnd?: number | null;
  sanskrit: string | null;
  transliteration: string | null;
  translationEnglish: string | null;
  translationHindi: string | null;
  verificationStatus: string;
}

interface Props {
  initialComposition: QuoteComposition;
  initialVerse: VerseData | null;
  initialWallpapers: WallpaperSummary[];
  initialTotal: number;
  /** Verses the library actually holds, already filtered by the server. */
  suggestions: Array<{ ref: string; hint: string }>;
  moods: string[];
  siteUrl: string;
}

export function QuoteMaker({
  initialComposition,
  initialVerse,
  initialWallpapers,
  initialTotal,
  suggestions,
  moods,
  siteUrl,
}: Props) {
  const [composition, setComposition] = useState<QuoteComposition>(initialComposition);
  const [verse, setVerse] = useState<VerseData | null>(initialVerse);
  const [wallpapers, setWallpapers] = useState<WallpaperSummary[]>(initialWallpapers);
  const [total, setTotal] = useState(initialTotal);
  // Held apart from the grid on purpose. The grid is a filtered view and the
  // chosen background has to survive filtering it out — narrowing to "night"
  // must not blank the card you are looking at.
  const [selected, setSelected] = useState<WallpaperSummary | null>(
    () => initialWallpapers.find((w) => w.slug === initialComposition.wallpaperId) ?? null,
  );
  const [mood, setMood] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VerseData[]>([]);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [layoutTouched, setLayoutTouched] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // The original's URL, fetched per wallpaper when one is chosen. A listing
  // does not carry it: with presigned storage that would be a signature for
  // every row on the page, and sixty full-resolution links handed to a reader
  // who exports at most one.
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  // Where the next page of the picker starts, which filter it belongs to, and
  // whether the catalogue ran out.
  //
  // Not derived from `wallpapers.length`, which is what the grid *kept*. The
  // API orders on `use_count`, which moves every time anybody exports, so rows
  // slide across the window boundary between two requests: a page can come back
  // holding rows already on screen — and if the whole page does, an offset taken
  // from the array length never advances and the button asks for the same rows
  // forever, while the rows that slid the other way are never asked for at all.
  // Counting rows requested keeps the window moving regardless.
  const [page, setPage] = useState<{ key: string; offset: number; drained: boolean } | null>(
    null,
  );
  const canvasHandle = useRef<QuoteCanvasHandle | null>(null);
  const firstRun = useRef(true);

  const patch = useCallback((next: Partial<QuoteComposition>) => {
    setComposition((current) => ({ ...current, ...next }));
  }, []);

  function choose(wallpaper: WallpaperSummary | null) {
    setSelected(wallpaper);

    // Every wallpaper was measured at import for the third of the frame with
    // the least going on in it. Following that measurement is the whole reason
    // it was taken — but only until the reader states a preference, after which
    // moving their layout out from under them would be rude.
    const follow = !layoutTouched && wallpaper ? ZONE_LAYOUT[wallpaper.textZone] : undefined;

    patch({ wallpaperId: wallpaper?.slug ?? null, ...(follow ? { layout: follow } : {}) });
  }

  /** Anything the reader sets by hand stops the automatic placement. */
  function set(next: Partial<QuoteComposition>) {
    setLayoutTouched(true);
    patch(next);
  }

  // --- Data ---------------------------------------------------------------

  const wanted: 'portrait' | 'landscape' = FORMAT_SPECS[composition.format].width >
    FORMAT_SPECS[composition.format].height
    ? 'landscape'
    : 'portrait';

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '60', orientation: wanted });
    if (mood) params.set('mood', mood);

    fetch(`${API_URL}/v1/wallpapers?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        const items: WallpaperSummary[] = data.items ?? [];
        setWallpapers(items);
        setTotal(data.total ?? 0);

        // Switching to a desktop card while a portrait photograph is chosen
        // would letterbox or crop it past recognition, so the background moves
        // to the first image of the right shape.
        //
        // Only on an actual switch, though. This effect also runs on mount,
        // and on a shared link the chosen wallpaper legitimately resolves to
        // nothing yet - it may be a plain ground, or an image outside the first
        // page of the picker. Substituting one there would quietly redraw
        // somebody else's card.
        if (!firstRun.current) {
          setSelected((current) => {
            if (current && current.orientation === wanted) return current;
            const replacement = items[0] ?? null;
            setComposition((c) => ({ ...c, wallpaperId: replacement?.slug ?? null }));
            return replacement;
          });
        }
        firstRun.current = false;
      })
      .catch(() => undefined);

    return () => controller.abort();
    // A landscape card wants landscape stock; showing portraits for a desktop
    // wallpaper just means every choice is a bad crop.
  }, [mood, wanted]);

  /** The next page, appended. The picker is a grid people scan, not a list
   *  they page through, so nothing already on screen moves. */
  async function loadMore() {
    const size = 60;
    const key = `${wanted}|${mood ?? ''}`;
    // A filter change reloads the grid from the top, so the first page after
    // one starts where that reload left off.
    const from =
      page && page.key === key ? page : { key, offset: wallpapers.length, drained: false };
    if (from.drained) return;

    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(size),
        offset: String(from.offset),
        orientation: wanted,
      });
      if (mood) params.set('mood', mood);
      const response = await fetch(`${API_URL}/v1/wallpapers?${params}`);
      if (!response.ok) return;
      const data = await response.json();
      const items: WallpaperSummary[] = data.items ?? [];

      // A short page is the end of the catalogue.
      const drained = items.length < size;
      setPage({ key, offset: from.offset + items.length, drained });

      // The window can still hand back a row already on screen; the first copy
      // stays put, so nothing the reader is looking at moves.
      const seen = new Set(wallpapers.map((w) => w.slug));
      const merged = [...wallpapers, ...items.filter((w) => !seen.has(w.slug))];
      setWallpapers(merged);
      // Once the catalogue is drained the grid holds everything it can reach,
      // whatever the count says: the rows the count includes and the grid does
      // not are the duplicates, already on screen under an earlier offset.
      // Leaving the larger number up leaves a button lit over nothing to fetch.
      setTotal(drained ? merged.length : data.total ?? total);
    } catch {
      // Leave the grid as it is; the button stays available to try again.
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const slug = selected?.slug;
    if (!slug) {
      setFullUrl(null);
      return;
    }
    const controller = new AbortController();
    fetch(`${API_URL}/v1/wallpapers/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setFullUrl(data?.fullUrl ?? null))
      // Leaving it null is honest: the canvas then reports that the export was
      // made from the preview rather than silently shipping an upscale.
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected?.slug]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`${API_URL}/v1/search?q=${encodeURIComponent(trimmed)}&limit=8`, {
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((data) => {
          setResults(
            (data.hits ?? []).map((hit: { verse: VerseData }) => ({
              ...hit.verse,
              verificationStatus: 'draft',
            })),
          );
        })
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  async function chooseVerse(ref: string) {
    const [chapter, number] = ref.split('.');
    try {
      const response = await fetch(`${API_URL}/v1/verses/${chapter}/${number}`);
      if (!response.ok) return;
      const data = await response.json();
      setVerse(data);
      patch({ ref });
      setQuery('');
      setResults([]);
    } catch {
      // Leave the current verse in place rather than blanking the card.
    }
  }

  // --- What actually gets drawn -------------------------------------------

  const content: QuoteContent = useMemo(() => {
    const translation =
      composition.translationLanguage === 'hi'
        ? (verse?.translationHindi ?? verse?.translationEnglish ?? null)
        : (verse?.translationEnglish ?? null);

    return {
      // Every layer comes from the API. Nothing on this card is typed by the
      // person making it except the caption, which is styled so it cannot read
      // as scripture.
      sanskrit: composition.layers.sanskrit ? (verse?.sanskrit ?? null) : null,
      transliteration: composition.layers.transliteration ? (verse?.transliteration ?? null) : null,
      translation: composition.layers.translation ? translation : null,
      // A merged record covers a span, and citing only its first number
      // misattributes the other verses in it. The range is what the text
      // actually is.
      reference: `Bhagavad Gita ${citationRef(composition.ref, verse?.verseNumberEnd ?? null)}`,
      caption: composition.caption,
      unverified: (verse?.verificationStatus ?? 'draft') !== 'published',
    };
  }, [composition, verse]);

  const shareUrl = `${siteUrl}/q/${encodeComposition(composition)}`;

  async function download() {
    setExporting(true);
    try {
      const blob = await canvasHandle.current?.toBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gita-${composition.ref.replace('.', '-')}-${composition.format}.png`;
      // In the document, and revoked on the next tick: revoking synchronously
      // after click() can cancel a download that has not started reading the
      // blob yet, which fails silently and looks like a dead button.
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      if (composition.wallpaperId) {
        // A bare counter, so the picker can lead with what people use. No verse,
        // no identity.
        void fetch(
          `${API_URL}/v1/wallpapers/${encodeURIComponent(composition.wallpaperId)}/used`,
          { method: 'POST' },
        );
      }
    } finally {
      setExporting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* Preview. Sticky on desktop so it stays in view while the controls scroll. */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <QuoteCanvas
          composition={composition}
          content={content}
          imageUrl={selected?.previewUrl ?? null}
          exportImageUrl={fullUrl}
          luminance={selected?.luminance ?? null}
          onReady={(handle) => {
            canvasHandle.current = handle;
          }}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void download()}
            disabled={exporting}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent
              px-5 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90
              disabled:opacity-50"
          >
            {exporting
              ? 'Rendering at full size…'
              : `Download ${FORMAT_SPECS[composition.format].label}`}
          </button>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border
              border-line px-4 text-sm text-text-secondary transition-colors hover:border-line-strong"
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>

        {selected?.attribution || selected?.photographer ? (
          <p className="mt-3 text-xs text-text-muted">
            Background: {selected.attribution ?? selected.photographer}
          </p>
        ) : null}
      </div>

      {/* Controls */}
      <div className="space-y-8">
        <Section title="Verse">
          <div className="rounded-lg border border-line bg-surface p-4">
            <p className="font-mono text-sm text-accent">{composition.ref}</p>
            {verse?.sanskrit ? (
              <p className="mt-2 line-clamp-2 font-devanagari text-base leading-devanagari" lang="sa">
                {verse.sanskrit.split('\n')[0]}
              </p>
            ) : null}
          </div>

          <label htmlFor="verse-search" className="sr-only">
            Find a verse
          </label>
          <input
            id="verse-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="2.47, karma, or a word from the verse"
            className="mt-3 min-h-[44px] w-full rounded-md border border-line bg-surface px-4 text-sm
              text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {searching ? <p className="mt-2 text-xs text-text-muted">Searching…</p> : null}
          {results.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {results.map((hit) => (
                <li key={hit.ref}>
                  <button
                    type="button"
                    onClick={() => void chooseVerse(hit.ref)}
                    className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="font-mono text-xs text-accent">{hit.ref}</span>
                    <span className="ml-2 text-sm text-text-secondary line-clamp-1">
                      {hit.translationEnglish ?? hit.sanskrit}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {results.length === 0 && suggestions.length > 0 ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-text-muted">Often quoted</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((item) => (
                  <Chip
                    key={item.ref}
                    label={`${item.ref} · ${item.hint}`}
                    active={composition.ref === item.ref}
                    onClick={() => void chooseVerse(item.ref)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </Section>

        <Section title="Size">
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => patch({ format: format as FormatName })}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  composition.format === format
                    ? 'border-accent bg-accent-muted'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <span
                  className={cn(
                    'block text-sm font-medium',
                    composition.format === format ? 'text-accent' : 'text-text-primary',
                  )}
                >
                  {FORMAT_SPECS[format].label}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-text-muted">
                  {FORMAT_SPECS[format].width}×{FORMAT_SPECS[format].height}
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Start from">
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => set(preset.patch)}
                className="rounded-lg border border-line bg-surface p-3 text-left transition-colors
                  hover:border-line-strong"
              >
                <span className="block text-sm font-medium text-text-primary">{preset.name}</span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section
          title="Background"
          hint={
            total > wallpapers.length
              ? `${wallpapers.length} of ${total}`
              : `${total} available`
          }
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Chip label="All" active={mood === null} onClick={() => setMood(null)} />
            {moods.map((item) => (
              <Chip
                key={item}
                label={item}
                className="capitalize"
                active={mood === item}
                onClick={() => setMood(mood === item ? null : item)}
              />
            ))}
          </div>

          <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => choose(null)}
              className={cn(
                'aspect-[9/16] rounded-md border-2 bg-sand-900 text-[10px] text-sand-300',
                composition.wallpaperId === null ? 'border-accent' : 'border-transparent',
              )}
            >
              None
            </button>
            {wallpapers.map((wallpaper) => (
              <button
                key={wallpaper.id}
                type="button"
                onClick={() => choose(wallpaper)}
                title={wallpaper.title ?? wallpaper.slug}
                className={cn(
                  'aspect-[9/16] overflow-hidden rounded-md border-2 transition-transform',
                  composition.wallpaperId === wallpaper.slug
                    ? 'border-accent'
                    : 'border-transparent hover:scale-[1.03]',
                )}
                // The dominant colour holds the grid steady while thumbs load.
                style={{ backgroundColor: wallpaper.dominantColor ?? '#241F18' }}
              >
                {wallpaper.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={wallpaper.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </button>
            ))}
          </div>

          {wallpapers.length < total ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-3 min-h-[44px] w-full rounded-md border border-line text-sm
                text-text-secondary transition-colors hover:border-line-strong disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : `Show ${Math.min(60, total - wallpapers.length)} more`}
            </button>
          ) : null}
        </Section>

        <Section title="Layout">
          <div className="space-y-1.5">
            {LAYOUTS.map((layout) => (
              <Option
                key={layout}
                active={composition.layout === layout}
                onClick={() => set({ layout: layout as LayoutName })}
                title={LAYOUT_INFO[layout].name}
                description={LAYOUT_INFO[layout].description}
              />
            ))}
          </div>
        </Section>

        <Section title="What to show">
          <div className="space-y-1">
            <Toggle
              label="Sanskrit"
              checked={composition.layers.sanskrit}
              onChange={(value) => patch({ layers: { ...composition.layers, sanskrit: value } })}
            />
            <Toggle
              label="Transliteration"
              checked={composition.layers.transliteration}
              onChange={(value) =>
                patch({ layers: { ...composition.layers, transliteration: value } })
              }
            />
            <Toggle
              label="Translation"
              checked={composition.layers.translation}
              onChange={(value) => patch({ layers: { ...composition.layers, translation: value } })}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Chip
              label="English"
              active={composition.translationLanguage === 'en'}
              onClick={() => patch({ translationLanguage: 'en' })}
            />
            <Chip
              label="हिन्दी"
              active={composition.translationLanguage === 'hi'}
              onClick={() => patch({ translationLanguage: 'hi' })}
            />
          </div>
        </Section>

        <Section title="Type size">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={SCALE_RANGE.min}
              max={SCALE_RANGE.max}
              step={SCALE_RANGE.step}
              value={composition.scale}
              onChange={(event) => patch({ scale: clampScale(Number(event.target.value)) })}
              aria-label="Type size"
              className="h-11 flex-1 accent-[rgb(var(--gita-accent))]"
            />
            <span className="w-12 text-right font-mono text-sm text-text-muted">
              {Math.round(composition.scale * 100)}%
            </span>
          </div>
        </Section>

        <Section title="Tone and accent">
          <div className="mb-2 flex flex-wrap gap-2">
            {(['auto', 'dark', 'light'] as const).map((tone) => (
              <Chip
                key={tone}
                label={tone === 'auto' ? 'Auto' : tone === 'dark' ? 'Light type' : 'Dark type'}
                active={composition.tone === tone}
                onClick={() => patch({ tone })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((accent) => (
              <Chip
                key={accent}
                label={accent}
                className="capitalize"
                active={composition.accent === accent}
                onClick={() => patch({ accent: accent as AccentName })}
              />
            ))}
          </div>
          {composition.tone === 'auto' && selected ? (
            <p className="mt-2 text-xs text-text-muted">
              Reading this image as {(selected.luminance ?? 0) > 0.62 ? 'bright' : 'dark'}, so the
              type is set {(selected.luminance ?? 0) > 0.62 ? 'dark' : 'light'}.
            </p>
          ) : null}
        </Section>

        <Section title="Your line" hint="optional">
          <input
            type="text"
            value={composition.caption ?? ''}
            onChange={(event) => patch({ caption: event.target.value.slice(0, 80) || null })}
            maxLength={80}
            placeholder="A name, a dedication, a handle"
            className="min-h-[44px] w-full rounded-md border border-line bg-surface px-4 text-sm
              text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Set small and apart from the verse, so it never reads as scripture. The verse itself
            comes from the library and cannot be edited here.
          </p>
        </Section>

        <button
          type="button"
          onClick={() => {
            // The canvas draws from `selected`, not from `composition`, so
            // resetting one without the other leaves a card showing a
            // photograph that its own share link says is not there.
            setSelected(null);
            setLayoutTouched(false);
            setComposition({ ...DEFAULT_COMPOSITION, wallpaperId: null, ref: composition.ref });
          }}
          className="text-sm text-text-muted underline-offset-4 hover:underline"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// --- Small controls -------------------------------------------------------

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
        {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Chip({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[36px] items-center rounded-full border px-3 text-xs transition-colors',
        className,
        active
          ? 'border-accent bg-accent-muted text-accent'
          : 'border-line text-text-secondary hover:border-line-strong',
      )}
    >
      {label}
    </button>
  );
}

function Option({
  title,
  description,
  active,
  onClick,
}: {
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        active ? 'border-accent bg-accent-muted' : 'border-line hover:border-line-strong',
      )}
    >
      <span className={cn('block text-sm font-medium', active ? 'text-accent' : 'text-text-primary')}>
        {title}
      </span>
      <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{description}</span>
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between">
      <span className="text-sm text-text-secondary">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-[rgb(var(--gita-accent))]"
      />
    </label>
  );
}
