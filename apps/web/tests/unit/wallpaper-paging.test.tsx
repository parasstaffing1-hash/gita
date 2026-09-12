import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPOSITION } from '@gita/quote-composer';

import { QuoteMaker, type WallpaperSummary } from '@/components/quote-maker';

/**
 * Paging the picker over an unstable ordering.
 *
 * `/v1/wallpapers` sorts on `use_count DESC`, which moves whenever anyone
 * exports, so the rows sitting under a given offset are not the rows that were
 * there a moment ago. These tests drive the grid through the two ways that
 * bites: a page that arrives entirely duplicated, and a catalogue that runs out
 * while the server's count still reads higher than the grid holds.
 */

const TOTAL = 200;
const PAGE = 60;

function wallpaper(index: number): WallpaperSummary {
  return {
    id: `id-${index}`,
    slug: `wallpaper-${index}`,
    title: null,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    textZone: 'any',
    luminance: null,
    dominantColor: null,
    moods: [],
    thumbUrl: null,
    previewUrl: null,
    fullUrl: null,
    attribution: null,
    photographer: null,
  };
}

const CATALOGUE = Array.from({ length: TOTAL }, (_, index) => wallpaper(index));

/** Every offset the picker asked for, in order. */
let asked: number[] = [];
/** What the server hands back for an offset, once the ordering has moved. */
let windowAt: (offset: number) => WallpaperSummary[];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      asked.push(offset);
      const items = offset === 0 ? CATALOGUE.slice(0, PAGE) : windowAt(offset);
      return { ok: true, json: async () => ({ items, total: TOTAL, limit: PAGE, offset }) };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The grid mounted and its first page landed. */
async function opened() {
  render(
    <QuoteMaker
      initialComposition={DEFAULT_COMPOSITION}
      initialVerse={null}
      initialWallpapers={CATALOGUE.slice(0, PAGE)}
      initialTotal={TOTAL}
      suggestions={[]}
      moods={[]}
      siteUrl="http://localhost:3000"
    />,
  );
  await waitFor(() => expect(asked).toEqual([0]));
  await act(async () => undefined);
  asked = [];
}

function more() {
  return screen.queryByRole('button', { name: /more$/ });
}

async function showMore() {
  const button = more();
  expect(button).not.toBeNull();
  fireEvent.click(button as HTMLElement);
  await act(async () => undefined);
}

describe('loading more wallpapers', () => {
  it('moves the window on when a whole page comes back already on screen', async () => {
    // The ordering shifted far enough that the second window holds exactly the
    // rows the first one did. Nothing new arrives, so an offset taken from the
    // grid's length would ask for these same rows again, and again.
    windowAt = (offset) =>
      offset === PAGE ? CATALOGUE.slice(0, PAGE) : CATALOGUE.slice(offset, offset + PAGE);

    await opened();

    await showMore();
    expect(asked).toEqual([PAGE]);
    // The grid did not grow, and the button is still offering the rest.
    expect(screen.getByText(`${PAGE} of ${TOTAL}`)).toBeTruthy();

    await showMore();
    expect(asked).toEqual([PAGE, PAGE * 2]);
    expect(screen.getByText(`${PAGE * 2} of ${TOTAL}`)).toBeTruthy();
  });

  it('never asks for one window twice', async () => {
    windowAt = () => CATALOGUE.slice(0, PAGE);

    await opened();
    for (let click = 0; click < 4; click += 1) await showMore();

    expect(asked).toEqual([PAGE, PAGE * 2, PAGE * 3, PAGE * 4]);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('stops when the catalogue runs dry, count or no count', async () => {
    // A short page is the end of the library. The server still says 200 exist,
    // because the rows this window duplicated are counted where they already
    // sit — so a button gated on that count alone would stay lit over nothing.
    windowAt = (offset) => (offset === PAGE ? CATALOGUE.slice(PAGE, PAGE + 20) : []);

    await opened();
    await showMore();

    expect(screen.getByText(`${PAGE + 20} available`)).toBeTruthy();
    expect(more()).toBeNull();
    expect(asked).toEqual([PAGE]);
  });
});
