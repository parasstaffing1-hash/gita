/** Tailwind preset shared by the website and the admin panel. */
import { palette } from './colors';
import { fontFamilies, lineHeights } from './typography';
import { radii, contentWidth } from './layout';

export const gitaTailwindPreset = {
  theme: {
    extend: {
      colors: {
        sand: palette.sand,
        saffron: palette.saffron,
        gold: palette.gold,
        ink: palette.ink,
        highlight: palette.highlight,
        // CSS-variable driven semantic colours so dark/sepia swap cleanly.
        background: 'rgb(var(--gita-background) / <alpha-value>)',
        surface: 'rgb(var(--gita-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--gita-surface-raised) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--gita-surface-sunken) / <alpha-value>)',
        line: 'rgb(var(--gita-border) / <alpha-value>)',
        'line-strong': 'rgb(var(--gita-border-strong) / <alpha-value>)',
        'text-primary': 'rgb(var(--gita-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--gita-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--gita-text-muted) / <alpha-value>)',
        accent: 'rgb(var(--gita-accent) / <alpha-value>)',
        'accent-muted': 'rgb(var(--gita-accent-muted) / <alpha-value>)',
        'accent-contrast': 'rgb(var(--gita-accent-contrast) / <alpha-value>)',
      },
      fontFamily: {
        sans: [...fontFamilies.sans],
        serif: [...fontFamilies.serif],
        devanagari: [...fontFamilies.devanagari],
        translit: [...fontFamilies.transliteration],
        mono: [...fontFamilies.mono],
      },
      lineHeight: {
        devanagari: String(lineHeights.devanagari),
        relaxed: String(lineHeights.relaxed),
      },
      borderRadius: {
        sm: `${radii.sm}px`,
        md: `${radii.md}px`,
        lg: `${radii.lg}px`,
        xl: `${radii.xl}px`,
        '2xl': `${radii['2xl']}px`,
      },
      maxWidth: {
        reader: `${contentWidth.reader}px`,
        prose: `${contentWidth.prose}px`,
        wide: `${contentWidth.wide}px`,
      },
      boxShadow: {
        soft: '0 1px 2px rgba(28, 27, 24, 0.05)',
        card: '0 2px 8px rgba(28, 27, 24, 0.06)',
        lifted: '0 8px 24px rgba(28, 27, 24, 0.08)',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
} as const;

export default gitaTailwindPreset;
