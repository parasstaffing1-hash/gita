import type { Metadata } from 'next';

import { AskClient } from '@/components/ask-client';
import { Container } from '@/components/ui';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Ask the Gita — Answers Grounded in the Verses',
  description:
    'Ask a question in English, Hindi or Hinglish and get an answer built only from ' +
    'verses and commentary in this library, with every source shown.',
  path: '/ask',
});

interface Props {
  searchParams: Promise<{ q?: string; verse?: string }>;
}

export default async function AskPage({ searchParams }: Props) {
  const { q, verse } = await searchParams;

  return (
    <Container width="prose">
      <header className="mb-8">
        <h1 className="font-serif text-4xl text-text-primary">Ask the Gita</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          Every answer is assembled from verses and commentary stored in this library, and shows
          exactly which ones it used. If there is not enough here to answer your question
          confidently, it will tell you that rather than guess.
        </p>
        {verse ? (
          <p className="mt-3 text-sm text-accent">Anchored to verse {verse}</p>
        ) : null}
      </header>

      <AskClient initialQuestion={q ?? ''} verseRef={verse ?? null} />
    </Container>
  );
}
