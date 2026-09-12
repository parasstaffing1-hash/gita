import Link from 'next/link';

import { Empty, ErrorPanel, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { getChanges, getDashboard } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let dashboard;
  let recent;
  try {
    [dashboard, recent] = await Promise.all([getDashboard(), getChanges({ limit: 8 })]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorPanel
          title="Could not reach the API"
          detail={
            `${error instanceof Error ? error.message : String(error)}\n\n` +
            'Check that the API is running and that ADMIN_API_TOKEN in this app matches ' +
            'the one the API is configured with.'
          }
        />
      </>
    );
  }

  const unpublished = dashboard.verses - dashboard.publishedVerses;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Content state, review queues and recent canonical changes."
      />

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Chapters" value={dashboard.chapters} hint="of 18" />
        <Stat label="Verses" value={dashboard.verses} hint="of 700" />
        <Stat label="Translations" value={dashboard.translations} />
        <Stat label="Commentaries" value={dashboard.commentaries} />
        <Stat label="Published verses" value={dashboard.publishedVerses} tone="accent" />
        <Stat
          label="Unpublished"
          value={unpublished}
          tone={unpublished > 0 ? 'warning' : 'neutral'}
          hint="draft or in review"
        />
        <Stat
          label="Pending reviews"
          value={dashboard.pendingReviews}
          tone={dashboard.pendingReviews > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Flagged AI answers"
          value={dashboard.flaggedAiAnswers}
          tone={dashboard.flaggedAiAnswers > 0 ? 'warning' : 'neutral'}
        />
      </section>

      {dashboard.verses < 700 ? (
        <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            The canon is incomplete: {dashboard.verses} of 700 verses.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-300">
            What is loaded is development placeholder content. It imports as draft and cannot be
            published until its source record is marked authoritative, so nothing here is being
            presented to readers as verified.
          </p>
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg text-text-primary">Recent canonical changes</h2>
          <Link href="/changes" className="text-sm text-accent hover:underline">
            Full log
          </Link>
        </div>
        {recent.items.length === 0 ? (
          <Empty>No canonical changes recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {recent.items.map((change) => (
              <li key={change.id} className="flex items-start gap-4 px-4 py-3">
                <StatusBadge status={change.action} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary">
                    <span className="font-mono">{change.recordRef ?? change.tableName}</span>
                    {change.fieldName ? (
                      <span className="text-text-muted"> · {change.fieldName}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">{change.reason}</p>
                </div>
                <p className="shrink-0 text-xs text-text-muted">
                  {change.editorEmail ?? 'unknown'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
