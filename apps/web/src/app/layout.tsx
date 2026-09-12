import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { PageShell } from '@/components/site-shell';
import { themeInitScript } from '@/components/theme-toggle';
import { JsonLd } from '@/components/json-ld';
import { defaultMetadata, websiteJsonLd } from '@/lib/seo';

import '@/styles/globals.css';

export const metadata: Metadata = defaultMetadata;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom must stay available. Capping it is an accessibility failure.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF9F5' },
    { media: '(prefers-color-scheme: dark)', color: '#12110F' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Both inline scripts below take only values this file constructs:
          a module-level constant, and JSON serialised by `jsonLdScript` with
          `<` escaped. No user or API content reaches either of them.

          The theme script blocks on purpose — it is a handful of statements,
          and the alternative is a white flash on every navigation for anyone
          reading at night.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />

        {/* Devanagari and the Latin faces load together so a verse never
            renders in a fallback font and then reflows. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:ital,wght@0,400;0,500;1,400&family=Noto+Serif+Devanagari:wght@400;500;600&display=swap"
        />

        <JsonLd data={websiteJsonLd()} />
      </head>
      <body>
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}
