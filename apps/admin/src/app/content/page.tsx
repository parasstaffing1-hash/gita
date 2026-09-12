import Link from 'next/link';

import { Empty, ErrorPanel, PageHeader, StatusBadge, Table, Td, Th } from '@/components/ui';
import { adminApi } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/**
 * Content browser.
 *
 * Reads through the public endpoints — they return the same rows an editor
 * needs, under the same visibility rules. Editing goes through the admin
 * endpoints instead, which log every change.
 */
export default async function ContentPage() {
  let chapters;
  try {
    chapters = await adminApi().listChapters();
  } catch (error) {
    return (
      <>
        <PageHeader title="Content" />
        <ErrorPanel
          title="Could not load chapters"
          detail={error instanceof Error ? error.message : String(error)}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Content"
        description="Chapters, and the verification state of what is loaded."
      />

      {chapters.length === 0 ? (
        <Empty>No chapters imported. Run the content importer.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Sanskrit</Th>
              <Th>English</Th>
              <Th>Verses</Th>
              <Th>Status</Th>
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter) => (
              <tr key={chapter.id}>
                <Td className="font-mono text-text-muted">{chapter.number}</Td>
                <Td>
                  <span className="font-devanagari text-base" lang="sa">
                    {chapter.nameSanskrit ?? '—'}
                  </span>
                </Td>
                <Td>{chapter.nameEnglish}</Td>
                <Td className="font-mono tabular-nums text-text-muted">{chapter.verseCount}</Td>
                <Td>
                  <StatusBadge status={chapter.verificationStatus} />
                </Td>
                <Td>
                  <Link
                    href={`/content/${chapter.number}`}
                    className="whitespace-nowrap text-xs text-accent hover:underline"
                  >
                    Verses →
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
