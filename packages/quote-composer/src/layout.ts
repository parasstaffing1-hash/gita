/**
 * The layout engine.
 *
 * Turns a composition plus a canvas size into concrete geometry: where the
 * scrim goes, where the text block sits, how large each layer is, and what
 * colour it takes. Every renderer consumes this, so a 1080-wide preview and a
 * 3840-wide export are the same design rather than two that drifted.
 *
 * The design problem this solves is legibility. Devanagari carries a headline
 * rule and dense conjuncts; over a photograph it disappears unless the ground
 * is prepared for it. Each layout answers that differently, and none of them
 * reaches for a drop shadow — a shadow on type over a photo is what makes a
 * card look cheap. The scrim does the work instead.
 */

import { palette } from '@gita/design-tokens';

import type { AccentName, LayoutName, QuoteComposition, ToneName } from './composition';
import { FORMAT_SPECS, clampScale } from './composition';

export interface ScrimStop {
  /** 0 = start of the gradient, 1 = end. */
  at: number;
  /** 0 = fully transparent, 1 = fully opaque. */
  opacity: number;
}

export interface ScrimSpec {
  kind: 'linear' | 'even' | 'none';
  /** Gradient direction, as a fraction of the canvas height. */
  from: number;
  to: number;
  stops: ScrimStop[];
  /** The colour the scrim darkens or lightens towards. */
  color: string;
  /** A soft edge darkening that stops the frame feeling like a screenshot. */
  vignette: number;
}

/**
 * The frosted panel behind the verse.
 *
 * Only the horizontal geometry lives here. A panel wraps the text rather than
 * the text fitting a box, so its top and height are not knowable until the
 * block has been measured and fitted — the renderer derives them at draw time.
 * They are absent rather than zero because a caller reading `height` and
 * getting 0 would draw nothing and have no way to tell that from a real answer.
 */
export interface PanelSpec {
  x: number;
  width: number;
  radius: number;
  /** Blur radius applied to the image behind the panel. */
  blur: number;
  fill: string;
  border: string;
}

export interface TypeStep {
  /** Font size in pixels of the output canvas. */
  size: number;
  /** A multiplier on `size`, not a pixel value. Devanagari needs ~1.72. */
  lineHeight: number;
  /** A fraction of `size`, applied by the renderer glyph by glyph. */
  letterSpacing: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  margin: number;
  /** The dimension type sizes are derived from, so landscape does not shout. */
  typeBase: number;
  scrim: ScrimSpec;
  panel: PanelSpec | null;
  block: {
    x: number;
    maxWidth: number;
    align: 'left' | 'center';
    anchor: 'top' | 'middle' | 'bottom';
    /** Where the anchored edge sits, in pixels from the top. */
    anchorY: number;
  };
  type: {
    sanskrit: TypeStep;
    transliteration: TypeStep;
    translation: TypeStep;
    reference: TypeStep;
    caption: TypeStep;
  };
  gap: {
    afterSanskrit: number;
    afterTransliteration: number;
    afterTranslation: number;
    beforeReference: number;
  };
  rule: { width: number; height: number } | null;
  colors: {
    primary: string;
    secondary: string;
    muted: string;
    accent: string;
  };
}

/**
 * Resolve `tone: 'auto'` from how bright the image actually is.
 *
 * `luminance` is 0..1, stored per wallpaper and measured over the region the
 * text will occupy rather than the whole frame — a dark photo with a bright
 * sky still needs dark type if the verse sits in the sky.
 */
export function resolveTone(tone: ToneName, luminance: number | null): 'dark' | 'light' {
  if (tone !== 'auto') return tone;
  if (luminance === null) return 'dark';
  // Above this the image is bright enough that dark type reads better. The
  // threshold sits high because a scrim can always darken a mid image, whereas
  // lightening a dark one washes the photograph out.
  return luminance > 0.62 ? 'light' : 'dark';
}

function accentColor(accent: AccentName, tone: 'dark' | 'light'): string {
  if (accent === 'none') {
    return tone === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(28,27,24,0.45)';
  }
  if (accent === 'saffron') {
    return tone === 'dark' ? palette.saffron[300] : palette.saffron[700];
  }
  return tone === 'dark' ? palette.gold[300] : palette.gold[700];
}

function toneColors(tone: 'dark' | 'light', accent: AccentName) {
  if (tone === 'dark') {
    return {
      // A warm white rather than #FFF: pure white against a photograph reads
      // as a UI element, not as printed type.
      primary: '#FCFAF6',
      secondary: 'rgba(252,250,246,0.88)',
      muted: 'rgba(252,250,246,0.66)',
      accent: accentColor(accent, 'dark'),
    };
  }
  return {
    primary: '#1A1815',
    secondary: 'rgba(26,24,21,0.86)',
    muted: 'rgba(26,24,21,0.62)',
    accent: accentColor(accent, 'light'),
  };
}

const SCRIM_DARK = '#0B0A08';
const SCRIM_LIGHT = '#FBF9F5';

export function computeLayout(
  composition: QuoteComposition,
  options: { luminance?: number | null } = {},
): LayoutResult {
  const spec = FORMAT_SPECS[composition.format];
  const { width, height } = spec;
  const scale = clampScale(composition.scale);
  const tone = resolveTone(composition.tone, options.luminance ?? null);
  const colors = toneColors(tone, composition.accent);
  const scrimColor = tone === 'dark' ? SCRIM_DARK : SCRIM_LIGHT;

  const isLandscape = width > height;
  // Landscape frames are wide but not tall. Sizing type off the width would
  // produce enormous letters and a line measure nobody can read across, so the
  // height governs instead.
  const typeBase = isLandscape ? height * 0.78 : width;
  const margin = Math.round(width * (isLandscape ? 0.07 : 0.085));

  const step = (ratio: number, lineHeight: number, letterSpacing = 0): TypeStep => ({
    size: Math.round(typeBase * ratio * scale),
    lineHeight,
    letterSpacing,
  });

  const type = {
    // Devanagari needs far more leading than Latin at the same size; 1.72 is
    // the point where matras and conjuncts stop colliding across lines.
    sanskrit: step(0.056, 1.72),
    transliteration: step(0.028, 1.6),
    translation: step(0.030, 1.55),
    reference: step(0.019, 1.4, 0.14),
    caption: step(0.016, 1.4, 0.06),
  };

  const gap = {
    afterSanskrit: Math.round(typeBase * 0.045 * scale),
    afterTransliteration: Math.round(typeBase * 0.028 * scale),
    afterTranslation: Math.round(typeBase * 0.042 * scale),
    beforeReference: Math.round(typeBase * 0.03 * scale),
  };

  const base: Omit<LayoutResult, 'scrim' | 'panel' | 'block' | 'rule'> = {
    width,
    height,
    margin,
    typeBase,
    type,
    gap,
    colors,
  };

  const rule = { width: Math.round(typeBase * 0.07), height: Math.max(2, Math.round(typeBase * 0.0026)) };
  const measureCap = Math.round(typeBase * 0.98);

  switch (composition.layout) {
    case 'centered':
      return {
        ...base,
        // An even scrim across the whole frame, because the type sits in the
        // middle where a directional gradient would be at its weakest.
        scrim: {
          kind: 'even',
          from: 0,
          to: 1,
          stops: [{ at: 0, opacity: 0.46 }],
          color: scrimColor,
          vignette: 0.3,
        },
        panel: null,
        block: {
          x: width / 2,
          maxWidth: Math.min(width - margin * 2, measureCap),
          align: 'center',
          anchor: 'middle',
          anchorY: height / 2,
        },
        rule: composition.accent === 'none' ? null : rule,
      };

    case 'lower':
      return {
        ...base,
        // Rises from the bottom, so the top of the photograph stays intact.
        scrim: {
          kind: 'linear',
          from: 0.32,
          to: 1,
          stops: [
            { at: 0, opacity: 0 },
            { at: 0.55, opacity: 0.5 },
            { at: 1, opacity: 0.84 },
          ],
          color: scrimColor,
          vignette: 0.16,
        },
        panel: null,
        block: {
          x: margin,
          maxWidth: Math.min(width - margin * 2, measureCap),
          // Left-aligned reads as typeset rather than as a default centre.
          align: 'left',
          anchor: 'bottom',
          anchorY: height - margin * 1.15,
        },
        rule: composition.accent === 'none' ? null : rule,
      };

    case 'panel': {
      const panelWidth = width - margin * 1.5;
      const panelX = (width - panelWidth) / 2;
      return {
        ...base,
        // The panel does the legibility work, so the scrim stays light and the
        // photograph keeps its colour.
        scrim: {
          kind: 'even',
          from: 0,
          to: 1,
          stops: [{ at: 0, opacity: 0.18 }],
          color: scrimColor,
          vignette: 0.22,
        },
        panel: {
          x: panelX,
          width: panelWidth,
          radius: Math.round(typeBase * 0.035),
          blur: Math.round(typeBase * 0.03),
          fill: tone === 'dark' ? 'rgba(11,10,8,0.58)' : 'rgba(251,249,245,0.74)',
          border: tone === 'dark' ? 'rgba(252,250,246,0.14)' : 'rgba(26,24,21,0.10)',
        },
        block: {
          x: width / 2,
          maxWidth: Math.min(panelWidth - margin * 1.2, measureCap),
          align: 'center',
          anchor: 'middle',
          anchorY: height / 2,
        },
        rule: null,
      };
    }

    case 'minimal':
      return {
        ...base,
        scrim: {
          kind: 'linear',
          from: 0.55,
          to: 1,
          stops: [
            { at: 0, opacity: 0 },
            { at: 1, opacity: 0.62 },
          ],
          color: scrimColor,
          vignette: 0.1,
        },
        panel: null,
        block: {
          x: margin,
          maxWidth: Math.min(width * 0.66, measureCap),
          align: 'left',
          anchor: 'bottom',
          anchorY: height - margin,
        },
        rule: null,
      };

    case 'banner':
    default:
      return {
        ...base,
        // Sized for a phone lock screen: clear of the clock at the top and the
        // icon row at the bottom, so the verse is not covered by the OS.
        scrim: {
          kind: 'linear',
          from: 0.1,
          to: 0.72,
          stops: [
            { at: 0, opacity: 0.08 },
            { at: 0.35, opacity: 0.58 },
            { at: 1, opacity: 0.12 },
          ],
          color: scrimColor,
          vignette: 0.18,
        },
        panel: null,
        block: {
          x: width / 2,
          maxWidth: Math.min(width - margin * 2, measureCap),
          align: 'center',
          anchor: 'top',
          anchorY: Math.round(height * 0.26),
        },
        rule: composition.accent === 'none' ? null : rule,
      };
  }
}

// --- Fitting ---------------------------------------------------------------
//
// `scale` is a taste control, not a guarantee. Three layers of a four-line
// shloka do not fit a 1200x630 link card at any size a reader would choose,
// and the renderer needs a rule for that case that is the same on the preview
// canvas and on the export canvas. These derive that rule from the layout
// alone, so both arrive at it independently and agree.

/** The ladder the fit pass steps down. Fine enough not to give away more size
 *  than the overflow needs, coarse enough to settle in a few passes. */
export const FIT_STEP = 0.025;

/**
 * The smallest the verse may be set, as a fraction of `typeBase`: half what
 * the scale control asks for at its midpoint. Past this the shloka stops being
 * something a reader reads and becomes something they can see is there.
 */
const MIN_SANSKRIT_RATIO = 0.028;

/**
 * How far the fit pass may take the type down.
 *
 * The floor is a size, not a proportion, so the same verse on the same card
 * lands at the same size whether the reader had the scale control at 0.75 or
 * at 1.4. A proportional floor would let the top of the range overflow and
 * refuse to shrink at the bottom of it.
 */
export function minFitFactor(layout: LayoutResult): number {
  return Math.min(1, (layout.typeBase * MIN_SANSKRIT_RATIO) / layout.type.sanskrit.size);
}

/** The padding a frosted panel puts between its edge and the text inside it. */
export function panelPadding(layout: LayoutResult): number {
  return layout.margin * 0.85;
}

/** How close to the frame edge the text block may come. On a panel layout the
 *  panel's own padding is outside the block, so it comes out of the same room. */
export function blockInset(layout: LayoutResult): number {
  return (layout.panel ? panelPadding(layout) : 0) + layout.margin * 0.5;
}

/**
 * The vertical room the block has, given where its anchor pins it.
 *
 * A middle-anchored block grows in both directions, so it is limited by twice
 * the nearer edge rather than by the total height between the insets.
 */
export function blockSpace(layout: LayoutResult): number {
  const inset = blockInset(layout);
  const top = inset;
  const bottom = layout.height - inset;
  const { anchor, anchorY } = layout.block;

  if (anchor === 'middle') return Math.max(0, 2 * Math.min(anchorY - top, bottom - anchorY));
  if (anchor === 'bottom') return Math.max(0, anchorY - top);
  return Math.max(0, bottom - anchorY);
}

/**
 * A copy of the layout with every type size and gap taken down by `factor`.
 *
 * Sizes and gaps move together so the composition holds: shrinking the type
 * without the space around it leaves a card that reads as small type floating
 * in a block sized for something else.
 */
export function scaleType(layout: LayoutResult, factor: number): LayoutResult {
  const step = (value: TypeStep): TypeStep => ({
    ...value,
    size: Math.max(1, Math.round(value.size * factor)),
  });

  return {
    ...layout,
    type: {
      sanskrit: step(layout.type.sanskrit),
      transliteration: step(layout.type.transliteration),
      translation: step(layout.type.translation),
      reference: step(layout.type.reference),
      caption: step(layout.type.caption),
    },
    gap: {
      afterSanskrit: Math.round(layout.gap.afterSanskrit * factor),
      afterTransliteration: Math.round(layout.gap.afterTransliteration * factor),
      afterTranslation: Math.round(layout.gap.afterTranslation * factor),
      beforeReference: Math.round(layout.gap.beforeReference * factor),
    },
  };
}

/** Human-readable descriptions, used in the picker rather than hard-coded in the UI. */
export const LAYOUT_INFO: Record<LayoutName, { name: string; description: string }> = {
  centered: {
    name: 'Centred',
    description: 'Verse in the middle, even scrim. Works on almost any image.',
  },
  lower: {
    name: 'Lower third',
    description: 'Text at the base, photograph clear above it.',
  },
  panel: {
    name: 'Panel',
    description: 'Frosted panel behind the text. The most legible over a busy image.',
  },
  minimal: {
    name: 'Quiet',
    description: 'Small type at the edge. The photograph leads.',
  },
  banner: {
    name: 'Lock screen',
    description: 'Kept clear of the clock and the icon row on a phone.',
  },
};
