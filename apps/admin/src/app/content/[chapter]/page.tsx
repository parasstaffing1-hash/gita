import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Empty, ErrorPanel, PageHeader, Table, Td, Th } from '@/components/ui';
import { adminApi } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default async function ChapterContentPage({
  params,
}: {
  params: Promise<{ chapter: string }>;
}) {
  const { chapter: chapterParam } = await params;
  const number = Number.parseInt(chapterParam, 10);
  if (!Number.isInteger(number) || number < 1 || number > 18) notFound();

  let chapter;
  let verses;
  try {
    const api = adminApi();
    [chapter, verses] = await Promise.all([
      api.getChapter(number),
      api.listChapterVerses(number, { limit: 200 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title={`Chapter ${number}`} />
        <ErrorPanel
          title="Could not load this chapter"
          detail={error instanceof Error ? error.message : String(error)}
        />
      </>
    );
  }

  const missing = chapter.verseCount - verses.items.length;

  return (
    <>
      <PageHeader
        title={`Chapter ${chapter.number}: ${chapter.nameEnglish}`}
        description={`${verses.items.length} of ${chapter.verseCount} verses loaded.`}
      />

      <p className="mb-6">
        <Link href="/content" className="text-sm text-accent hover:underline">
          ← All chapters
        </Link>
      </p>

      {missing > 0 ? (
        <p
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm
            text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {missing} verse{missing === 1 ? '' : 's'} from this chapter{' '}
          {missing === 1 ? 'is' : 'are'} not in the database yet.
        </p>
      ) : null}

      {verses.items.length === 0 ? (
        <Empty>No verses loaded for this chapter.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Ref</Th>
              <Th>Sanskrit</Th>
              <Th>English</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {verses.items.map((verse) => (
              <tr key={verse.id}>
                <Td className="whitespace-nowrap font-mono text-text-muted">{verse.ref}</Td>
                <Td className="max-w-sm">
                  <span className="font-devanagari text-base leading-devanagari" lang="sa">
                    {verse.sanskrit?.split('\n')[0] ?? '—'}
                  </span>
                </Td>
                <Td className="max-w-md text-text-secondary">{verse.translationEnglish ?? '—'}</Td>
                <Td>
                  <a
                    href={`${SITE_URL}/gita/${verse.chapterNumber}/${verse.verseNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap text-xs text-accent hover:underline"
                  >
                    View on site →
                  </a>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
