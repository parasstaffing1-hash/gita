import { revalidatePath } from 'next/cache';

import { ReviewControls } from '@/components/review-controls';
import { Empty, ErrorPanel, PageHeader, StatusBadge } from '@/components/ui';
import { getAiAnswers, reviewAiAnswer } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * AI answer review.
 *
 * A steady stream of rejected citations means retrieval or the prompt needs
 * work — not that the citation validator should be loosened. This queue exists
 * so that signal is visible rather than buried in logs.
 */
export default async function AiAnswersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  async function review(answerId: string, reviewStatus: string, note: string | null) {
    'use server';
    await reviewAiAnswer(answerId, reviewStatus, note);
    revalidatePath('/ai-answers');
  }

  let answers;
  try {
    answers = await getAiAnswers({ reviewStatus: status || undefined, limit: 50 });
  } catch (error) {
    return (
      <>
        <PageHeader title="AI answer review" />
        <ErrorPanel
          title="Could not load AI answers"
          detail={error instanceof Error ? error.message : String(error)}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="AI answer review"
        description={`${answers.total} answers. Anything with a rejected citation or a thumbs-down needs a look.`}
      />

      <nav className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = (status ?? '') === filter.value;
          return (
            <a
              key={filter.value || 'all'}
              href={filter.value ? `/ai-answers?status=${filter.value}` : '/ai-answers'}
              className={
                active
                  ? 'rounded-full border border-accent bg-accent-muted px-4 py-1.5 text-sm text-accent'
                  : 'rounded-full border border-line px-4 py-1.5 text-sm text-text-secondary hover:border-line-strong'
              }
            >
              {filter.label}
            </a>
          );
        })}
      </nav>

      {answers.items.length === 0 ? (
        <Empty>No answers match this filter.</Empty>
      ) : (
        <ul className="space-y-4">
          {answers.items.map((answer) => (
            <li key={answer.id} className="rounded-lg border border-line bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={answer.groundingStatus} />
                <StatusBadge status={answer.reviewStatus} />
                {answer.rejectedCitations.length > 0 ? (
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs
                    font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
                    {answer.rejectedCitations.length} rejected citation
                    {answer.rejectedCitations.length === 1 ? '' : 's'}
                  </span>
                ) : null}
                {answer.userFeedback === -1 ? (
                  <span className="text-xs text-rose-700 dark:text-rose-400">Marked unhelpful</span>
                ) : null}
                <span className="ml-auto text-xs text-text-muted">
                  {answer.modelProvider}/{answer.modelName} ·{' '}
                  {new Date(answer.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="whitespace-pre-line font-serif text-sm leading-relaxed text-text-secondary">
                {answer.answer.length > 600 ? `${answer.answer.slice(0, 600)}…` : answer.answer}
              </p>

              {answer.rejectedCitations.length > 0 ? (
                <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs text-text-muted">
                  Stripped: {answer.rejectedCitations.join(', ')}
                </p>
              ) : null}

              <div className="mt-4 border-t border-line pt-3">
                <ReviewControls answerId={answer.id} current={answer.reviewStatus} onReview={review} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
