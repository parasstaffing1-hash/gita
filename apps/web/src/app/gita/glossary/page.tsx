import type { Metadata } from 'next';
import Link from 'next/link';

import { Breadcrumbs, Container, EmptyState } from '@/components/ui';
import { api, tryFetch } from '@/lib/api';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: 'Bhagavad Gita Glossary: Sanskrit Terms and Their Meanings',
  description:
    'Dharma, karma, atman, brahman, moksha, yoga, bhakti and the other Sanskrit terms ' +
    'the Bhagavad Gita relies on, defined plainly.',
  path: '/gita/glossary',
});

export default async function GlossaryPage() {
  const terms = await tryFetch(() => api.listGlossary(), []);

  return (
    <Container>
      <Breadcrumbs
        items={[
          { name: 'Gita', path: '/gita' },
          { name: 'Glossary', path: '/gita/glossary' },
        ]}
      />

      <header className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl text-text-primary">Glossary</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          The Gita leans on a small number of Sanskrit terms that no single English word
          captures. Where the commentarial traditions read a term differently, the entry says so
          rather than picking a side.
        </p>
      </header>

      {terms.length === 0 ? (
        <EmptyState title="No glossary terms imported yet" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {terms.map((term) => (
            <li key={term.id}>
              <Link
                href={`/gita/glossary/${term.slug}`}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5
                  shadow-soft transition-all duration-200 ease-standard
                  hover:border-line-strong hover:shadow-card"
              >
                <span className="font-devanagari text-2xl leading-devanagari text-text-primary" lang="sa">
                  {term.termSanskrit}
                </span>
                <span className="mt-1 font-translit text-base italic text-accent">
                  {term.termTransliteration}
                </span>
                {term.termEnglish ? (
                  <span className="mt-1 text-sm text-text-muted">{term.termEnglish}</span>
                ) : null}
                <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-text-secondary">
                  {term.simpleDefinition}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
