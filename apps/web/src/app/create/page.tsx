import type { Metadata } from 'next';

import { QuoteMaker } from '@/components/quote-maker';
import { Breadcrumbs, Container } from '@/components/ui';
import { loadComposerData } from '@/lib/composer-data';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 300;

export const metadata: Metadata = buildMetadata({
  title: 'Make a Bhagavad Gita Wallpaper or Quote Card',
  description:
    'Put a verse of the Bhagavad Gita on a 4K wallpaper or a card for sharing. ' +
    'Sanskrit, transliteration and translation come from the verse library, ' +
    'so the shloka on your image is the one in the text.',
  path: '/create',
});

interface Props {
  searchParams: Promise<{ verse?: string }>;
}

export default async function CreatePage({ searchParams }: Props) {
  const { verse } = await searchParams;
  const data = await loadComposerData({ ref: verse });

  return (
    <Container>
      <Breadcrumbs items={[{ name: 'Make a card', path: '/create' }]} />

      <header className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl text-text-primary">Make a card</h1>
        <p className="mt-4 leading-relaxed text-text-secondary">
          Choose a verse, choose a background, and take away a wallpaper or a card to share. The
          verse text is loaded from the library and cannot be typed over — whatever ends up on your
          image is what the Gita actually says.
        </p>
      </header>

      <QuoteMaker
        initialComposition={data.composition}
        initialVerse={data.verse}
        initialWallpapers={data.wallpapers}
        initialTotal={data.total}
        suggestions={data.suggestions}
        moods={data.moods}
        siteUrl={data.siteUrl}
      />
    </Container>
  );
}
