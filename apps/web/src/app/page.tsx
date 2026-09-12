import Link from 'next/link';

import { VerseCard } from '@/components/verse';
import { ButtonLink, Container, Divider, LinkCard, SectionHeading } from '@/components/ui';
import { api, tryFetch } from '@/lib/api';

/**
 * Home.
 *
 * Statically rendered and revalidated hourly. Everything a first-time visitor
 * needs is in the HTML: what this is, where to start, and a real verse.
 */
export const revalidate = 3600;

export default async function HomePage() {
  const [chapters, topics, daily] = await Promise.all([
    tryFetch(() => api.listChapters(), []),
    tryFetch(() => api.listTopics(), []),
    tryFetch(() => api.dailyVerse(), null),
  ]);

  const emotions = topics.filter((t) => t.category === 'emotion').slice(0, 8);
  const life = topics.filter((t) => t.category === 'life').slice(0, 8);

  return (
    <Container>
      <section className="py-12 sm:py-20">
        <p className="mb-4 text-sm uppercase tracking-widest text-gold-500">श्रीमद्भगवद्गीता</p>
        <h1 className="max-w-2xl font-serif text-4xl leading-tight text-text-primary sm:text-5xl">
          Read, listen and understand the Bhagavad&nbsp;Gita
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-secondary">
          Eighteen chapters, seven hundred verses. Sanskrit alongside transliteration and
          translation, with word meanings, commentary and explanations that always cite the verses
          they come from.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/gita">Start reading</ButtonLink>
          <ButtonLink href="/start-here" variant="secondary">
            New to the Gita?
          </ButtonLink>
        </div>
      </section>

      {daily ? (
        <section aria-labelledby="daily-heading" className="mb-16">
          <SectionHeading
            title="Shloka of the day"
            description={daily.reflection ? undefined : 'One verse, each day.'}
          />
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <VerseCard verse={daily.verse} />
            {daily.reflection ? (
              <aside className="rounded-lg border border-line bg-surface-sunken p-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Reflection
                </h3>
                <p className="prose-reader text-[0.95rem]">{daily.reflection}</p>
              </aside>
            ) : null}
          </div>
        </section>
      ) : null}

      <Divider ornament />

      <section aria-labelledby="chapters-heading" className="mb-16">
        <SectionHeading
          title="The eighteen chapters"
          description="Each chapter opens with a summary, its major teachings and its key verses."
          action={
            <Link href="/gita" className="text-sm text-accent hover:underline">
              See all
            </Link>
          }
        />
        {chapters.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {chapters.slice(0, 6).map((chapter) => (
              <li key={chapter.id}>
                <LinkCard href={`/gita/chapter/${chapter.number}`}>
                  <p className="mb-1 font-mono text-xs text-text-muted">
                    Chapter {chapter.number} · {chapter.verseCount} verses
                  </p>
                  {chapter.nameSanskrit ? (
                    <p className="mb-1 font-devanagari text-lg text-text-primary" lang="sa">
                      {chapter.nameSanskrit}
                    </p>
                  ) : null}
                  <p className="font-serif text-base text-text-secondary">{chapter.nameEnglish}</p>
                </LinkCard>
              </li>
            ))}
          </ul>
        ) : (
          <ContentPending />
        )}
      </section>

      {emotions.length > 0 || life.length > 0 ? (
        <section aria-labelledby="explore-heading" className="mb-16">
          <SectionHeading
            title="Explore by life situation"
            description="Verses chosen by editors, not assembled by a model at request time."
          />
          <div className="grid gap-8 md:grid-cols-2">
            <TopicGroup title="Emotions" topics={emotions} />
            <TopicGroup title="Life" topics={life} />
          </div>
        </section>
      ) : null}

      <section className="mb-8 rounded-xl border border-line bg-surface-sunken p-8">
        <h2 className="font-serif text-2xl text-text-primary">Ask the Gita</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-text-secondary">
          Ask a question in English, Hindi or Hinglish. Answers are built only from verses and
          commentary stored in this library, and every one shows exactly which verses it drew on.
          When there is not enough to answer confidently, it says so instead of guessing.
        </p>
        <div className="mt-6">
          <ButtonLink href="/ask">Ask a question</ButtonLink>
        </div>
      </section>
    </Container>
  );
}

function TopicGroup({
  title,
  topics,
}: {
  title: string;
  topics: Array<{ id: string; slug: string; name: string; verseCount: number }>;
}) {
  if (topics.length === 0) return null;
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      <ul className="flex flex-wrap gap-2">
        {topics.map((topic) => (
          <li key={topic.id}>
            <Link
              href={`/gita/topics/${topic.slug}`}
              className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface
                px-4 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              {topic.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Shown when the API has no content yet — a fresh clone before the import has
 * run. It tells the developer exactly what to do rather than rendering nothing.
 */
function ContentPending() {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-serif text-lg text-text-secondary">No content imported yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
        Start the database and run the importer:
      </p>
      <pre className="mx-auto mt-4 w-fit rounded-md bg-surface-sunken px-4 py-3 text-left font-mono text-xs text-text-secondary">
        pnpm db:up{'\n'}
        cd apps/api{'\n'}
        alembic upgrade head{'\n'}
        python -m scripts.import_content ../../content --all
      </pre>
    </div>
  );
}
