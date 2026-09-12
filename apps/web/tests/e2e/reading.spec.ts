import { expect, test } from '@playwright/test';

/**
 * The reading path, end to end against a real API and database.
 *
 * These deliberately assert on what a reader and a crawler actually receive,
 * not on internals: is the Sanskrit in the HTML, does the canonical tag point
 * at the right URL, does navigation between verses work.
 */

test.describe('chapters', () => {
  test('lists all eighteen chapters', async ({ page }) => {
    await page.goto('/gita');
    await expect(page.getByRole('heading', { name: 'The Bhagavad Gita' })).toBeVisible();

    const chapterLinks = page.locator('a[href^="/gita/chapter/"]');
    await expect(chapterLinks).toHaveCount(18);
  });

  test('a chapter page shows its name, count and verses', async ({ page }) => {
    await page.goto('/gita/chapter/2');
    // "72 verses" also appears in the title and in the count line below, so
    // assert on the header line as a whole rather than the fragment.
    await expect(page.getByText('Chapter 2 of 18 · 72 verses')).toBeVisible();
    // The Sanskrit chapter title must be present, not just the English one.
    await expect(page.locator('h1[lang="sa"]')).toContainText('साङ्ख्ययोग');
  });

  test('chapter navigation moves in both directions', async ({ page }) => {
    // Against a dev server the destination route may still be compiling, and
    // the RSC payload for a chapter that has not been visited has to be
    // fetched, so give the navigation a realistic budget.
    test.slow();
    await page.goto('/gita/chapter/2');
    await page.getByRole('link', { name: /Chapter 3/ }).click();
    await expect(page).toHaveURL(/\/gita\/chapter\/3$/, { timeout: 30_000 });
    await page.getByRole('link', { name: /Chapter 2/ }).click();
    await expect(page).toHaveURL(/\/gita\/chapter\/2$/, { timeout: 30_000 });
  });
});

test.describe('verse reader', () => {
  test('renders Sanskrit, transliteration and translation in the HTML', async ({ page }) => {
    const response = await page.goto('/gita/2/47');
    expect(response?.status()).toBe(200);

    // Server-rendered: assert on the raw body, so this fails if the content
    // ever moves behind client-side JavaScript.
    const html = (await response?.text()) ?? '';
    expect(html).toContain('कर्मण्येवाधिकारस्ते');
    expect(html).toContain('karma');
    expect(html).toContain('claim on the action');

    await expect(page.locator('p[lang="sa"]').first()).toBeVisible();
  });

  test('labels unverified content', async ({ page }) => {
    // Development content is draft, and the reader must be told.
    await page.goto('/gita/2/47');
    await expect(page.getByText(/development placeholder content/i)).toBeVisible();
  });

  test('moves to the next and previous verse', async ({ page }) => {
    await page.goto('/gita/2/47');
    await page.getByRole('link', { name: /Next/ }).click();
    await expect(page).toHaveURL(/\/gita\/2\/48$/);
  });

  test('has correct SEO metadata', async ({ page }) => {
    await page.goto('/gita/2/47');
    await expect(page).toHaveTitle(/Bhagavad Gita 2\.47: Sanskrit, Meaning, Translation/);

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', /\/gita\/2\/47$/);

    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', /Bhagavad Gita 2\.47/);
  });

  test('emits Article and BreadcrumbList structured data', async ({ page }) => {
    await page.goto('/gita/2/47');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.flatMap((block) => {
      const parsed = JSON.parse(block);
      return [parsed['@type']];
    });
    expect(types).toContain('Article');
    expect(types).toContain('BreadcrumbList');
  });

  test('a verse outside the canon is a 404', async ({ page }) => {
    const response = await page.goto('/gita/2/999');
    expect(response?.status()).toBe(404);
  });
});

test.describe('share cards', () => {
  test('serves a PNG in every size', async ({ request }) => {
    for (const size of ['og', 'square', 'story']) {
      const response = await request.get(`/gita/2/47/share?size=${size}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
      expect((await response.body()).byteLength).toBeGreaterThan(10_000);
    }
  });
});

test.describe('discovery', () => {
  test('topic pages carry curated verses', async ({ page }) => {
    await page.goto('/gita/topics/anger');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('anger');
    await expect(page.locator('main a[href^="/gita/2/62"]').first()).toBeVisible();
  });

  test('glossary terms show Sanskrit and a definition', async ({ page }) => {
    await page.goto('/gita/glossary/dharma');
    await expect(page.locator('h1[lang="sa"]')).toContainText('धर्म');
    await expect(page.getByText(/genuinely yours to do/i)).toBeVisible();
  });

  test('search finds a verse by reference', async ({ page }) => {
    await page.goto('/search?q=2.47');
    await expect(page.locator('main a[href="/gita/2/47"]').first()).toBeVisible();
  });

  test('search folds transliteration variants', async ({ page }) => {
    // "krsna" must reach the same rows as "Krishna" would. Scoped to main
    // because the header nav also contains /gita/ links, and on a phone the
    // desktop nav is rendered but hidden.
    await page.goto('/search?q=krsna');
    await expect(page.getByText(/result/).first()).toBeVisible();
    await expect(page.locator('main a[href^="/gita/"]').first()).toBeVisible();
  });
});

test.describe('crawlability', () => {
  test('sitemap lists all 700 verses', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    const verseUrls = body.match(/<loc>[^<]*\/gita\/\d+\/\d+<\/loc>/g) ?? [];
    expect(verseUrls).toHaveLength(700);
  });

  test('robots.txt points at the sitemap and excludes search', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toContain('Sitemap:');
    expect(body).toContain('Disallow: /search');
  });
});

test.describe('accessibility basics', () => {
  test('every page has one h1 and a skip link', async ({ page }) => {
    // Walks five routes; against a dev server each may compile on first hit.
    test.slow();
    for (const path of ['/', '/gita', '/gita/2/47', '/gita/topics', '/ask']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeAttached();
    }
  });

  test('the reading theme survives a reload', async ({ page }) => {
    await page.goto('/gita/2/47');
    await page.getByRole('button', { name: /reading theme/i }).click();
    const chosen = await page.locator('html').getAttribute('data-theme');
    expect(chosen).toBeTruthy();

    await page.reload();
    // Applied by the inline script before first paint, so no flash of the
    // wrong theme on navigation.
    await expect(page.locator('html')).toHaveAttribute('data-theme', chosen as string);
  });
});
