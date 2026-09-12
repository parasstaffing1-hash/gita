import { fetchOrNull } from '@/lib/api';
import { api } from '@/lib/api';
import { SHARE_SIZES, loadShareFonts, renderVerseCard } from '@/lib/share-card';

export const runtime = 'nodejs';
export const revalidate = 86400;
export const alt = 'Bhagavad Gita verse';
export const size = SHARE_SIZES.og;
export const contentType = 'image/png';

/**
 * The link preview for a verse page.
 *
 * Next resolves this automatically as the og:image for the route, so a verse
 * shared into WhatsApp, X or Slack shows the actual Sanskrit rather than a
 * generic banner.
 */
export default async function Image({
  params,
}: {
  params: { chapter: string; verse: string };
}) {
  const chapter = Number.parseInt(params.chapter, 10);
  const verseNumber = Number.parseInt(params.verse, 10);

  const [verse, chapterData, fonts] = await Promise.all([
    fetchOrNull(() => api.getVerse(chapter, verseNumber)),
    fetchOrNull(() => api.getChapter(chapter)),
    loadShareFonts(),
  ]);

  return renderVerseCard(
    {
      ref: verse ? `${verse.chapterNumber}.${verse.verseNumber}` : `${chapter}.${verseNumber}`,
      sanskrit: verse?.sanskrit ?? null,
      transliteration: verse?.transliteration ?? null,
      translation: verse?.translationEnglish ?? null,
      chapterName: chapterData?.nameEnglish ?? null,
      unverified: verse ? verse.verificationStatus !== 'published' : false,
    },
    'og',
    fonts,
  );
}
