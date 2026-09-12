import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs, Container, EmptyState, SectionHeading } from '@/components/ui';
import { api, tryFetch } from '@/lib/api';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: 'Bhagavad Gita: All 18 Chapters and 700 Verses',
  description:
    'Read all eighteen chapters of the Bhagavad Gita with Sanskrit, transliteration, ' +
    'Hindi and English translations, word meanings and commentary.',
  path: '/gita',
});

export default async function GitaIndexPage() {
  const chapters = await tryFetch(() => api.listChapters(), []);
  const totalVerses = chapters.reduce((sum, chapter) => sum + chapter.verseCount, 0);

  return (
    <Container>
      <Breadcrumbs items={[{ name: 'Gita', path: '/gita' }]} />

      <header className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl text-text-primary">The Bhagavad Gita</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          Eighteen chapters{totalVerses ? `, ${totalVerses} verses` : ''}. A conversation between
          Arjuna and Krishna on a battlefield, about what to do when every available action seems
          wrong.
        </p>
      </header>

      {chapters.length === 0 ? (
        <EmptyState
          title="No chapters imported yet"
          body="Run the content importer to populate the database."
        />
      ) : (
        <>
          <SectionHeading title="Chapters" />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <Link
                  href={`/gita/chapter/${chapter.number}`}
                  className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5
                    shadow-soft transition-all duration-200 ease-standard
                    hover:border-line-strong hover:shadow-card"
                >
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="font-mono text-2xl tabular-nums text-gold-500">
                      {String(chapter.number).padStart(2, '0')}
                    </span>
                    <span className="text-xs text-text-muted">{chapter.verseCount} verses</span>
                  </div>
                  {chapter.nameSanskrit ? (
                    <p
                      className="mb-1 font-devanagari text-lg leading-devanagari text-text-primary"
                      lang="sa"
                    >
                      {chapter.nameSanskrit}
                    </p>
                  ) : null}
                  <p className="font-serif text-base text-text-secondary">{chapter.nameEnglish}</p>
                  {chapter.summary ? (
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-text-muted">
                      {chapter.summary}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </Container>
  );
}
