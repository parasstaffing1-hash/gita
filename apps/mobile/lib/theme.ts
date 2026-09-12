/**
 * Reading themes.
 *
 * The same three surfaces as the website — light, sepia, dark — resolved from
 * the shared design tokens so the two clients cannot drift apart.
 */
import { darkColors, lightColors, sepiaColors, type SemanticColors } from '@gita/design-tokens';

export type ThemeName = 'light' | 'sepia' | 'dark';

export const THEMES: Record<ThemeName, SemanticColors> = {
  light: lightColors,
  sepia: sepiaColors,
  dark: darkColors,
};

export function resolveTheme(preference: ThemeName | 'system', systemDark: boolean): ThemeName {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/** Highlight colours, tuned per theme so they stay legible on a dark surface. */
export const HIGHLIGHT_COLORS: Record<ThemeName, Record<string, string>> = {
  light: {
    saffron: '#F9DCB4',
    gold: '#F1E4B8',
    sage: '#D5E3D0',
    sky: '#CFDEEA',
    rose: '#EFD5DA',
  },
  sepia: {
    saffron: '#EFD0A4',
    gold: '#E6D5A8',
    sage: '#C9D8C4',
    sky: '#C3D2DE',
    rose: '#E3C9CE',
  },
  dark: {
    saffron: '#4A3418',
    gold: '#453B1C',
    sage: '#28361F',
    sky: '#1F313F',
    rose: '#3D2229',
  },
};
