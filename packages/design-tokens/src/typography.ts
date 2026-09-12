/**
 * Typography.
 *
 * Devanagari needs more line height and a slightly larger optical size than
 * Latin at the same point size, so Sanskrit gets its own scale rather than
 * inheriting the body scale.
 */

export const fontFamilies = {
  /** Latin UI + English body. */
  sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  /** English translations and commentary — reads better long-form. */
  serif: ['Lora', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
  /** Devanagari for Sanskrit verses and Hindi. */
  devanagari: ['Noto Serif Devanagari', 'Noto Sans Devanagari', 'Mangal', 'serif'],
  /** IAST transliteration — needs full diacritic coverage. */
  transliteration: ['Noto Serif', 'Charis SIL', 'Georgia', 'serif'],
  mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
} as const;

export const fontSizes = {
  xs: 12,
  sm: 14,
  base: 16,
  md: 17,
  lg: 19,
  xl: 22,
  '2xl': 26,
  '3xl': 32,
  '4xl': 40,
  '5xl': 52,
} as const;

/** Devanagari optical scale — one step larger than the Latin equivalent. */
export const sanskritSizes = {
  sm: 18,
  base: 21,
  lg: 24,
  xl: 28,
  '2xl': 34,
} as const;

export const lineHeights = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.55,
  relaxed: 1.75,
  loose: 2.0,
  /** Devanagari conjuncts and matras need headroom. */
  devanagari: 1.9,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const letterSpacing = {
  tight: -0.4,
  normal: 0,
  wide: 0.4,
  wider: 1.2,
} as const;

/** Reader density presets — map to vertical rhythm, not font size. */
export const density = {
  compact: { blockGap: 12, versePadding: 14, sectionGap: 20 },
  comfortable: { blockGap: 18, versePadding: 20, sectionGap: 32 },
  spacious: { blockGap: 26, versePadding: 28, sectionGap: 44 },
} as const;

export type DensityName = keyof typeof density;
