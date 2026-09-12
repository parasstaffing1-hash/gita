import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs, Container, EmptyState } from '@/components/ui';
import { api, tryFetch } from '@/lib/api';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: 'Bhagavad Gita Reading Plans',
  description:
    'Structured ways through the Gita: a seven-day introduction, a chapter a day for ' +
    'eighteen days, and focused plans on karma yoga, discipline and stress.',
  path: '/reading-plans',
});

export default async function ReadingPlansPage() {
  const plans = await tryFetch(() => api.listReadingPlans(), []);

  return (
    <Container>
      <Breadcrumbs items={[{ name: 'Reading plans', path: '/reading-plans' }]} />

      <header className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl text-text-primary">Reading plans</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          The Gita rewards being read slowly, and in some order. These are a few orders that work.
        </p>
      </header>

      {plans.length === 0 ? (
        <EmptyState title="No reading plans imported yet" />
      ) : (
        <ul className="grid gap-5 md:grid-cols-2">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/reading-plans/${plan.slug}`}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-6
                  shadow-soft transition-all duration-200 ease-standard
                  hover:border-line-strong hover:shadow-card"
              >
                <div className="mb-2 flex items-center gap-3 text-xs text-text-muted">
                  <span>{plan.durationDays} days</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{plan.level}</span>
                </div>
                <h2 className="font-serif text-xl text-text-primary">{plan.title}</h2>
                {plan.subtitle ? (
                  <p className="mt-1 text-sm text-text-muted">{plan.subtitle}</p>
                ) : null}
                {plan.description ? (
                  <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-text-secondary">
                    {plan.description}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
