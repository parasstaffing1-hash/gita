/**
 * Verse rendering.
 *
 * Server Components throughout: the Sanskrit, transliteration, translations,
 * word meanings and commentary are all in the HTML that arrives, so the page
 * is readable with JavaScript disabled and fully indexable.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  Commentary,
  Translation,
  Verse,
  VerseSummary,
  VerseWord,
} from '@gita/types';

import { Badge, Card, UnverifiedNotice } from '@/components/ui';
import { cn } from '@/lib/utils';

export function VerseRef({ chapter, verse }: { chapter: number; verse: number }) {
  return (
    <span className="font-mono text-sm tabular-nums text-text-muted">
      {chapter}.{verse}
    </span>
  );
}

/** Devanagari verse text. Line breaks in the source are meaningful — pada boundaries. */
export function SanskritText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('verse-sanskrit whitespace-pre-line', className)} lang="sa">
      {text}
    </p>
  );
}

export function TransliterationText({ text }: { text: string }) {
  return (
    <p className="verse-transliteration whitespace-pre-line" lang="sa-Latn">
      {text}
    </p>
  );
}

export function TranslationText({
  translation,
  showAttribution = true,
}: {
  translation: Translation;
  showAttribution?: boolean;
}) {
  const isHindi = translation.languageCode.startsWith('hi') && translation.languageCode !== 'hi-Latn';
  return (
    <div>
      <p className={isHindi ? 'verse-hindi' : 'verse-translation'} lang={translation.languageCode}>
        {translation.text}
      </p>
      {showAttribution ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {translation.translatorName ? <span>{translation.translatorName}</span> : null}
          {translation.source?.name ? <span>· {translation.source.name}</span> : null}
          {/* Curated simplifications are labelled so they are never mistaken
              for a published translation. */}
          {translation.origin === 'curated' ? <Badge tone="neutral">Editorial</Badge> : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Word-by-word meanings.
 *
 * A definition list rather than a table: it reflows on a phone, reads correctly
 * to a screen reader, and keeps each Devanagari word next to its gloss.
 */
export function WordMeanings({ words }: { words: VerseWord[] }) {
  if (words.length === 0) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {words.map((word) => (
        <div key={word.id} className="border-b border-line pb-3">
          <dt className="font-devanagari text-lg text-text-primary" lang="sa">
            {word.wordDevanagari}
            {word.wordTransliteration ? (
              <span className="ml-2 font-translit text-sm italic text-text-muted">
                {word.wordTransliteration}
              </span>
            ) : null}
          </dt>
          <dd className="mt-1 text-sm text-text-secondary">
            {word.meaningEnglish ?? word.meaningHindi ?? '—'}
            {word.grammarNote ? (
              <span className="ml-2 text-xs text-text-muted">({word.grammarNote})</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CommentaryBlock({ commentary }: { commentary: Commentary }) {
  return (
    <article className="border-l-2 border-gold-300 pl-5">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-lg text-text-primary">
          {commentary.commentator?.name ?? 'Commentary'}
        </h3>
        {commentary.commentator?.tradition ? (
          <Badge tone="neutral">{commentary.commentator.tradition}</Badge>
        ) : null}
        {commentary.commentator?.period ? (
          <span className="text-xs text-text-muted">{commentary.commentator.period}</span>
        ) : null}
      </header>
      <div className="prose-reader whitespace-pre-line" lang={commentary.languageCode}>
        {commentary.text}
      </div>
      {commentary.source?.name ? (
        <p className="mt-3 text-xs text-text-muted">
          Source: {commentary.source.name}
          {commentary.source.license?.code ? ` · ${commentary.source.license.code}` : ''}
        </p>
      ) : null}
    </article>
  );
}

/** Compact verse card used in lists, search results and related-verse rails. */
export function VerseCard({
  verse,
  showSanskrit = true,
  className,
}: {
  verse: VerseSummary;
  showSanskrit?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/gita/${verse.chapterNumber}/${verse.verseNumber}`}
      className={cn(
        'group block rounded-lg border border-line bg-surface p-5 shadow-soft',
        'transition-all duration-200 ease-standard hover:border-line-strong hover:shadow-card',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <VerseRef chapter={verse.chapterNumber} verse={verse.verseNumber} />
        <span
          aria-hidden="true"
          className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
        >
          →
        </span>
      </div>
      {showSanskrit && verse.sanskrit ? (
        <p
          className="mb-3 line-clamp-2 font-devanagari text-lg leading-devanagari text-text-primary"
          lang="sa"
        >
          {verse.sanskrit.split('\n')[0]}
        </p>
      ) : null}
      {verse.translationEnglish ? (
        <p className="line-clamp-3 font-serif text-[0.95rem] leading-relaxed text-text-secondary">
          {verse.translationEnglish}
        </p>
      ) : null}
    </Link>
  );
}

/** A labelled block inside the verse reader. */
export function VerseSection({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Previous / next navigation. Rendered as real links so crawlers follow them. */
export function VerseNavigation({
  previous,
  next,
}: {
  previous: string | null;
  next: string | null;
}) {
  return (
    <nav aria-label="Verse navigation" className="mt-12 flex items-stretch gap-3 border-t border-line pt-6">
      {previous ? (
        <Link
          href={`/gita/${previous.replace('.', '/')}`}
          rel="prev"
          className="flex flex-1 items-center gap-3 rounded-lg border border-line px-4 py-3
            transition-colors hover:border-line-strong"
        >
          <span aria-hidden="true" className="text-text-muted">
            ←
          </span>
          <span>
            <span className="block text-xs text-text-muted">Previous</span>
            <span className="font-mono text-sm text-text-primary">{previous}</span>
          </span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}

      {next ? (
        <Link
          href={`/gita/${next.replace('.', '/')}`}
          rel="next"
          className="flex flex-1 items-center justify-end gap-3 rounded-lg border border-line px-4 py-3
            text-right transition-colors hover:border-line-strong"
        >
          <span>
            <span className="block text-xs text-text-muted">Next</span>
            <span className="font-mono text-sm text-text-primary">{next}</span>
          </span>
          <span aria-hidden="true" className="text-text-muted">
            →
          </span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </nav>
  );
}

/**
 * The full verse reader.
 *
 * Order is deliberate: Sanskrit first, then transliteration, then translation.
 * Someone who reads Devanagari should not have to scroll past English to reach
 * the verse.
 */
export function VerseReader({ verse, chapterName }: { verse: Verse; chapterName?: string }) {
  const english = verse.translations.filter((t) => t.languageCode === 'en');
  const hindi = verse.translations.filter((t) => t.languageCode.startsWith('hi'));
  const isUnverified = verse.verificationStatus !== 'published';

  return (
    <article>
      <header className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl text-text-primary">
            Bhagavad Gita {verse.chapterNumber}.{verse.verseNumber}
          </h1>
          {verse.speaker ? <Badge tone="accent">{verse.speaker} speaks</Badge> : null}
        </div>
        {chapterName ? (
          <p className="text-sm text-text-muted">
            Chapter {verse.chapterNumber} · {chapterName}
          </p>
        ) : null}
      </header>

      {isUnverified ? (
        <div className="mb-8">
          <UnverifiedNotice />
        </div>
      ) : null}

      {verse.sanskrit ? (
        <Card className="bg-surface-raised px-6 py-7">
          <SanskritText text={verse.sanskrit} />
          {verse.transliteration ? (
            <div className="mt-5 border-t border-line pt-5">
              <TransliterationText text={verse.transliteration} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {english.length > 0 ? (
        <VerseSection title="English translation">
          <div className="space-y-6">
            {english.map((translation) => (
              <TranslationText key={translation.id} translation={translation} />
            ))}
          </div>
        </VerseSection>
      ) : null}

      {hindi.length > 0 ? (
        <VerseSection title="हिन्दी अनुवाद">
          <div className="space-y-6">
            {hindi.map((translation) => (
              <TranslationText key={translation.id} translation={translation} />
            ))}
          </div>
        </VerseSection>
      ) : null}

      {verse.words.length > 0 ? (
        <VerseSection title="Word by word">
          <WordMeanings words={verse.words} />
        </VerseSection>
      ) : null}

      {verse.commentaries.length > 0 ? (
        <VerseSection title="Commentary">
          <div className="space-y-8">
            {verse.commentaries.map((commentary) => (
              <CommentaryBlock key={commentary.id} commentary={commentary} />
            ))}
          </div>
        </VerseSection>
      ) : null}

      {verse.topics.length > 0 ? (
        <VerseSection title="Topics">
          <ul className="flex flex-wrap gap-2">
            {verse.topics.map((topic) => (
              <li key={topic.id}>
                <Link
                  href={`/gita/topics/${topic.slug}`}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-line
                    px-4 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  {topic.name}
                </Link>
              </li>
            ))}
          </ul>
        </VerseSection>
      ) : null}

      {verse.relatedVerses.length > 0 ? (
        <VerseSection title="Related verses">
          <ul className="grid gap-4 sm:grid-cols-2">
            {verse.relatedVerses.map((related) => (
              <li key={related.verse.id}>
                <VerseCard verse={related.verse} />
                {related.note ? (
                  <p className="mt-2 px-1 text-xs text-text-muted">{related.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </VerseSection>
      ) : null}
    </article>
  );
}
