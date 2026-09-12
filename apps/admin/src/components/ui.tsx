import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Admin primitives.
 *
 * Same tokens as the public site, but denser: this is a working surface for
 * editors, not a reading surface.
 */

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AdminNav />
      <main className="mx-auto w-full max-w-wide px-6 py-8">{children}</main>
    </div>
  );
}

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/content', label: 'Content' },
  { href: '/changes', label: 'Change log' },
  { href: '/wallpapers', label: 'Wallpapers' },
  { href: '/ai-answers', label: 'AI review' },
];

function AdminNav() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-wide items-center gap-6 px-6 py-3">
        <Link href="/" className="flex items-baseline gap-2 font-serif text-lg text-text-primary">
          <span aria-hidden="true" className="text-gold-500">ॐ</span>
          <span>Gita admin</span>
        </Link>
        <nav aria-label="Admin" className="flex gap-1">
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
        <span className="ml-auto text-xs text-text-muted">Internal — not indexed</span>
      </div>
    </header>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-serif text-2xl text-text-primary">{title}</h1>
      {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'warning' | 'accent';
  hint?: string;
}) {
  const tones = {
    neutral: 'text-text-primary',
    accent: 'text-accent',
    warning: 'text-amber-700 dark:text-amber-400',
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn('mt-1 font-mono text-2xl tabular-nums', tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-line bg-surface-sunken px-4 py-2.5 text-left text-xs
      font-semibold uppercase tracking-wider text-text-muted">
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('border-b border-line px-4 py-3 align-top', className)}>{children}</td>;
}

const statusTones: Record<string, string> = {
  draft: 'bg-surface-sunken text-text-muted border-line',
  review: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900',
  verified: 'bg-accent-muted text-accent border-transparent',
  published: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900',
  grounded: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900',
  partially_grounded: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900',
  insufficient_evidence: 'bg-surface-sunken text-text-muted border-line',
  flagged: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-900',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        statusTones[status] ?? statusTones.draft,
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/40">
      <p className="font-medium text-rose-900 dark:text-rose-200">{title}</p>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-rose-800 dark:text-rose-300">
        {detail}
      </p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-text-muted">
      {children}
    </p>
  );
}
