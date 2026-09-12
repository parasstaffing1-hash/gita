/**
 * The quote card, drawn with ordinary React Native views.
 *
 * The web draws the same design into a `<canvas>`. That renderer is the one
 * part of `@gita/quote-composer` that does not port — it measures with
 * `CanvasRenderingContext2D` and there is no canvas here. Everything above it
 * does port: `computeLayout` is pure arithmetic and resolution-independent, so
 * this component consumes exactly the same geometry the browser does and the
 * two clients cannot drift into two different designs.
 *
 * The one number that turns that geometry into this platform is `k`, the ratio
 * between the card's width in dp and the format's width in pixels. Every size,
 * gap, inset and offset below is a layout value multiplied by `k` and nothing
 * else. That is what lets the same component be a 340dp preview and a
 * 720dp-wide offscreen view that captures at 2160px.
 *
 * Two rules the browser gets for free and this does not:
 *
 *   - `allowFontScaling` is off everywhere. The reader's OS type-size setting
 *     must not change a card, or the preview and the exported file disagree
 *     and the fit pass below measures something the export never renders.
 *   - No custom fonts. The app ships no font binaries, so Devanagari, IAST and
 *     the Latin faces all resolve through the platform stack. That is a real
 *     difference from the web's Noto/Lora set, and it is deliberate: the OS
 *     stack shapes Devanagari correctly on both platforms with no assets to
 *     license, ship, or load before a capture is accurate.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Text, View, type LayoutChangeEvent } from 'react-native';

import {
  FIT_STEP,
  blockSpace,
  computeLayout,
  minFitFactor,
  panelPadding,
  scaleType,
  type LayoutResult,
  type QuoteComposition,
  type TypeStep,
} from '@gita/quote-composer';
// Type-only: `QuoteContent` is declared beside the canvas renderer, and
// importing it this way means Babel strips the reference entirely rather than
// pulling a browser-only module into the reach of this file.
import type { QuoteContent } from '@gita/quote-composer';

/** The ground under a card with no photograph, matching the web's placeholder. */
const PLAIN_GROUND = '#241F18';

/**
 * Faces, chosen for coverage rather than for character.
 *
 * The transliteration line carries ṛ ṣ ṭ ḥ ṁ from Latin Extended Additional.
 * Georgia has none of them, so asking for a serif there on iOS would draw each
 * diacritic from a different per-glyph fallback — the exact failure the web
 * renderer's font stack is written to avoid. The system face covers the range,
 * so transliteration stays on it and only the translation takes a serif.
 */
const FACES = {
  sanskrit: undefined,
  transliteration: undefined,
  translation: Platform.select({ ios: 'Georgia', default: 'serif' }),
  sans: undefined,
} as const;

export interface QuoteCardProps {
  composition: QuoteComposition;
  content: QuoteContent;
  /** Already re-based for this device — see `mediaUrl`. */
  imageUrl: string | null;
  luminance: number | null;
  /** Card width in dp. Height follows from the format's aspect ratio. */
  width: number;
  /** Holds the frame's colour steady while the photograph loads. */
  dominantColor?: string | null;
  /**
   * A fit factor to use instead of measuring for one.
   *
   * The factor is a property of the design, not of the size it is drawn at —
   * the frame, the type and the block all scale with `k` together — so the
   * preview's answer is the export's answer. Passing it means the offscreen
   * export card renders correctly on its first frame instead of racing a
   * settling measurement loop that the capture would not wait for.
   */
  fit?: number;
  /** Reports the factor once the measurement loop has settled. */
  onFit?: (factor: number) => void;
}

export function QuoteCard({
  composition,
  content,
  imageUrl,
  luminance,
  width,
  dominantColor,
  fit: fixedFit,
  onFit,
}: QuoteCardProps) {
  const full = useMemo(
    () => computeLayout(composition, { luminance }),
    [composition, luminance],
  );

  const k = width / full.width;
  const height = Math.round(width * (full.height / full.width));

  // --- The fit pass ------------------------------------------------------
  //
  // `scale` is a taste control, not a promise. Three layers of a four-line
  // shloka do not fit a link card at any size a reader would pick, and the web
  // handles that by stepping the type down until it fits or hits a floor. The
  // rule lives in the shared package precisely so a second renderer can arrive
  // at the same answer; the only difference here is that RN measures the block
  // for us instead of us measuring it glyph by glyph.
  const floor = minFitFactor(full);
  const [measured, setMeasured] = useState(1);
  const fit = fixedFit ?? measured;

  // Anything that changes what has to fit restarts the search from full size,
  // otherwise a card that shrank for a long verse stays shrunk for a short one.
  const identity = `${JSON.stringify(composition)}|${JSON.stringify(content)}`;
  const lastIdentity = useRef(identity);
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    if (measured !== 1) setMeasured(1);
  }

  useEffect(() => {
    onFit?.(measured);
  }, [measured, onFit]);

  const layout = fit === 1 ? full : scaleType(full, fit);
  // Room is a property of the frame, so it is measured on the unshrunk layout —
  // taking it from the shrunk copy would move the target every time the type
  // moved and the loop would never settle.
  const room = blockSpace(full) * k;

  function onBlockLayout(event: LayoutChangeEvent) {
    // A card given a settled factor is not looking for one.
    if (fixedFit !== undefined || measured <= floor) return;
    // Half a point of slack: RN reports fractional heights and an exact
    // comparison can oscillate on a block that is level with its limit.
    if (event.nativeEvent.layout.height <= room + 0.5) return;
    setMeasured((current) => Math.max(floor, Number((current - FIT_STEP).toFixed(4))));
  }

  return (
    <View
      // Android collapses views with no drawing of their own, and a collapsed
      // view has no handle for `captureRef` to snapshot.
      collapsable={false}
      style={{
        width,
        height,
        overflow: 'hidden',
        backgroundColor: dominantColor ?? PLAIN_GROUND,
      }}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          resizeMode="cover"
          style={{ position: 'absolute', width, height }}
        />
      ) : null}

      <Scrim layout={layout} k={k} />
      <Block layout={layout} content={content} k={k} onLayout={onBlockLayout} />

      {content.unverified ? (
        // Baked into the frame on purpose. A card reshared out of context is
        // exactly when it matters that the text has not been checked.
        <Text
          allowFontScaling={false}
          style={{
            position: 'absolute',
            top: layout.margin * k,
            right: layout.margin * k,
            color: layout.colors.muted,
            fontFamily: FACES.sans,
            fontSize: layout.typeBase * 0.015 * k,
            fontWeight: '500',
          }}
        >
          Unverified draft
        </Text>
      ) : null}
    </View>
  );
}

// --- Scrim -----------------------------------------------------------------

/**
 * The ground the type sits on.
 *
 * Devanagari carries a headline rule and dense conjuncts and simply disappears
 * over a photograph; the scrim is what makes it legible, and it is why nothing
 * here reaches for a drop shadow. The layout says where the gradient runs, how
 * opaque it is at each stop, and which colour it darkens or lightens towards.
 */
function Scrim({ layout, k }: { layout: LayoutResult; k: number }) {
  const { scrim } = layout;
  if (scrim.kind === 'none') return null;

  const height = layout.height * k;
  const width = layout.width * k;

  if (scrim.kind === 'even') {
    return (
      <>
        <View
          style={{
            position: 'absolute',
            width,
            height,
            backgroundColor: withAlpha(scrim.color, scrim.stops[0]?.opacity ?? 0),
          }}
        />
        <Vignette scrim={scrim} width={width} height={height} />
      </>
    );
  }

  const stops = scrim.stops.length > 1 ? scrim.stops : [...scrim.stops, ...scrim.stops];
  const top = scrim.from * height;
  const band = Math.max(1, (scrim.to - scrim.from) * height);
  const first = stops[0]?.opacity ?? 0;
  const last = stops[stops.length - 1]?.opacity ?? 0;

  return (
    <>
      {/* A canvas gradient clamps to its end stops outside its own span, so the
          frame above and below the band is not transparent unless the stop is.
          These two fills are what the browser gets for free. */}
      {top > 0 && first > 0 ? (
        <View
          style={{
            position: 'absolute',
            width,
            height: top,
            backgroundColor: withAlpha(scrim.color, first),
          }}
        />
      ) : null}

      <LinearGradient
        colors={stops.map((stop) => withAlpha(scrim.color, stop.opacity)) as [string, string, ...string[]]}
        locations={stops.map((stop) => stop.at) as [number, number, ...number[]]}
        style={{ position: 'absolute', top, width, height: band }}
      />

      {scrim.to < 1 && last > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: top + band,
            width,
            height: Math.max(0, height - top - band),
            backgroundColor: withAlpha(scrim.color, last),
          }}
        />
      ) : null}

      <Vignette scrim={scrim} width={width} height={height} />
    </>
  );
}

/**
 * The soft edge darkening that stops a card reading as a screenshot.
 *
 * The web draws one radial gradient. There is no radial gradient on this
 * platform without another native dependency, so this is four linear edges at
 * the same strength. It is not the same shape, but it does the same job —
 * pulling the corners down so the frame has an edge — and at these opacities
 * the difference is not visible next to the photograph underneath.
 */
function Vignette({
  scrim,
  width,
  height,
}: {
  scrim: LayoutResult['scrim'];
  width: number;
  height: number;
}) {
  if (scrim.vignette <= 0) return null;

  const strong = withAlpha(scrim.color, scrim.vignette);
  const clear = withAlpha(scrim.color, 0);
  const bandY = height * 0.22;
  const bandX = width * 0.22;

  return (
    <>
      <LinearGradient
        colors={[strong, clear]}
        style={{ position: 'absolute', top: 0, width, height: bandY }}
      />
      <LinearGradient
        colors={[clear, strong]}
        style={{ position: 'absolute', top: height - bandY, width, height: bandY }}
      />
      <LinearGradient
        colors={[strong, clear]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, top: 0, width: bandX, height }}
      />
      <LinearGradient
        colors={[clear, strong]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: width - bandX, top: 0, width: bandX, height }}
      />
    </>
  );
}

// --- The text block --------------------------------------------------------

/**
 * The verse, its citation, and the reader's own line.
 *
 * The order is fixed and matches the canvas renderer: Sanskrit, transliteration,
 * translation, reference, caption. The reference is always drawn — a card
 * without its citation is exactly the decontextualised scripture this whole
 * product exists to avoid — and the caption is set small, in a different voice
 * and after the citation, so it cannot be mistaken for part of the verse.
 */
function Block({
  layout,
  content,
  k,
  onLayout,
}: {
  layout: LayoutResult;
  content: QuoteContent;
  k: number;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { block, colors, gap, type, panel } = layout;
  const textAlign = block.align === 'center' ? 'center' : 'left';
  const items = block.align === 'center' ? 'center' : 'flex-start';

  // A middle-anchored block grows in both directions, so it is centred inside
  // a box that runs from the top of the frame to twice its anchor. Bottom and
  // top anchors just pin one edge.
  const frame =
    block.anchor === 'middle'
      ? { top: 0, height: block.anchorY * 2 * k, justifyContent: 'center' as const }
      : block.anchor === 'bottom'
        ? { top: 0, height: block.anchorY * k, justifyContent: 'flex-end' as const }
        : { top: block.anchorY * k, bottom: 0, justifyContent: 'flex-start' as const };

  // The panel wraps the text rather than the text fitting a box, which is why
  // the layout leaves its height at zero for the renderer to fill in. Flex does
  // that for us. The web frosts the image behind it; a real blur here would
  // need `expo-blur`, whose views are not reliably picked up by the snapshot on
  // Android, so the panel leans on its fill alone — which is what carries the
  // legibility in either case.
  const panelStyle = panel
    ? {
        backgroundColor: panel.fill,
        borderColor: panel.border,
        // Proportional to the frame, like everything else here, so the panel
        // edge does not become a heavy line on a small preview or vanish on a
        // 4K export.
        borderWidth: Math.max(1, layout.typeBase * 0.0015 * k),
        borderRadius: panel.radius * k,
        padding: panelPadding(layout) * k,
      }
    : null;

  const inner = panel
    ? { left: panel.x * k, width: panel.width * k }
    : {
        left: (block.align === 'center' ? block.x - block.maxWidth / 2 : block.x) * k,
        width: block.maxWidth * k,
      };

  return (
    <View style={{ position: 'absolute', ...frame, ...inner }} pointerEvents="none">
      <View onLayout={onLayout} style={[{ alignItems: items }, panelStyle]}>
        {layout.rule ? (
          <View
            style={{
              width: layout.rule.width * k,
              height: Math.max(1, layout.rule.height * k),
              backgroundColor: colors.accent,
              marginBottom: gap.afterTransliteration * k,
            }}
          />
        ) : null}

        {content.sanskrit ? (
          <Line
            text={content.sanskrit}
            step={type.sanskrit}
            k={k}
            color={colors.primary}
            align={textAlign}
            family={FACES.sanskrit}
            weight="500"
            gapAfter={gap.afterSanskrit * k}
          />
        ) : null}

        {content.transliteration ? (
          <Line
            text={content.transliteration}
            step={type.transliteration}
            k={k}
            color={colors.muted}
            align={textAlign}
            family={FACES.transliteration}
            italic
            gapAfter={gap.afterTransliteration * k}
          />
        ) : null}

        {content.translation ? (
          <Line
            text={content.translation}
            step={type.translation}
            k={k}
            color={colors.secondary}
            align={textAlign}
            family={FACES.translation}
            gapAfter={gap.afterTranslation * k}
          />
        ) : null}

        <Line
          text={content.reference}
          step={type.reference}
          k={k}
          color={colors.accent}
          align={textAlign}
          family={FACES.sans}
          weight="600"
          gapAfter={content.caption ? gap.beforeReference * 0.5 * k : 0}
        />

        {content.caption ? (
          <Line
            text={content.caption}
            step={type.caption}
            k={k}
            color={colors.muted}
            align={textAlign}
            family={FACES.sans}
          />
        ) : null}
      </View>
    </View>
  );
}

function Line({
  text,
  step,
  k,
  color,
  align,
  family,
  weight,
  italic,
  gapAfter = 0,
}: {
  text: string;
  step: TypeStep;
  k: number;
  color: string;
  align: 'left' | 'center';
  family: string | undefined;
  weight?: '400' | '500' | '600';
  italic?: boolean;
  gapAfter?: number;
}) {
  const size = step.size * k;
  return (
    <Text
      allowFontScaling={false}
      style={{
        color,
        fontFamily: family,
        fontSize: size,
        // The layout gives leading as a multiplier and tracking as a fraction
        // of the size; RN wants both in points.
        lineHeight: size * step.lineHeight,
        letterSpacing: step.letterSpacing * size,
        fontStyle: italic ? 'italic' : 'normal',
        fontWeight: weight ?? '400',
        textAlign: align,
        alignSelf: 'stretch',
        marginBottom: gapAfter,
      }}
    >
      {text}
    </Text>
  );
}

// --- Colour ----------------------------------------------------------------

/** The scrim colour is a flat hex; every stop needs it at a different alpha. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
