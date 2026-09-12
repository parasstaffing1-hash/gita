import { expect, test } from '@playwright/test';

import {
  expectCanvasSize,
  expectCanvasToChange,
  sampleCanvas,
  selectedWallpaperNames,
  waitForFirstPaint,
  wallpaperNames,
  wallpaperThumb,
} from './helpers/composer';

/**
 * The composer at /create.
 *
 * The canvas is the product here, so these assert on pixels and on the
 * canvas's own output size — not on whether a button took a highlight. A card
 * maker whose preview is a blank rectangle passes every DOM assertion you can
 * write about it.
 *
 * Desktop only, and the config does not even collect this file for the mobile
 * project: the composer's behaviour is viewport-independent, and repainting a
 * 2160x3840 canvas twice buys no extra signal.
 */

// Formats, from the source of truth. Kept here rather than imported so a typo
// in FORMAT_SPECS is something the test catches instead of something it copies.
const STORY = { width: 1080, height: 1920 };
const PHONE_4K = { width: 2160, height: 3840 };

test.describe('the composer', () => {
  test('loads and paints a non-blank card', async ({ page }) => {
    await page.goto('/create');

    await expect(page.getByRole('heading', { name: 'Make a card', level: 1 })).toBeVisible();

    // The preview is exposed as an image with the verse in its name, so a
    // screen reader is told what the canvas holds.
    const preview = page.getByRole('img', { name: /Preview of Bhagavad Gita 2\.47/ });
    await expect(preview).toBeVisible();

    const painted = await waitForFirstPaint(page, STORY.width, STORY.height);

    // Non-blank, defined as something a reader would call a card: opaque, and
    // carrying more than one colour. A cleared canvas is transparent; a canvas
    // that only got its ground fill is exactly one colour. This card has a
    // photograph and set type on it, so it is neither.
    expect(painted.transparent).toBe(false);
    expect(painted.distinct).toBeGreaterThan(8);

    // The stated output size under the preview must agree with the canvas.
    await expect(page.getByText(`${STORY.width} × ${STORY.height} ·`)).toBeVisible();
  });

  test('changing the format changes the canvas dimensions', async ({ page }) => {
    // A 2160x3840 repaint over a photograph is real work on a dev build.
    test.slow();
    await page.goto('/create');
    await waitForFirstPaint(page, STORY.width, STORY.height);

    // Selected by the size it announces, which is unique across the six
    // buttons and does not depend on where the button sits in the grid.
    await page.getByRole('button', { name: `Phone 4K ${PHONE_4K.width}×${PHONE_4K.height}` }).click();
    await expectCanvasSize(page, PHONE_4K.width, PHONE_4K.height);

    // The download button names the format it will produce; if it still said
    // "Story" the export would be the thing that lied, not the preview.
    await expect(page.getByRole('button', { name: 'Download Phone 4K' })).toBeVisible();
    await expect(page.getByText(`${PHONE_4K.width} × ${PHONE_4K.height} ·`)).toBeVisible();

    // And back, so this is a property of the control rather than a one-way trip.
    await page.getByRole('button', { name: `Story ${STORY.width}×${STORY.height}` }).click();
    await expectCanvasSize(page, STORY.width, STORY.height);
    await expect(page.getByRole('button', { name: 'Download Story' })).toBeVisible();
  });

  test('picking a wallpaper changes what is drawn', async ({ page }) => {
    await page.goto('/create');
    const before = await waitForFirstPaint(page, STORY.width, STORY.height);

    // Read the picker off the page and take a background that is not the one
    // already chosen. The catalogue is ordered by a use counter that this very
    // suite increments when the export tests run, so any nth-child or
    // "first thumbnail" choice would be a different image on a different day.
    const names = await wallpaperNames(page);
    expect(names.length).toBeGreaterThan(2);
    const alreadyChosen = await selectedWallpaperNames(page);
    const target = names.find((name) => !alreadyChosen.includes(name));
    expect(target, 'the picker offered nothing that was not already selected').toBeTruthy();

    await wallpaperThumb(page, target as string).click();

    // The pixels must actually move. This is the assertion the feature exists
    // for; the border highlight below is only corroboration.
    await expectCanvasToChange(page, before.signature);
    await expect(wallpaperThumb(page, target as string)).toHaveClass(/border-accent/);

    // A background that failed to load also changes the canvas — to a plain
    // ground — and would otherwise pass the test above by breaking.
    await expect(page.getByText(/background could not be loaded/i)).toHaveCount(0);

    const after = await sampleCanvas(page);
    expect(after.transparent).toBe(false);
    expect(after.distinct).toBeGreaterThan(8);
    // Changing the picture must not change the format.
    expect(after.width).toBe(STORY.width);
    expect(after.height).toBe(STORY.height);
  });

  test('choosing a layout updates the card', async ({ page }) => {
    await page.goto('/create');
    const before = await waitForFirstPaint(page, STORY.width, STORY.height);

    // "Panel" draws a frosted slab behind the verse, so it is the layout whose
    // effect on the pixels is least deniable. Every layout button carries
    // aria-pressed, so selection is readable from the accessibility tree
    // rather than from a class name.
    const panel = page.getByRole('button', { name: /^Panel Frosted panel/ });
    await expect(panel).toHaveAttribute('aria-pressed', 'false');

    await panel.click();
    await expect(panel).toHaveAttribute('aria-pressed', 'true');
    await expectCanvasToChange(page, before.signature);

    // Exactly one layout is selected at a time.
    const pressed = page.locator('button[aria-pressed="true"]').filter({ hasText: 'Frosted panel' });
    await expect(pressed).toHaveCount(1);

    // A second, differently-shaped layout, so this is not "any click repaints".
    const after = await sampleCanvas(page);
    const centred = page.getByRole('button', { name: /^Centred Verse in the middle/ });
    await centred.click();
    await expect(centred).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toHaveAttribute('aria-pressed', 'false');
    await expectCanvasToChange(page, after.signature);
  });

  test('the verse text cannot be typed over', async ({ page }) => {
    await page.goto('/create');
    await waitForFirstPaint(page, STORY.width, STORY.height);

    // The first rule of the platform: scripture is never author-supplied. The
    // only free-text field on the page is the caption, and the page says so.
    const textInputs = page.locator('main input[type="text"], main textarea');
    await expect(textInputs).toHaveCount(1);
    await expect(textInputs).toHaveAttribute('placeholder', 'A name, a dedication, a handle');
    await expect(
      page.getByText(/The verse itself comes from the library and cannot be edited here/i),
    ).toBeVisible();
  });
});
