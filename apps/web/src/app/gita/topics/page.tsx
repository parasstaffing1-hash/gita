import type { Metadata } from 'next';
import Link from 'next/link';
import type { TopicSummary } from '@gita/types';

import { Breadcrumbs, Container, EmptyState, SectionHeading } from '@/components/ui';
import { api, tryFetch } from '@/lib/api';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: 'Explore the Bhagavad Gita by Life Situation',
  description:
    'Verses on anger, fear, anxiety, grief, work, failure, duty and death — each list ' +
    'chosen by editors rather than assembled automatically.',
  path: '/gita/topics',
});

const GROUPS: Array<{ key: TopicSummary['category']; title: string; blurb: string }> = [
  {
    key: 'emotion',
    title: 'Emotions',
    blurb: 'What the text says about states most people would rather not be in.',
  },
  {
    key: 'life',
    title: 'Life',
    blurb: 'Work, relationships, decisions, and the things that fill a day.',
  },
  { key: 'practice', title: 'Practice', blurb: 'Meditation, discipline and devotion.' },
  { key: 'concept', title: 'Concepts', blurb: 'The ideas the Gita builds on.' },
];

export default async function TopicsPage() {
  const topics = await tryFetch(() => api.listTopics(), []);

  return (
    <Container>
      <Breadcrumbs
        items={[
          { name: 'Gita', path: '/gita' },
          { name: 'Topics', path: '/gita/topics' },
        ]}
      />

      <header className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl text-text-primary">Explore by life situation</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          Every list here was put together by a person. Nothing on these pages is assembled by a
          model at the moment you open it, so what you read on the anger page is what an editor
          decided belongs there.
        </p>
      </header>

      {topics.length === 0 ? (
        <EmptyState title="No topics imported yet" />
      ) : (
        GROUPS.map((group) => {
          const groupTopics = topics.filter((topic) => topic.category === group.key);
          if (groupTopics.length === 0) return null;
          return (
            <section key={group.key} className="mb-12">
              <SectionHeading title={group.title} description={group.blurb} />
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupTopics.map((topic) => (
                  <li key={topic.id}>
                    <Link
                      href={`/gita/topics/${topic.slug}`}
                      className="group flex h-full flex-col rounded-lg border border-line bg-surface p-4
                        shadow-soft transition-all duration-200 ease-standard
                        hover:border-line-strong hover:shadow-card"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-serif text-lg text-text-primary">{topic.name}</span>
                        {topic.verseCount > 0 ? (
                          <span className="shrink-0 text-xs text-text-muted">
                            {topic.verseCount}
                          </span>
                        ) : null}
                      </div>
                      {topic.nameHindi ? (
                        <span className="mt-0.5 font-devanagari text-sm text-text-muted" lang="hi">
                          {topic.nameHindi}
                        </span>
                      ) : null}
                      {topic.shortDescription ? (
                        <span className="mt-2 line-clamp-2 text-sm leading-relaxed text-text-muted">
                          {topic.shortDescription}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Container>
  );
}
