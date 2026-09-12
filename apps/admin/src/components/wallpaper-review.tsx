'use client';

import { useState, useTransition } from 'react';

import type { WallpaperAdmin } from '@/lib/admin-api';
import { cn } from '@/lib/utils';

const STAGES = [
  { value: 'review', label: 'Move to review' },
  { value: 'verified', label: 'Mark verified' },
  { value: 'published', label: 'Publish' },
  { value: 'draft', label: 'Back to draft' },
] as const;

/**
 * Batch review for the wallpaper library.
 *
 * A library arrives hundreds of images at a time under one licence, so
 * selection and a single reason is the normal path here — not an escape hatch.
 * Each row still gets its own audit entry, and the API refuses the whole batch
 * if any image in it has no licence recorded.
 */
export function WallpaperReview({
  wallpapers,
  onPublish,
  onSetActive,
}: {
  wallpapers: WallpaperAdmin[];
  onPublish: (ids: string[], status: string, reason: string) => Promise<void>;
  onSetActive: (id: string, isActive: boolean, reason: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(status: string) {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Say why. The reason is written to the audit log alongside the change.');
      return;
    }
    if (selected.size === 0) {
      setError('Nothing selected.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onPublish([...selected], status, trimmed);
        setSelected(new Set());
        setReason('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not apply that.');
      }
    });
  }

  return (
    <>
      <div className="sticky top-0 z-10 mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected.size === wallpapers.length
                  ? new Set()
                  : new Set(wallpapers.map((w) => w.id)),
              )
            }
            className="rounded-md border border-line px-3 py-1.5 text-sm text-text-secondary hover:border-line-strong"
          >
            {selected.size === wallpapers.length ? 'Select none' : 'Select all on this page'}
          </button>
          <span className="text-sm text-text-muted">{selected.size} selected</span>
        </div>

        <label htmlFor="wallpaper-reason" className="sr-only">
          Reason
        </label>
        <input
          id="wallpaper-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why — licence checked, artwork reviewed, taken down for…"
          className="mb-3 w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm
            text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />

        <div className="flex flex-wrap gap-2">
          {STAGES.map((stage) => (
            <button
              key={stage.value}
              type="button"
              disabled={pending}
              onClick={() => run(stage.value)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50',
                stage.value === 'published'
                  ? 'bg-accent text-accent-contrast hover:opacity-90'
                  : 'border border-line text-text-secondary hover:border-line-strong',
              )}
            >
              {stage.label}
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {wallpapers.map((wallpaper) => {
          const chosen = selected.has(wallpaper.id);
          return (
            <li key={wallpaper.id}>
              <button
                type="button"
                onClick={() => toggle(wallpaper.id)}
                aria-pressed={chosen}
                className={cn(
                  'block w-full overflow-hidden rounded-lg border-2 text-left transition-colors',
                  chosen ? 'border-accent' : 'border-line hover:border-line-strong',
                )}
              >
                <span
                  className={cn(
                    'block overflow-hidden bg-surface-sunken',
                    wallpaper.orientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]',
                  )}
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
                </span>
                <span className="block p-2">
                  <span className="block truncate font-mono text-[11px] text-text-muted">
                    {wallpaper.slug}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">
                      {wallpaper.verificationStatus}
                    </span>
                    {/* The licence is the thing that decides whether this can
                        ever be published, so it is on the card, not in a
                        detail view nobody opens. */}
                    {wallpaper.licenceCode ? null : (
                      <span className="text-[10px] font-medium text-rose-700 dark:text-rose-400">
                        no licence
                      </span>
                    )}
                    {wallpaper.isActive ? null : (
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">hidden</span>
                    )}
                  </span>
                </span>
              </button>

              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const trimmed = reason.trim();
                  if (trimmed.length < 3) {
                    setError('Say why before hiding or restoring an image.');
                    return;
                  }
                  setError(null);
                  startTransition(async () => {
                    try {
                      await onSetActive(wallpaper.id, !wallpaper.isActive, trimmed);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Could not apply that.');
                    }
                  });
                }}
                className="mt-1 w-full text-[11px] text-text-muted underline-offset-4 hover:underline disabled:opacity-50"
              >
                {wallpaper.isActive ? 'Hide from picker' : 'Restore'}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
