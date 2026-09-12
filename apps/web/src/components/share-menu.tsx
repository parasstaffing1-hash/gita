'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Share controls for a verse.
 *
 * Uses the Web Share API where the browser has it (which is where sharing
 * actually happens — phones), and falls back to copy-link plus direct image
 * downloads everywhere else.
 */
export function ShareMenu({
  verseRef,
  url,
  translation,
}: {
  verseRef: string;
  url: string;
  translation: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const shareText = translation
    ? `Bhagavad Gita ${verseRef} — "${translation}"`
    : `Bhagavad Gita ${verseRef}`;

  async function nativeShare() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: `Bhagavad Gita ${verseRef}`, text: shareText, url });
        return;
      } catch {
        // The user dismissed the sheet, or the browser refused. Fall through
        // to the explicit options rather than failing silently.
      }
    }
    setOpen((value) => !value);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const cardSizes = [
    { size: 'story', label: 'Story (9:16)' },
    { size: 'square', label: 'Post (1:1)' },
    { size: 'og', label: 'Link card (1.91:1)' },
  ] as const;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void nativeShare()}
        aria-expanded={open}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-surface
          px-4 text-sm font-medium text-text-primary transition-colors hover:border-line-strong"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3m0 0L8 7m4-4 4 4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Share
      </button>

      {open ? (
        <div
          className="absolute left-0 z-20 mt-2 w-64 rounded-lg border border-line bg-surface-raised p-2 shadow-lifted"
          role="menu"
        >
          <button
            type="button"
            onClick={() => void copyLink()}
            className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm
              text-text-secondary transition-colors hover:bg-surface-sunken"
            role="menuitem"
          >
            <span>Copy link</span>
            {copied ? <span className="text-xs text-accent">Copied</span> : null}
          </button>

          <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Download card
          </p>
          {cardSizes.map((card) => (
            <a
              key={card.size}
              // Server-rendered image; the browser downloads it directly.
              href={`/gita/${verseRef.replace('.', '/')}/share?size=${card.size}`}
              download={`gita-${verseRef.replace('.', '-')}-${card.size}.png`}
              className={cn(
                'block rounded-md px-3 py-2.5 text-sm text-text-secondary',
                'transition-colors hover:bg-surface-sunken',
              )}
              role="menuitem"
            >
              {card.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
