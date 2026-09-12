'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'sepia' | 'dark';

const ORDER: Theme[] = ['light', 'sepia', 'dark'];
const LABELS: Record<Theme, string> = { light: 'Light', sepia: 'Sepia', dark: 'Dark' };
const STORAGE_KEY = 'gita:theme';

/**
 * Reading theme switcher.
 *
 * The choice is written to localStorage and applied by an inline script in the
 * document head, so the correct theme is on the first paint and the page never
 * flashes light before turning dark.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme as Theme | undefined;
    setTheme(stored ?? 'light');
  }, []);

  function cycle() {
    const current = theme ?? 'light';
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] as Theme;
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing or blocked storage: the theme still applies for this
      // page view, it just will not be remembered.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      // Rendered before hydration too, so the control never pops in.
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3
        text-sm text-text-secondary transition-colors hover:bg-surface-sunken"
      aria-label={theme ? `Reading theme: ${LABELS[theme]}. Change theme.` : 'Change reading theme'}
      title="Change reading theme"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />
      </svg>
    </button>
  );
}

/**
 * Applies the stored theme before first paint.
 *
 * This runs as a blocking inline script on purpose — it is a handful of
 * statements, and the alternative is a visible flash on every navigation for
 * anyone reading at night.
 */
export const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'light' || t === 'sepia' || t === 'dark') {
      document.documentElement.dataset.theme = t;
    }
  } catch (e) {}
})();
`;
