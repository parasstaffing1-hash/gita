import { revalidatePath } from 'next/cache';

import { WallpaperReview } from '@/components/wallpaper-review';
import { Empty, ErrorPanel, PageHeader } from '@/components/ui';
import { getWallpapers, setWallpaperActive, setWallpaperStatusBulk } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'In review' },
  { value: 'verified', label: 'Verified' },
  { value: 'published', label: 'Published' },
  { value: '', label: 'All' },
];

const ORIENTATIONS = [
  { value: '', label: 'Any shape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

/**
 * Wallpaper review.
 *
 * Wallpapers import as draft and only `published` rows reach readers in
 * production, so nothing in the library is visible until someone has looked at
 * it here. The check that matters is the licence: the API refuses to publish a
 * wallpaper without one, and the card says so before you try.
 */
export default async function WallpapersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; shape?: string; page?: string }>;
}) {
  const { status, shape, page } = await searchParams;
  const offset = Math.max(0, (Number.parseInt(page ?? '1', 10) || 1) - 1) * 60;

  async function publish(ids: string[], verificationStatus: string, reason: string) {
    'use server';
    await setWallpaperStatusBulk(ids, verificationStatus, reason);
    revalidatePath('/wallpapers');
  }

  async function setActive(id: string, isActive: boolean, reason: string) {
    'use server';
    await setWallpaperActive(id, isActive, reason);
    revalidatePath('/wallpapers');
  }

  let wallpapers;
  try {
    wallpapers = await getWallpapers({
      verificationStatus: status ?? 'draft',
      orientation: shape || undefined,
      limit: 60,
      offset,
    });
  } catch (error) {
    return (
      <>
        <PageHeader title="Wallpapers" />
        <ErrorPanel
          title="Could not load wallpapers"
          detail={error instanceof Error ? error.message : String(error)}
        />
      </>
    );
  }

  const current = status ?? 'draft';
  const shown = offset + wallpapers.items.length;
  const query = (next: Record<string, string>) => {
    const params = new URLSearchParams({
      ...(current ? { status: current } : {}),
      ...(shape ? { shape } : {}),
      ...next,
    });
    const encoded = params.toString();
    return encoded ? `/wallpapers?${encoded}` : '/wallpapers';
  };

  return (
    <>
      <PageHeader
        title="Wallpapers"
        description={
          `${wallpapers.total} in this view. Only published wallpapers reach readers in ` +
          `production, and none can be published without a licence recorded against it.`
        }
      />

      <nav className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <a
            key={filter.value || 'all'}
            href={query({ status: filter.value, page: '1' })}
            className={
              current === filter.value
                ? 'rounded-full border border-accent bg-accent-muted px-4 py-1.5 text-sm text-accent'
                : 'rounded-full border border-line px-4 py-1.5 text-sm text-text-secondary hover:border-line-strong'
            }
          >
            {filter.label}
          </a>
        ))}
      </nav>

      <nav className="mb-6 flex flex-wrap gap-2">
        {ORIENTATIONS.map((option) => (
          <a
            key={option.value || 'any'}
            href={query({ shape: option.value, page: '1' })}
            className={
              (shape ?? '') === option.value
                ? 'rounded-full border border-accent bg-accent-muted px-4 py-1.5 text-sm text-accent'
                : 'rounded-full border border-line px-4 py-1.5 text-sm text-text-secondary hover:border-line-strong'
            }
          >
            {option.label}
          </a>
        ))}
      </nav>

      {wallpapers.items.length === 0 ? (
        <Empty>Nothing here. Import a set, or try another filter.</Empty>
      ) : (
        <>
          <WallpaperReview
            wallpapers={wallpapers.items}
            onPublish={publish}
            onSetActive={setActive}
          />

          <div className="mt-6 flex items-center justify-between text-sm text-text-muted">
            <span>
              {offset + 1}–{shown} of {wallpapers.total}
            </span>
            <span className="flex gap-3">
              {offset > 0 ? (
                <a
                  className="text-accent underline-offset-4 hover:underline"
                  href={query({ page: String(offset / 60) })}
                >
                  Previous
                </a>
              ) : null}
              {shown < wallpapers.total ? (
                <a
                  className="text-accent underline-offset-4 hover:underline"
                  href={query({ page: String(offset / 60 + 2) })}
                >
                  Next
                </a>
              ) : null}
            </span>
          </div>
        </>
      )}
    </>
  );
}
