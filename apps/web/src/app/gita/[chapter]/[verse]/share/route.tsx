import { type NextRequest } from 'next/server';

import { api, fetchOrNull } from '@/lib/api';
import { isShareSize, loadShareFonts, renderVerseCard } from '@/lib/share-card';

export const runtime = 'nodejs';
export const revalidate = 86400;

/**
 * Downloadable share cards in the sizes people actually post in.
 *
 *   /gita/2/47/share?size=story    1080x1920  Instagram / WhatsApp story
 *   /gita/2/47/share?size=square   1080x1080  Instagram post
 *   /gita/2/47/share?size=og       1200x630   X, Facebook, link previews
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chapter: string; verse: string }> },
) {
  const { chapter: chapterParam, verse: verseParam } = await params;
  const chapter = Number.parseInt(chapterParam, 10);
  const verseNumber = Number.parseInt(verseParam, 10);

  if (!Number.isInteger(chapter) || !Number.isInteger(verseNumber)) {
    return new Response('Not found', { status: 404 });
  }

  const requested = request.nextUrl.searchParams.get('size');
  const size = isShareSize(requested) ? requested : 'og';

  const [verse, chapterData, fonts] = await Promise.all([
    fetchOrNull(() => api.getVerse(chapter, verseNumber)),
    fetchOrNull(() => api.getChapter(chapter)),
    loadShareFonts(),
  ]);

  if (!verse) return new Response('Not found', { status: 404 });

  return renderVerseCard(
    {
      ref: `${verse.chapterNumber}.${verse.verseNumber}`,
      sanskrit: verse.sanskrit,
      transliteration: verse.transliteration,
      translation: verse.translationEnglish,
      chapterName: chapterData?.nameEnglish ?? null,
      unverified: verse.verificationStatus !== 'published',
    },
    size,
    fonts,
  );
}
