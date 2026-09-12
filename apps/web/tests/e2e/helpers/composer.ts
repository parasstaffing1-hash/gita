import { readFileSync } from 'node:fs';

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared machinery for the composer tests.
 *
 * Two things live here that the specs must not reinvent per file: how to build
 * a share code by hand, and how to wait for a canvas paint on a real condition
 * rather than on a stopwatch.
 */

// --- Share codes ----------------------------------------------------------

/**
 * A share code, built by hand rather than by `encodeComposition`.
 *
 * The scripture-integrity tests exist precisely to feed the route things the
 * encoder would never produce — an out-of-range verse, a Devanagari caption,
 * a missing field. Going through the encoder would sanitise exactly the input
 * under test, and the test would then prove nothing.
 */
export interface CodeFields {
  r?: string;
  w?: string;
  l?: string;
  t?: string;
  y?: string;
  g?: string;
  z?: string;
  a?: string;
  f?: string;
  /** Raw, unsanitised caption text. Base64url'd here, not before. */
  caption?: string;
}

const CODE_DEFAULTS: Required<Omit<CodeFields, 'caption'>> = {
  r: '2.47',
  w: '-',
  l: 'lower',
  t: 'auto',
  y: 'se',
  g: 'en',
  z: '1.00',
  a: 'gold',
  f: 'story',
};

/** Base64url with no padding — the spelling `encodeComposition` writes. */
export function base64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function buildCode(fields: CodeFields = {}): string {
  const merged = { ...CODE_DEFAULTS, ...fields };
  const parts = [
    'v1',
    `r${merged.r}`,
    `w${merged.w}`,
    `l${merged.l}`,
    `t${merged.t}`,
    `y${merged.y}`,
    `g${merged.g}`,
    `z${merged.z}`,
    `a${merged.a}`,
    `f${merged.f}`,
  ];
  if (fields.caption !== undefined) parts.push(`c${base64Url(fields.caption)}`);
  return parts.join('~');
}

// --- Canvas -----------------------------------------------------------------

/** Devanagari and its extended block — the ranges `sanitiseCaption` strips. */
export const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/u;

export interface CanvasSample {
  width: number;
  height: number;
  /** RGBA of a fixed 16x16 grid, joined. Two different photographs never
   *  produce the same one. */
  signature: string;
  /** How many distinct colours that grid saw. 1 means a flat fill. */
  distinct: number;
  /** True when every sampled pixel is fully transparent — an unpainted canvas. */
  transparent: boolean;
}

/**
 * Read the canvas the way a reader sees it: as pixels.
 *
 * Sampled on a grid rather than pulled whole. A 2160x3840 `getImageData` is a
 * 33 MB transfer per assertion, and this runs inside a poll.
 */
export async function sampleCanvas(page: Page): Promise<CanvasSample> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas on the page');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');

    const grid = 16;
    const pixels: number[] = [];
    const colours = new Set<string>();
    let opaque = false;

    for (let row = 0; row < grid; row += 1) {
      for (let column = 0; column < grid; column += 1) {
        const x = Math.min(canvas.width - 1, Math.floor(((column + 0.5) * canvas.width) / grid));
        const y = Math.min(canvas.height - 1, Math.floor(((row + 0.5) * canvas.height) / grid));
        // Throws a SecurityError if the canvas was tainted, which is also
        // exactly when the export would break — letting it throw is right.
        const data = context.getImageData(x, y, 1, 1).data;
        // Indexed access on a typed array is `number | undefined` under
        // `noUncheckedIndexedAccess`; a 1x1 read always has four bytes.
        const r = data[0] ?? 0;
        const g = data[1] ?? 0;
        const b = data[2] ?? 0;
        const a = data[3] ?? 0;
        pixels.push(r, g, b, a);
        colours.add(`${r},${g},${b},${a}`);
        if (a > 0) opaque = true;
      }
    }

    return {
      width: canvas.width,
      height: canvas.height,
      signature: pixels.join(','),
      distinct: colours.size,
      transparent: !opaque,
    };
  });
}

/**
 * Wait until the canvas is the requested output size.
 *
 * The element starts at the HTML default of 300x150 and only becomes the
 * format's size when `paint()` assigns to `canvas.width`, so this is both the
 * dimension assertion and the "has it repainted yet" synchronisation. Polling
 * a real property is what lets every other assertion here avoid a sleep.
 */
export async function expectCanvasSize(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const canvas = page.locator('canvas');
      return canvas.evaluate((element: HTMLCanvasElement) => `${element.width}x${element.height}`);
    }, { message: `canvas never reached ${width}x${height}` })
    .toBe(`${width}x${height}`);
}

/** Wait for the pixels to stop being what they were. */
export async function expectCanvasToChange(page: Page, before: string): Promise<string> {
  await expect
    .poll(async () => (await sampleCanvas(page)).signature, {
      message: 'the canvas never repainted',
    })
    .not.toBe(before);
  return (await sampleCanvas(page)).signature;
}

/**
 * Wait for the first honest paint of the page.
 *
 * "Honest" means the canvas is at its output size and something has been drawn
 * into it — a canvas that is the right size but still transparent is a paint
 * that has not landed.
 */
export async function waitForFirstPaint(
  page: Page,
  width: number,
  height: number,
): Promise<CanvasSample> {
  await expectCanvasSize(page, width, height);
  await expect
    .poll(async () => (await sampleCanvas(page)).transparent, {
      message: 'the canvas stayed transparent',
    })
    .toBe(false);
  return sampleCanvas(page);
}

/**
 * The wallpaper thumbnails, keyed by their accessible name.
 *
 * The library is ordered by a popularity bucket that moves whenever anybody
 * exports, so nothing may key off position. Reading the names off the page and
 * choosing among them keeps a test stable across reorderings, and across the
 * export tests in this same suite bumping a counter.
 */
export async function wallpaperNames(page: Page): Promise<string[]> {
  // The picker is server-rendered but re-fetched on mount, so a read taken
  // between hydration and that response sees an empty grid. Waiting on the
  // tiles themselves rather than on a timeout keeps this honest on a cold dev
  // server, where the first compile of /create can take half a minute.
  await page
    .locator('button[title]')
    .nth(2)
    .waitFor({ state: 'attached', timeout: 30_000 });

  const names = await page
    .locator('button[title]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('title') ?? '')
        .filter((title) => title.length > 0),
    );
  // The theme toggle also carries a title; it is not in the picker.
  return names.filter((name) => name !== 'Change reading theme');
}

export function wallpaperThumb(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

/** The chosen swatch is marked only by its accent border. */
export async function selectedWallpaperNames(page: Page): Promise<string[]> {
  return page
    .locator('button[title]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.className.includes('border-accent'))
        .map((element) => element.getAttribute('title') ?? ''),
    );
}

// --- Downloads --------------------------------------------------------------

/**
 * The real pixel dimensions of a PNG.
 *
 * Read out of the IHDR chunk, which is fixed at the head of every PNG: an
 * 8-byte signature, a 4-byte length, the type "IHDR", then width and height as
 * big-endian uint32s. Asserting on this rather than on the download event is
 * the whole point — a download that fires and hands back a 300x150 canvas is
 * the failure worth catching.
 */
export function pngSize(path: string): { width: number; height: number; bytes: number } {
  const file = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!file.subarray(0, 8).equals(signature)) {
    throw new Error('the downloaded file is not a PNG');
  }
  if (file.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('the PNG does not start with IHDR');
  }
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
    bytes: file.byteLength,
  };
}
