'use client';

import { useState, useTransition } from 'react';

/**
 * Rolling back a canonical change requires a reason, exactly like making one.
 * The API rejects a blank reason, so asking here is not a formality — it is the
 * same rule enforced closer to the editor.
 */
export function RollbackButton({
  changeId,
  onRollback,
}: {
  changeId: string;
  onRollback: (changeId: string, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-md border border-line px-3 py-1.5 text-xs
          text-text-secondary transition-colors hover:border-line-strong"
      >
        Roll back
      </button>
    );
  }

  return (
    <div className="w-56 space-y-2">
      <label className="block text-xs text-text-muted" htmlFor={`reason-${changeId}`}>
        Reason for rolling back
      </label>
      <textarea
        id={`reason-${changeId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        className="w-full rounded-md border border-line bg-surface p-2 text-xs text-text-primary
          focus:border-accent focus:outline-none"
      />
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || reason.trim().length < 3}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await onRollback(changeId, reason.trim());
                setOpen(false);
                setReason('');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Rollback failed.');
              }
            });
          }}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast
            transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Rolling back…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
