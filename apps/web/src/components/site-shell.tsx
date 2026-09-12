import Link from 'next/link';
import type { ReactNode } from 'react';

import { Container } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV = [
  { href: '/gita', label: 'Read' },
  { href: '/gita/topics', label: 'Explore' },
  { href: '/ask', label: 'Ask' },
  { href: '/reading-plans', label: 'Plans' },
  { href: '/create', label: 'Make' },
  { href: '/gita/glossary', label: 'Glossary' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-baseline gap-2 font-serif text-xl text-text-primary transition-colors hover:text-accent"
        >
          <span aria-hidden="true" className="text-gold-500">
            ॐ
          </span>
          <span>Gita</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-text-secondary transition-colors
                hover:bg-surface-sunken hover:text-text-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/search"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3
              text-sm text-text-secondary transition-colors hover:bg-surface-sunken"
            aria-label="Search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </Link>
          <ThemeToggle />
        </div>
      </Container>

      {/* One-handed navigation on small screens: the same links, scrollable. */}
      <nav
        aria-label="Main, compact"
        className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-text-secondary"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line bg-surface-sunken py-12">
      <Container>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-serif text-lg text-text-primary">Gita</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-text-muted">
              A calm place to read, listen to and understand the Bhagavad Gita. Scripture is
              reproduced from cited sources and is never generated.
            </p>
          </div>

          <FooterColumn
            title="Read"
            links={[
              { href: '/gita', label: 'All 18 chapters' },
              { href: '/gita/1/1', label: 'Start at 1.1' },
              { href: '/reading-plans', label: 'Reading plans' },
              { href: '/start-here', label: 'New to the Gita' },
            ]}
          />
          <FooterColumn
            title="Explore"
            links={[
              { href: '/gita/topics', label: 'Life situations' },
              { href: '/create', label: 'Make a wallpaper' },
              { href: '/gita/glossary', label: 'Glossary' },
              { href: '/characters', label: 'Characters' },
              { href: '/ask', label: 'Ask the Gita' },
            ]}
          />
          <FooterColumn
            title="About"
            links={[
              { href: '/sources', label: 'Sources and licences' },
              { href: '/privacy', label: 'Privacy' },
              { href: '/sitemap.xml', label: 'Sitemap' },
            ]}
          />
        </div>

        <p className="mt-10 border-t border-line pt-6 text-xs text-text-muted">
          Verse text and translations are attributed to their sources on each page. Explanations
          generated with assistance are labelled as such and always cite the verses they draw on.
        </p>
      </Container>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-text-muted transition-colors hover:text-accent">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="py-10">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
