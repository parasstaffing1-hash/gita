/** Spacing, radii, elevation and motion. Restrained by design. */

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const radii = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

/** Shadows are barely-there: depth comes from surface tone, not drop shadows. */
export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(28, 27, 24, 0.05)',
  md: '0 2px 8px rgba(28, 27, 24, 0.06)',
  lg: '0 8px 24px rgba(28, 27, 24, 0.08)',
} as const;

export const motion = {
  duration: { instant: 0, fast: 140, base: 220, slow: 360, deliberate: 520 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    entrance: 'cubic-bezier(0, 0, 0, 1)',
    exit: 'cubic-bezier(0.3, 0, 1, 1)',
  },
} as const;

/** Accessibility floors, enforced in components. */
export const a11y = {
  minTouchTarget: 44,
  minContrastBody: 4.5,
  minContrastLarge: 3,
  maxFontScale: 2.0,
  minFontScale: 0.85,
} as const;

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

/** Reading measure: ~66 characters is the comfortable target. */
export const contentWidth = {
  reader: 680,
  prose: 720,
  wide: 1120,
} as const;
