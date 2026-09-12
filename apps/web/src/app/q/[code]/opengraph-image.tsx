import { decodeComposition } from '@gita/quote-composer';

import { fetchVerse } from '@/lib/composer-data';
import { SHARE_SIZES, loadShareFonts, renderVerseCard } from '@/lib/share-card';

export const runtime = 'nodejs';
export const revalidate = 86400;
export const alt = 'Bhagavad Gita verse';
export const size = SHARE_SIZES.og;
export const contentType = 'image/png';

/**
 * The link preview for a shared card.
 *
 * This is the typographic card, not the wallpaper: a chat preview is a small
 * strip, and a photographic background at that size costs legibility for no
 * gain. The wallpaper itself is what the recipient downloads.
 */
export default async function Image({ params }: { params: { code: string } }) {
  let ref = '2.47';
  try {
    ref = decodeComposition(params.code).ref;
  } catch {
    // Fall through to a valid card rather than failing the preview.
  }

  const [verse, fonts] = await Promise.all([fetchVerse(ref), loadShareFonts()]);

  return renderVerseCard(
    {
      ref,
      sanskrit: verse?.sanskrit ?? null,
      transliteration: verse?.transliteration ?? null,
      translation: verse?.translationEnglish ?? null,
      chapterName: null,
      unverified: verse ? verse.verificationStatus !== 'published' : false,
    },
    'og',
    fonts,
  );
}
