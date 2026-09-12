import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/json-ld';
import { Badge, Breadcrumbs, Container, Divider, SectionHeading } from '@/components/ui';
import { VerseCard } from '@/components/verse';
import { api, fetchOrNull, tryFetch } from '@/lib/api';
import { breadcrumbJsonLd, glossaryJsonLd, glossaryMetadata } from '@/lib/seo';

export const revalidate = 3600;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const terms = await tryFetch(() => api.listGlossary(), []);
  return terms.map((term) => ({ slug: term.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const term = await fetchOrNull(() => api.getGlossaryTerm(slug));
  return term ? glossaryMetadata(term) : {};
}

export default async function GlossaryTermPage({ params }: Params) {
  const { slug } = await params;
  const term = await fetchOrNull(() => api.getGlossaryTerm(slug));
  if (!term) notFound();

  const crumbs = [
    { name: 'Gita', path: '/gita' },
    { name: 'Glossary', path: '/gita/glossary' },
    { name: term.termTransliteration, path: `/gita/glossary/${term.slug}` },
  ];

  return (
    <Container width="prose">
      <JsonLd data={glossaryJsonLd(term)} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <Breadcrumbs items={crumbs} />

      <header className="mb-8">
        <h1 className="font-devanagari text-5xl leading-devanagari text-text-primary" lang="sa">
          {term.termSanskrit}
        </h1>
        <p className="mt-2 font-translit text-2xl italic text-accent">
          {term.termTransliteration}
        </p>
        {term.termEnglish ? (
          <p className="mt-1 text-lg text-text-muted">{term.termEnglish}</p>
        ) : null}
      </header>

      <p className="border-l-2 border-gold-300 pl-5 font-serif text-lg leading-relaxed text-text-primary">
        {term.simpleDefinition}
      </p>

      {term.detailedDefinition ? (
        <div className="mt-8">
          <SectionHeading title="In more depth" level={3} />
          <p className="prose-reader whitespace-pre-line">{term.detailedDefinition}</p>
        </div>
      ) : null}

      {term.variants.length > 0 || term.synonyms.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Also written
          </h2>
          <ul className="flex flex-wrap gap-2">
            {[...term.variants, ...term.synonyms].map((variant) => (
              <li key={variant}>
                <Badge tone="neutral">{variant}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {term.relatedTermSlugs.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Related terms
          </h2>
          <ul className="flex flex-wrap gap-2">
            {term.relatedTermSlugs.map((related) => (
              <li key={related}>
                <Link
                  href={`/gita/glossary/${related}`}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4
                    text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  {related}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {term.relatedVerses.length > 0 ? (
        <>
          <Divider />
          <SectionHeading title="Where it appears" level={3} />
          <ul className="space-y-4">
            {term.relatedVerses.map((verse) => (
              <li key={verse.id}>
                <VerseCard verse={verse} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Container>
  );
}
