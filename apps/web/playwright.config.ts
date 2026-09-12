import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These run against a server that is already up, and against a real API and
 * database — the point is to check real pages, not mocks.
 *
 * The default is the port the repo's dev server actually runs on (3100).
 * `reuseExistingServer` is on unconditionally: a suite that silently starts a
 * second Next dev server behind the one you are already looking at is a suite
 * that tests a different build from the one you are debugging, and on a shared
 * machine it is also a port fight. If nothing is listening the command below
 * starts one; if something is, Playwright uses it as-is.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './tests/e2e',
  // Serial, deliberately. Both projects drive one Next dev server, and dev
  // mode compiles a route on first request — two workers racing the same cold
  // route made the composer specs flaky in exactly the way that teaches people
  // to re-run a suite instead of reading it. The wall-clock cost is a couple of
  // minutes; a test that fails one run in three is worth less than no test.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  // A dev server compiles each route on first request, so the default budget
  // is too tight for a cold run. Against a production build this is generous.
  timeout: 60_000,
  expect: {
    // Canvas repaints wait on a photograph over the network and on webfonts, so
    // the polled canvas assertions need more room than a DOM assertion does.
    timeout: 15_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Every export test writes a real PNG and measures it; without this the
    // download promise resolves to a file Playwright has already deleted.
    acceptDownloads: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // The composer, export and keyboard specs are desktop-only by design —
      // see the guard at the top of each. Listing them here as well would only
      // mean paying to collect tests that immediately skip.
      testIgnore: ['**/composer.spec.ts', '**/export.spec.ts', '**/composer-a11y.spec.ts'],
    },
  ],
  // An explicit E2E_BASE_URL means someone is pointing the suite at a server
  // they manage (a preview deploy, a container). Offering to start a local dev
  // server for that is never right.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx next dev --port 3100',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
