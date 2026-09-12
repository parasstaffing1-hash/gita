/**
 * Design-system primitives.
 *
 * Small and deliberately plain — the reading surface is the visual priority,
 * so the chrome around it stays quiet. Everything here is a Server Component
 * unless it genuinely needs interactivity.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Container({
  children,
  className,
  width = 'wide',
}: {
  children: ReactNode;
  className?: string;
  width?: 'reader' | 'prose' | 'wide';
}) {
  const widths = { reader: 'max-w-reader', prose: 'max-w-prose', wide: 'max-w-wide' };
  return <div className={cn('mx-auto w-full px-5 sm:px-6', widths[width], className)}>{children}</div>;
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
}) {
  return (
    <Tag
      className={cn(
        'rounded-lg border border-line bg-surface p-5 shadow-soft',
        'transition-colors duration-200 ease-standard',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** A card that is entirely a link. The whole surface is the target. */
export function LinkCard({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group block rounded-lg border border-line bg-surface p-5 shadow-soft',
        'transition-all duration-200 ease-standard',
        'hover:border-line-strong hover:shadow-card',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  level = 2,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  level?: 2 | 3;
}) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <Tag
          className={cn(
            'font-serif text-text-primary',
            level === 2 ? 'text-2xl' : 'text-xl',
          )}
        >
          {title}
        </Tag>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const badgeStyles = {
  neutral: 'bg-surface-sunken text-text-muted border-line',
  accent: 'bg-accent-muted text-accent border-transparent',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof badgeStyles;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        badgeStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Shown next to any content that has not been through editorial verification.
 * Being explicit about this is the whole point: a reader should never have to
 * guess whether the text in front of them has been checked.
 */
export function UnverifiedNotice({ what = 'This text' }: { what?: string }) {
  return (
    <p
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900
        dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
      role="note"
    >
      {what} is development placeholder content and has not yet been verified against a printed
      edition. Do not rely on it.
    </p>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('prose-reader', className)}>{children}</div>;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <p className="font-serif text-lg text-text-secondary">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">{body}</p> : null}
    </div>
  );
}

export function Divider({ ornament = false }: { ornament?: boolean }) {
  return <hr className={cn('my-10', ornament ? 'rule-ornament' : 'border-t border-line')} />;
}

export function Breadcrumbs({ items }: { items: Array<{ name: string; path: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-1.5">
              {isLast ? (
                <span aria-current="page" className="text-text-secondary">
                  {item.name}
                </span>
              ) : (
                <Link href={item.path} className="transition-colors hover:text-accent">
                  {item.name}
                </Link>
              )}
              {!isLast ? (
                <span aria-hidden="true" className="text-line-strong">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const buttonStyles = {
  primary: 'bg-accent text-accent-contrast hover:opacity-90',
  secondary: 'border border-line bg-surface text-text-primary hover:border-line-strong',
  ghost: 'text-text-secondary hover:bg-surface-sunken',
} as const;

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof buttonStyles;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link
      href={href}
      className={cn(
        // 44px minimum touch target, everywhere.
        'inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-medium',
        'transition-all duration-150 ease-standard',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
