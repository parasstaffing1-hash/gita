'use client';

import { useState, useTransition } from 'react';

import { cn } from '@/lib/utils';

const DECISIONS = [
  { value: 'approved', label: 'Approve' },
  { value: 'flagged', label: 'Flag' },
  { value: 'rejected', label: 'Reject' },
] as const;

export function ReviewControls({
  answerId,
  current,
  onReview,
}: {
  answerId: string;
  current: string;
  onReview: (answerId: string, reviewStatus: string, note: string | null) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {DECISIONS.map((decision) => (
        <button
          key={decision.value}
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await onReview(answerId, decision.value, note.trim() || null);
                setNote('');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not save the review.');
              }
            });
          }}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
            current === decision.value
              ? 'border-accent bg-accent-muted text-accent'
              : 'border-line text-text-secondary hover:border-line-strong',
          )}
        >
          {decision.label}
        </button>
      ))}

      <input
        type="text"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Reviewer note (optional)"
        maxLength={2000}
        className="min-w-48 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-xs
          text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />

      {error ? <p className="w-full text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
