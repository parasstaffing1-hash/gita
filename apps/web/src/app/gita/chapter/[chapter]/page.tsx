import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/json-ld';
import {
  Badge,
  Breadcrumbs,
  ButtonLink,
  Card,
  Container,
  Divider,
  SectionHeading,
} from '@/components/ui';
import { VerseCard, VerseRef } from '@/components/verse';
import { api, fetchOrNull, tryFetch } from '@/lib/api';
import { breadcrumbJsonLd, chapterJsonLd, chapterMetadata } from '@/lib/seo';

export const revalidate = 3600;

interface Params {
  params: Promise<{ chapter: string }>;
}

export async function generateStaticParams() {
  // All 18 are cheap and are the main entry points from search engines.
  return Array.from({ length: 18 }, (_, index) => ({ chapter: String(index + 1) }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { chapter } = await params;
  const number = Number.parseInt(chapter, 10);
  if (!Number.isInteger(number) || number < 1 || number > 18) return {};
  const data = await fetchOrNull(() => api.getChapter(number));
  return data ? chapterMetadata(data) : {};
}

export default async function ChapterPage({ params }: Params) {
  const { chapter } = await params;
  const number = Number.parseInt(chapter, 10);
  if (!Number.isInteger(number) || number < 1 || number > 18) notFound();

  const data = await fetchOrNull(() => api.getChapter(number));
  if (!data) notFound();

  const verses = await tryFetch(() => api.listChapterVerses(number, { limit: 200 }), {
    items: [],
    total: 0,
    limit: 200,
    offset: 0,
  });

  const keyRefs = new Set(data.keyVerses.map((v) => `${v.chapter}.${v.verse}`));
  const keyVerses = verses.items.filter((v) => keyRefs.has(v.ref));

  const crumbs = [
    { name: 'Gita', path: '/gita' },
    { name: `Chapter ${data.number}`, path: `/gita/chapter/${data.number}` },
  ];

  return (
    <Container>
      <JsonLd data={chapterJsonLd(data)} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <Breadcrumbs items={crumbs} />

      <header className="mb-10 max-w-prose">
        <p className="mb-2 font-mono text-sm text-gold-500">
          Chapter {data.number} of 18 · {data.verseCount} verses
        </p>
        {data.nameSanskrit ? (
          <h1 className="font-devanagari text-4xl leading-devanagari text-text-primary" lang="sa">
            {data.nameSanskrit}
          </h1>
        ) : null}
        <p className="mt-2 font-serif text-2xl text-text-secondary">{data.nameEnglish}</p>
        {data.nameTransliteration ? (
          <p className="mt-1 font-translit text-sm italic text-text-muted">
            {data.nameTransliteration}
          </p>
        ) : null}

        {data.summary ? <p className="prose-reader mt-6">{data.summary}</p> : null}

        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href={`/gita/${data.number}/1`}>Start reading</ButtonLink>
        </div>
      </header>

      {data.majorTeachings.length > 0 || data.keyConcepts.length > 0 ? (
        <div className="mb-12 grid gap-6 md:grid-cols-2">
          {data.majorTeachings.length > 0 ? (
            <Card>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Major teachings
              </h2>
              <ul className="space-y-3">
                {data.majorTeachings.map((teaching) => (
                  <li key={teaching} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                    <span aria-hidden="true" className="mt-1 text-gold-500">
                      ❦
                    </span>
                    <span>{teaching}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.keyConcepts.length > 0 ? (
            <Card>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Key concepts
              </h2>
              <ul className="flex flex-wrap gap-2">
                {data.keyConcepts.map((concept) => (
                  <li key={concept}>
                    <Link href={`/gita/glossary/${concept}`}>
                      <Badge tone="neutral">{concept}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      {keyVerses.length > 0 ? (
        <section className="mb-12">
          <SectionHeading title="Key verses" description="Where this chapter turns." />
          <ul className="grid gap-4 sm:grid-cols-2">
            {keyVerses.map((verse) => (
              <li key={verse.id}>
                <VerseCard verse={verse} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Divider ornament />

      <section>
        <SectionHeading
          title="All verses"
          description={
            verses.items.length < data.verseCount
              ? `${verses.items.length} of ${data.verseCount} verses are in the library so far.`
              : undefined
          }
        />
        {verses.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-text-muted">
            No verses from this chapter have been imported yet.
          </p>
        ) : (
          <ol className="divide-y divide-line border-y border-line">
            {verses.items.map((verse) => (
              <li key={verse.id}>
                <Link
                  href={`/gita/${verse.chapterNumber}/${verse.verseNumber}`}
                  className="group flex gap-5 py-5 transition-colors hover:bg-surface-sunken"
                >
                  <span className="w-12 shrink-0 pt-1">
                    <VerseRef chapter={verse.chapterNumber} verse={verse.verseNumber} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {verse.sanskrit ? (
                      <span
                        className="block truncate font-devanagari text-lg leading-devanagari text-text-primary"
                        lang="sa"
                      >
                        {verse.sanskrit.split('\n')[0]}
                      </span>
                    ) : null}
                    {verse.translationEnglish ? (
                      <span className="mt-1 block line-clamp-2 font-serif text-sm leading-relaxed text-text-muted">
                        {verse.translationEnglish}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <nav aria-label="Chapter navigation" className="mt-12 flex justify-between gap-4">
        {data.number > 1 ? (
          <ButtonLink href={`/gita/chapter/${data.number - 1}`} variant="secondary">
            ← Chapter {data.number - 1}
          </ButtonLink>
        ) : (
          <span />
        )}
        {data.number < 18 ? (
          <ButtonLink href={`/gita/chapter/${data.number + 1}`} variant="secondary">
            Chapter {data.number + 1} →
          </ButtonLink>
        ) : (
          <span />
        )}
      </nav>
    </Container>
  );
}
