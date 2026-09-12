import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { encodeComposition } from '@gita/quote-composer';

import { QuoteMaker } from '@/components/quote-maker';
import { Breadcrumbs, Container } from '@/components/ui';
import { loadComposerData, parseCompositionCode } from '@/lib/composer-data';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 300;

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * A shared card.
 *
 * The link carries the composition, not the verse text — so opening someone
 * else's card fetches the scripture fresh from the library. A link cannot
 * transport an altered shloka, and a correction to the text reaches every card
 * ever shared.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const parsed = parseCompositionCode(code);
  if (!parsed) return { robots: { index: false, follow: false } };

  const { composition, verse } = await loadComposerData({ composition: parsed });

  return buildMetadata({
    title: `Bhagavad Gita ${composition.ref}`,
    description:
      verse?.translationEnglish ??
      'A verse of the Bhagavad Gita, set on a wallpaper you can make your own.',
    // Re-encoded, never echoed. A card has one address — the one this build
    // would write for it — so a link that spells the same composition another
    // way points at that address instead of nominating itself.
    path: `/q/${encodeComposition(composition)}`,
  });
}

export default async function SharedQuotePage({ params }: Props) {
  const { code } = await params;
  const composition = parseCompositionCode(code);
  // Nothing decoded means there is no card here, only a string. Rendering the
  // default composition for it would answer 200 to anything.
  if (!composition) notFound();

  const data = await loadComposerData({ composition });
  const canonical = encodeComposition(data.composition);

  return (
    <Container>
      <Breadcrumbs
        items={[
          { name: 'Make a card', path: '/create' },
          { name: data.composition.ref, path: `/q/${canonical}` },
        ]}
      />

      <header className="mb-8 max-w-2xl">
        <h1 className="font-serif text-3xl text-text-primary">
          Bhagavad Gita {data.composition.ref}
        </h1>
        <p className="mt-3 leading-relaxed text-text-secondary">
          Someone made this card. Change anything you like and take your own — or{' '}
          <Link href={`/gita/${data.composition.ref.replace('.', '/')}`} className="text-accent underline-offset-4 hover:underline">
            read the verse in full
          </Link>
          .
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
