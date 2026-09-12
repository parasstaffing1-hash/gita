import { revalidatePath } from 'next/cache';

import { RollbackButton } from '@/components/rollback-button';
import { Empty, ErrorPanel, PageHeader, StatusBadge, Table, Td, Th } from '@/components/ui';
import { getChanges, rollbackChange } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/**
 * The canonical change log.
 *
 * Append-only. Every edit to scripture writes a row here with the previous
 * value, the new value, who made it and why — which is what makes an edit
 * reversible and what an auditor reads to answer "who changed 2.47?".
 */
export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; offset?: string }>;
}) {
  const { table, offset: offsetParam } = await searchParams;
  const offset = Number.parseInt(offsetParam ?? '0', 10) || 0;

  /** Restores the previous value and logs the rollback itself. */
  async function rollback(changeId: string, reason: string) {
    'use server';
    await rollbackChange(changeId, reason);
    revalidatePath('/changes');
  }

  let changes;
  try {
    changes = await getChanges({ limit: 50, offset, tableName: table });
  } catch (error) {
    return (
      <>
        <PageHeader title="Change log" />
        <ErrorPanel
          title="Could not load the change log"
          detail={error instanceof Error ? error.message : String(error)}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Change log"
        description={`${changes.total} recorded changes to canonical content. Every edit is reversible.`}
      />

      {changes.items.length === 0 ? (
        <Empty>No changes recorded yet.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Record</Th>
              <Th>Action</Th>
              <Th>Change</Th>
              <Th>Reason</Th>
              <Th>Editor</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {changes.items.map((change) => (
              <tr key={change.id}>
                <Td className="whitespace-nowrap text-xs text-text-muted">
                  {new Date(change.createdAt).toLocaleString()}
                </Td>
                <Td>
                  <span className="font-mono text-sm">{change.recordRef ?? '—'}</span>
                  <span className="block text-xs text-text-muted">{change.tableName}</span>
                </Td>
                <Td>
                  <StatusBadge status={change.action} />
                </Td>
                <Td className="max-w-md">
                  {change.fieldName ? (
                    <p className="mb-1 text-xs font-medium text-text-muted">{change.fieldName}</p>
                  ) : null}
                  <ValueDiff
                    previous={change.previousValue}
                    next={change.newValue}
                    field={change.fieldName}
                  />
                </Td>
                <Td className="max-w-xs text-xs text-text-secondary">{change.reason}</Td>
                <Td className="whitespace-nowrap text-xs text-text-muted">
                  {change.editorEmail ?? 'unknown'}
                </Td>
                <Td>
                  {change.previousValue ? (
                    <RollbackButton changeId={change.id} onRollback={rollback} />
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <nav className="mt-6 flex justify-between">
        {offset > 0 ? (
          <a
            href={`/changes?offset=${Math.max(0, offset - 50)}`}
            className="text-sm text-accent hover:underline"
          >
            ← Newer
          </a>
        ) : (
          <span />
        )}
        {offset + changes.items.length < changes.total ? (
          <a href={`/changes?offset=${offset + 50}`} className="text-sm text-accent hover:underline">
            Older →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}

/** Shows what actually changed, truncated so one long verse cannot flood the row. */
function ValueDiff({
  previous,
  next,
  field,
}: {
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  field: string | null;
}) {
  const key = field ?? 'value';
  const before = previous ? String(previous[key] ?? '') : null;
  const after = next ? String(next[key] ?? '') : null;

  const clip = (value: string) => (value.length > 140 ? `${value.slice(0, 140)}…` : value);

  return (
    <div className="space-y-1 text-xs">
      {before ? (
        <p className="text-rose-700 dark:text-rose-400">
          <span className="select-none opacity-60">− </span>
          {clip(before)}
        </p>
      ) : (
        <p className="text-text-muted">(created)</p>
      )}
      {after ? (
        <p className="text-emerald-700 dark:text-emerald-400">
          <span className="select-none opacity-60">+ </span>
          {clip(after)}
        </p>
      ) : null}
    </div>
  );
}
