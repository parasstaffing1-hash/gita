import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/json-ld';
import { Badge, Breadcrumbs, Container } from '@/components/ui';
import { VerseCard } from '@/components/verse';
import { api, fetchOrNull, tryFetch } from '@/lib/api';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const plans = await tryFetch(() => api.listReadingPlans(), []);
  return plans.map((plan) => ({ slug: plan.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const plan = await fetchOrNull(() => api.getReadingPlan(slug));
  if (!plan) return {};
  return buildMetadata({
    title: `${plan.title} — Bhagavad Gita Reading Plan`,
    description:
      plan.description ?? `A ${plan.durationDays}-day reading plan through the Bhagavad Gita.`,
    path: `/reading-plans/${plan.slug}`,
    type: 'article',
  });
}

export default async function ReadingPlanPage({ params }: Params) {
  const { slug } = await params;
  const plan = await fetchOrNull(() => api.getReadingPlan(slug));
  if (!plan) notFound();

  const crumbs = [
    { name: 'Reading plans', path: '/reading-plans' },
    { name: plan.title, path: `/reading-plans/${plan.slug}` },
  ];

  return (
    <Container width="prose">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <Breadcrumbs items={crumbs} />

      <header className="mb-10">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{plan.durationDays} days</Badge>
          <Badge tone="neutral">{plan.level}</Badge>
        </div>
        <h1 className="font-serif text-4xl text-text-primary">{plan.title}</h1>
        {plan.subtitle ? <p className="mt-2 text-lg text-text-muted">{plan.subtitle}</p> : null}
        {plan.description ? <p className="prose-reader mt-5">{plan.description}</p> : null}
      </header>

      <ol className="space-y-8">
        {plan.days.map((day) => (
          <li key={day.id} className="border-t border-line pt-6">
            <div className="mb-2 flex items-baseline gap-3">
              <span className="font-mono text-sm tabular-nums text-gold-500">
                Day {String(day.dayNumber).padStart(2, '0')}
              </span>
              <span className="text-xs text-text-muted">{day.estimatedMinutes} min</span>
            </div>
            <h2 className="font-serif text-xl text-text-primary">{day.title}</h2>
            {day.intro ? (
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{day.intro}</p>
            ) : null}

            {day.verses.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {day.verses.map((verse) => (
                  <li key={verse.id}>
                    <VerseCard verse={verse} showSanskrit={false} />
                  </li>
                ))}
              </ul>
            ) : null}

            {day.reflection ? (
              <p className="mt-4 border-l-2 border-gold-300 pl-4 font-serif text-sm italic leading-relaxed text-text-muted">
                {day.reflection}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </Container>
  );
}
