/**
 * Palette.
 *
 * Warm neutral paper, restrained saffron/gold accent used only for emphasis,
 * and a genuinely dark (not merely inverted) night theme. Saffron is an accent,
 * never a background wash.
 */

export const palette = {
  // Warm neutrals — the reading surface.
  sand: {
    50: '#FBF9F5',
    100: '#F5F1E9',
    200: '#EAE3D6',
    300: '#DACFBC',
    400: '#BFAF97',
    500: '#A08E73',
    600: '#7F6F58',
    700: '#5F5342',
    800: '#40382C',
    900: '#241F18',
    950: '#15120E',
  },
  // Saffron — accent only.
  saffron: {
    50: '#FFF6EB',
    100: '#FFE9CE',
    200: '#FFD199',
    300: '#F7B563',
    400: '#EE9B39',
    500: '#DD8420',
    600: '#B96716',
    700: '#8F4E14',
    800: '#6A3B14',
    900: '#4A2A11',
  },
  // Gold — dividers, marks, subtle ornaments.
  gold: {
    100: '#F6EEDA',
    300: '#DFC98C',
    500: '#C0A55C',
    700: '#8C763B',
  },
  // Ink — typography.
  ink: {
    50: '#F7F7F6',
    100: '#E7E6E3',
    300: '#B4B1AA',
    500: '#6F6C64',
    700: '#3D3B36',
    900: '#1C1B18',
  },
  // Highlight colours the reader can apply.
  highlight: {
    saffron: '#F9DCB4',
    gold: '#F1E4B8',
    sage: '#D5E3D0',
    sky: '#CFDEEA',
    rose: '#EFD5DA',
  },
  // Feedback. Deliberately muted to keep the surface calm.
  state: {
    success: '#4F7A54',
    warning: '#A8761F',
    danger: '#9B3B34',
    info: '#4A6C8C',
  },
} as const;

/** Semantic tokens resolved per theme. Components consume these, not `palette`. */
export interface SemanticColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  accent: string;
  accentMuted: string;
  accentContrast: string;
  sanskrit: string;
  transliteration: string;
  focusRing: string;
}

export const lightColors: SemanticColors = {
  background: palette.sand[50],
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: palette.sand[100],
  border: palette.sand[200],
  borderStrong: palette.sand[300],
  textPrimary: palette.ink[900],
  textSecondary: palette.ink[700],
  textMuted: palette.ink[500],
  textInverse: palette.sand[50],
  accent: palette.saffron[600],
  accentMuted: palette.saffron[100],
  accentContrast: '#FFFFFF',
  sanskrit: palette.ink[900],
  transliteration: palette.ink[500],
  focusRing: palette.saffron[500],
};

export const sepiaColors: SemanticColors = {
  background: '#F4ECDD',
  surface: '#FAF4E8',
  surfaceRaised: '#FFFBF2',
  surfaceSunken: '#EDE2CE',
  border: '#DFD0B4',
  borderStrong: '#CBB894',
  textPrimary: '#31281B',
  textSecondary: '#5A4B33',
  textMuted: '#7C6A4E',
  textInverse: '#FAF4E8',
  accent: palette.saffron[700],
  accentMuted: '#F0DFC0',
  accentContrast: '#FFFBF2',
  sanskrit: '#2B2115',
  transliteration: '#7C6A4E',
  focusRing: palette.saffron[600],
};

export const darkColors: SemanticColors = {
  background: '#12110F',
  surface: '#1A1815',
  surfaceRaised: '#232019',
  surfaceSunken: '#0D0C0A',
  border: '#2E2A23',
  borderStrong: '#413B31',
  textPrimary: '#EDE8DF',
  textSecondary: '#BDB6A9',
  textMuted: '#8C8578',
  textInverse: '#12110F',
  accent: palette.saffron[300],
  accentMuted: '#3A2A16',
  accentContrast: '#12110F',
  sanskrit: '#F2EDE3',
  transliteration: '#A79F91',
  focusRing: palette.saffron[300],
};

export const themes = {
  light: lightColors,
  dark: darkColors,
  sepia: sepiaColors,
} as const;

export type ThemeName = keyof typeof themes;

/** Convert a hex colour to the `R G B` triple Tailwind CSS variables expect. */
export function hexToRgbTriple(hex: string): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r} ${g} ${b}`;
}
