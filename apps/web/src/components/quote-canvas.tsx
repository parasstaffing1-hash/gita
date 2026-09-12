'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FORMAT_SPECS,
  REQUIRED_FONTS,
  computeLayout,
  renderQuote,
  type QuoteComposition,
  type QuoteContent,
} from '@gita/quote-composer';

/**
 * The live preview, and the thing that produces the download.
 *
 * The canvas is always the full output size — 2160×3840 for a 4K wallpaper —
 * and CSS scales it down to fit. That is what makes the preview honest: the
 * export is this exact canvas, not a second render at a different size that
 * might wrap a line differently.
 *
 * The one thing that does differ between preview and export is which copy of
 * the photograph is drawn. Browsing the picker at 4K would mean pulling a
 * multi-megabyte file on every click, so the preview uses the 1440px
 * derivative and the export re-renders from the original. Without that, a
 * "4K wallpaper" would be a 1440px image stretched to 3840 — worse than not
 * offering the size at all.
 */
export interface QuoteCanvasHandle {
  toBlob: () => Promise<Blob | null>;
}

interface Props {
  composition: QuoteComposition;
  content: QuoteContent;
  /** The fast derivative, drawn while composing. */
  imageUrl: string | null;
  /** The original, drawn only into the downloaded file. */
  exportImageUrl?: string | null;
  luminance: number | null;
  /** Called with a ready-to-download blob getter once the first paint lands. */
  onReady?: (handle: QuoteCanvasHandle) => void;
  className?: string;
}

/** Fonts must be resolved before measuring, or every line wraps twice. */
async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await Promise.all(REQUIRED_FONTS.map((font) => document.fonts.load(font)));
    await document.fonts.ready;
  } catch {
    // A font that will not load is not a reason to refuse to draw; the stack
    // falls back and the card is still correct, just not ideal.
  }
}

/**
 * A decoded 2160x3840 bitmap is around 33 MB, so an unbounded cache is a way
 * to have a tab killed after a dozen exports. Least-recently-used, small
 * enough to keep the picker responsive and bounded enough to survive a long
 * session on a phone.
 */
const CACHE_LIMIT = 8;
const imageCache = new Map<string, HTMLImageElement>();

function remember(url: string, image: HTMLImageElement): void {
  imageCache.delete(url);
  imageCache.set(url, image);
  while (imageCache.size > CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    imageCache.delete(oldest);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached?.complete) {
    remember(url, cached);
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    // Required, or the canvas is tainted and `toBlob` throws on export. The
    // API sets permissive CORS on /media for exactly this.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      remember(url, image);
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

export function QuoteCanvas({
  composition,
  content,
  imageUrl,
  exportImageUrl,
  luminance,
  onReady,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Paints are async and images load at wildly different speeds, so a slow
  // first pick can land on the canvas after a fast second one. The token is
  // checked immediately before drawing, so only the newest paint wins.
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(true);
  const spec = FORMAT_SPECS[composition.format];

  /** One painting path, so the export can never diverge from the preview. */
  const paint = useCallback(
    async (source: string | null): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;

      const mine = ++generation.current;

      await ensureFonts();

      let image: HTMLImageElement | null = null;
      let loaded = true;
      if (source) {
        try {
          image = await loadImage(source);
        } catch {
          loaded = false;
        }
      }

      // A newer paint started while this one was waiting on its image. Drawing
      // now would put the older wallpaper on screen under the newer one's
      // highlight - and leave it there for the next export.
      if (mine !== generation.current) return loaded;

      const layout = computeLayout(composition, { luminance });
      // Assigning width clears the canvas, so this is also the reset.
      canvas.width = layout.width;
      canvas.height = layout.height;
      renderQuote(context, { layout, content, image });
      return loaded;
    },
    [composition, content, luminance],
  );

  useEffect(() => {
    let cancelled = false;
    setDrawing(true);
    void paint(imageUrl)
      .then((loaded) => {
        if (cancelled) return;
        // Composing over a plain ground is a legitimate outcome, not an error
        // state — say so quietly and carry on.
        setError(loaded ? null : 'That background could not be loaded, so the verse is on a plain ground.');
      })
      .catch(() => {
        if (cancelled) return;
        setError('The card could not be drawn.');
      })
      // Without this the pulse overlay stays up forever on any throw.
      .finally(() => {
        if (!cancelled) setDrawing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paint, imageUrl]);

  useEffect(() => {
    if (!onReady) return;
    onReady({
      toBlob: async () => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        // Say so when the file cannot be what it claims. A 2160x3840 canvas
        // filled from the 1440px derivative is an upscale sold as 4K, and the
        // whole point of re-rendering here is not to do that. The download
        // still happens - a slightly softer wallpaper beats no wallpaper - but
        // the reader is told rather than left to notice.
        const full = exportImageUrl ?? imageUrl;
        const needsFullRes = Boolean(full) && full !== imageUrl;

        if (needsFullRes) {
          const loaded = await paint(full ?? null);
          setError(
            loaded
              ? null
              : 'The full-resolution background could not be loaded, so this file was ' +
                'made from the preview image and will be softer than it should be.',
          );
        } else if (imageUrl) {
          setError(
            'Only the preview-sized background is available, so this file was made ' +
              'from it rather than from the original.',
          );
        }

        try {
          return await new Promise<Blob | null>((resolve) => {
            // PNG rather than JPEG: type over a gradient is exactly where JPEG
            // ringing shows, and a wallpaper is looked at closely.
            canvas.toBlob((blob) => resolve(blob), 'image/png');
          });
        } finally {
          // Back to the light derivative, so the next control change is not
          // repainting a 4K photograph.
          if (needsFullRes) void paint(imageUrl);
        }
      },
    });
  }, [onReady, paint, imageUrl, exportImageUrl]);

  return (
    <div className={className}>
      {/* The canvas sizes itself. Its width/height attributes are the output
          size, so letting the element keep its intrinsic ratio and bounding it
          on both axes is what keeps a 9:16 card 9:16 — an `aspect-ratio` box
          with a `max-height` squashes the card whenever the height clamps. */}
      <div className="flex justify-center">
        <div className="relative inline-block overflow-hidden rounded-lg border border-line bg-surface-sunken shadow-lifted">
          <canvas
            ref={canvasRef}
            className="block h-auto max-h-[70vh] w-auto max-w-full"
            role="img"
            aria-label={`Preview of Bhagavad Gita ${composition.ref} on a ${spec.label.toLowerCase()} card`}
          />
          {drawing ? (
            <div className="pointer-events-none absolute inset-0 animate-pulse bg-surface-sunken/40" />
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-text-muted">
        {spec.width} × {spec.height} · {spec.hint}
      </p>
      {error ? (
        <p className="mt-1 text-center text-xs text-amber-700 dark:text-amber-400">{error}</p>
      ) : null}
    </div>
  );
}
