import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/json-ld';
import { ShareMenu } from '@/components/share-menu';
import { Breadcrumbs, ButtonLink, Container } from '@/components/ui';
import { VerseNavigation, VerseReader } from '@/components/verse';
import { api, fetchOrNull, tryFetch } from '@/lib/api';
import { absoluteUrl, breadcrumbJsonLd, verseJsonLd, verseMetadata } from '@/lib/seo';

/**
 * The verse page — the most important page on the site.
 *
 * Fully server-rendered: Sanskrit, transliteration, translations, word
 * meanings and commentary are all in the initial HTML. Nothing a crawler or a
 * reader with JavaScript disabled needs is fetched on the client.
 */
export const revalidate = 3600;
export const dynamicParams = true;

interface Params {
  params: Promise<{ chapter: string; verse: string }>;
}

/**
 * Pre-render the opening of each chapter at build time.
 *
 * Generating all 700 verse pages up front would make a deploy slow for pages
 * almost nobody opens first. The rest render on demand and are cached from
 * then on, which is the right trade at this size.
 */
export async function generateStaticParams() {
  const chapters = await tryFetch(() => api.listChapters(), []);
  return chapters.flatMap((chapter) =>
    Array.from({ length: Math.min(3, chapter.verseCount) }, (_, index) => ({
      chapter: String(chapter.number),
      verse: String(index + 1),
    })),
  );
}

function parseParams(chapter: string, verse: string) {
  const chapterNumber = Number.parseInt(chapter, 10);
  const verseNumber = Number.parseInt(verse, 10);
  if (!Number.isInteger(chapterNumber) || !Number.isInteger(verseNumber)) return null;
  if (chapterNumber < 1 || chapterNumber > 18 || verseNumber < 1) return null;
  return { chapterNumber, verseNumber };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { chapter, verse } = await params;
  const parsed = parseParams(chapter, verse);
  if (!parsed) return {};

  const data = await fetchOrNull(() => api.getVerse(parsed.chapterNumber, parsed.verseNumber));
  if (!data) return {};

  const chapterData = await fetchOrNull(() => api.getChapter(parsed.chapterNumber));
  return verseMetadata(data, chapterData?.nameEnglish);
}

export default async function VersePage({ params }: Params) {
  const { chapter, verse } = await params;
  const parsed = parseParams(chapter, verse);
  if (!parsed) notFound();

  const data = await fetchOrNull(() => api.getVerse(parsed.chapterNumber, parsed.verseNumber));
  if (!data) notFound();

  const [chapterData, neighbours] = await Promise.all([
    fetchOrNull(() => api.getChapter(parsed.chapterNumber)),
    tryFetch(
      () =>
        api.request<{ previous: string | null; next: string | null }>(
          `/v1/verses/${parsed.chapterNumber}/${parsed.verseNumber}/neighbours`,
        ),
      { previous: null, next: null },
    ),
  ]);

  const ref = `${data.chapterNumber}.${data.verseNumber}`;
  const crumbs = [
    { name: 'Gita', path: '/gita' },
    { name: `Chapter ${data.chapterNumber}`, path: `/gita/chapter/${data.chapterNumber}` },
    { name: `Verse ${data.verseNumber}`, path: `/gita/${data.chapterNumber}/${data.verseNumber}` },
  ];

  return (
    <Container width="reader">
      <JsonLd data={verseJsonLd(data, chapterData?.nameEnglish)} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <Breadcrumbs items={crumbs} />

      <VerseReader verse={data} chapterName={chapterData?.nameEnglish} />

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <ShareMenu
          verseRef={ref}
          url={absoluteUrl(`/gita/${data.chapterNumber}/${data.verseNumber}`)}
          translation={data.translationEnglish}
        />
        <ButtonLink href={`/ask?verse=${ref}`} variant="secondary">
          Ask about this verse
        </ButtonLink>
        <ButtonLink href={`/create?verse=${ref}`} variant="secondary">
          Make a wallpaper
        </ButtonLink>
        <ButtonLink href={`/gita/chapter/${data.chapterNumber}`} variant="ghost">
          All of chapter {data.chapterNumber}
        </ButtonLink>
      </div>

      <VerseNavigation previous={neighbours.previous} next={neighbours.next} />
    </Container>
  );
}
