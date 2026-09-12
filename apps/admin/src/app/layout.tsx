import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Shell } from '@/components/ui';

import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Gita Admin',
  description: 'Internal content administration',
  // Belt and braces alongside the X-Robots-Tag header in next.config.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:wght@400;500&family=Noto+Serif+Devanagari:wght@400;500&display=swap"
        />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
