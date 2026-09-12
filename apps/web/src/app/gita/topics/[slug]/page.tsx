import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/json-ld';
import { Badge, Breadcrumbs, ButtonLink, Container, Divider, SectionHeading } from '@/components/ui';
import { VerseCard } from '@/components/verse';
import { api, fetchOrNull, tryFetch } from '@/lib/api';
import { breadcrumbJsonLd, topicMetadata } from '@/lib/seo';

export const revalidate = 3600;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const topics = await tryFetch(() => api.listTopics(), []);
  return topics.map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const topic = await fetchOrNull(() => api.getTopic(slug));
  return topic ? topicMetadata(topic) : {};
}

export default async function TopicPage({ params }: Params) {
  const { slug } = await params;
  const topic = await fetchOrNull(() => api.getTopic(slug));
  if (!topic) notFound();

  const crumbs = [
    { name: 'Gita', path: '/gita' },
    { name: 'Topics', path: '/gita/topics' },
    { name: topic.name, path: `/gita/topics/${topic.slug}` },
  ];

  return (
    <Container>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <Breadcrumbs items={crumbs} />

      <header className="mb-10 max-w-prose">
        <h1 className="font-serif text-4xl text-text-primary">
          What the Gita says about {topic.name.toLowerCase()}
        </h1>
        {topic.nameHindi ? (
          <p className="mt-2 font-devanagari text-lg text-text-muted" lang="hi">
            {topic.nameHindi}
          </p>
        ) : null}
        {topic.introduction ? <p className="prose-reader mt-6">{topic.introduction}</p> : null}
      </header>

      {topic.relatedConcepts.length > 0 ? (
        <div className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Related concepts
          </h2>
          <ul className="flex flex-wrap gap-2">
            {topic.relatedConcepts.map((concept) => (
              <li key={concept}>
                <Link href={`/gita/glossary/${concept}`}>
                  <Badge tone="neutral">{concept}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Divider />

      <section>
        <SectionHeading
          title={`Verses on ${topic.name.toLowerCase()}`}
          description={
            topic.verses.length > 0
              ? 'Chosen by an editor. Each note explains why the verse is here.'
              : undefined
          }
        />
        {topic.verses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm leading-relaxed text-text-muted">
            No verses have been mapped to this topic yet. Curation happens once the full verified
            text is imported — these mappings are made by hand, not generated.
          </p>
        ) : (
          <ul className="space-y-5">
            {topic.verses.map((entry) => (
              <li key={entry.verse.id}>
                <VerseCard verse={entry.verse} />
                {entry.note ? (
                  <p className="mt-2 border-l-2 border-gold-300 pl-4 text-sm leading-relaxed text-text-muted">
                    {entry.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {topic.relatedTopics.length > 0 ? (
        <section className="mt-12">
          <SectionHeading title="Related topics" level={3} />
          <ul className="flex flex-wrap gap-2">
            {topic.relatedTopics.map((related) => (
              <li key={related.id}>
                <Link
                  href={`/gita/topics/${related.slug}`}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4
                    text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  {related.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-12">
        <ButtonLink href={`/ask?q=${encodeURIComponent(`What does the Gita say about ${topic.name.toLowerCase()}?`)}`}>
          Ask about {topic.name.toLowerCase()}
        </ButtonLink>
      </div>
    </Container>
  );
}
