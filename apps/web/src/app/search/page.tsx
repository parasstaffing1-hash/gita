import type { Metadata } from 'next';
import Link from 'next/link';

import { Container, EmptyState } from '@/components/ui';
import { VerseCard } from '@/components/verse';
import { api, tryFetch } from '@/lib/api';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  ...buildMetadata({
    title: 'Search the Bhagavad Gita',
    description:
      'Search by verse reference, Sanskrit, transliteration, Hindi, English or Hinglish.',
    path: '/search',
  }),
  // Result pages are not useful in an index and would bloat the crawl budget.
  robots: { index: false, follow: true },
};

interface Props {
  searchParams: Promise<{ q?: string }>;
}

/**
 * Search results, rendered on the server.
 *
 * A GET form and server rendering means results are shareable, work without
 * JavaScript, and appear in one round trip.
 */
export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const results = query
    ? await tryFetch(() => api.search(query, { limit: 30 }), null)
    : null;

  return (
    <Container width="prose">
      <h1 className="mb-6 font-serif text-3xl text-text-primary">Search</h1>

      <form action="/search" method="get" role="search">
        <label htmlFor="q" className="sr-only">
          Search verses, topics or ask a question
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="2.47, karma, कर्म, or “how do I deal with fear?”"
            className="min-h-[44px] flex-1 rounded-md border border-line bg-surface px-4 text-base
              text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center rounded-md bg-accent px-5 text-sm
              font-medium text-accent-contrast transition-opacity hover:opacity-90"
          >
            Search
          </button>
        </div>
      </form>

      <p className="mt-3 text-sm text-text-muted">
        References, Sanskrit, transliteration and Hinglish all work.{' '}
        <Link href="/ask" className="text-accent hover:underline">
          Ask a full question instead
        </Link>
        .
      </p>

      {results ? (
        <section className="mt-10">
          <p className="mb-5 text-sm text-text-muted">
            {results.total} result{results.total === 1 ? '' : 's'} · detected{' '}
            {results.detectedLanguage} · {results.tookMs}ms
          </p>

          {results.topics.length > 0 ? (
            <div className="mb-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Topics
              </h2>
              <ul className="flex flex-wrap gap-2">
                {results.topics.map((topic) => (
                  <li key={topic.id}>
                    <Link
                      href={`/gita/topics/${topic.slug}`}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4
                        text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
                    >
                      {topic.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {results.glossary.length > 0 ? (
            <div className="mb-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Glossary
              </h2>
              <ul className="space-y-2">
                {results.glossary.map((term) => (
                  <li key={term.id}>
                    <Link
                      href={`/gita/glossary/${term.slug}`}
                      className="block rounded-md border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong"
                    >
                      <span className="font-translit italic text-accent">
                        {term.termTransliteration}
                      </span>
                      <span className="ml-2 font-devanagari text-text-primary" lang="sa">
                        {term.termSanskrit}
                      </span>
                      <span className="mt-1 block text-sm text-text-muted">
                        {term.simpleDefinition}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {results.hits.length === 0 ? (
            <EmptyState
              title="No verses matched that"
              body="Try a single word, a verse reference such as 2.47, or ask a full question."
            />
          ) : (
            <ul className="space-y-4">
              {results.hits.map((hit) => (
                <li key={hit.verse.id}>
                  <VerseCard verse={hit.verse} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </Container>
  );
}
