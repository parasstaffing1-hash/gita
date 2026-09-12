/**
 * The canvas renderer.
 *
 * One implementation drives the live preview and the full-resolution export,
 * so the download is the thing that was on screen rather than a second
 * approximation of it. It runs on the reader's device, which means a 4K export
 * costs nothing on the server and works with 1000 people composing at once.
 *
 * Everything is measured before anything is drawn: the panel layout needs the
 * height of the text block before it can size itself, and the anchor logic
 * needs it to place the block at all.
 */

import { FIT_STEP, blockInset, blockSpace, minFitFactor, panelPadding, scaleType } from './layout';
import type { LayoutResult } from './layout';

export interface QuoteContent {
  sanskrit: string | null;
  transliteration: string | null;
  translation: string | null;
  /** Rendered as "Bhagavad Gita 2.47" or the Devanagari equivalent. */
  reference: string;
  caption: string | null;
  /** Draws the standing notice when the verse has not been editorially verified. */
  unverified: boolean;
}

export const FONT_STACKS = {
  devanagari: '"Noto Serif Devanagari", "Noto Sans Devanagari", "Mangal", serif',
  serif: '"Lora", Georgia, Cambria, serif',
  // IAST carries ṛ ṣ ṭ ḥ ṁ, which live in U+1E00-1E9F. Lora covers that range,
  // the app loads it italic as well as upright, and it is the family the
  // translation is already set in. A family the app never requests falls
  // through to Georgia, which has none of those letters and ends up drawing
  // each one from a different per-glyph fallback.
  translit: '"Lora", "Charis SIL", Georgia, serif',
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

interface FaceSpec {
  stack: string;
  style: 'normal' | 'italic';
  weight: string;
}

/**
 * Every face the renderer asks the canvas for.
 *
 * The draw calls and the preload list read from this one table on purpose.
 * `document.fonts.load()` resolves a specific face, so a weight that is drawn
 * but never preloaded can become resident somewhere between the preview paint
 * and the full-resolution repaint — and then `wrap()` measures against a
 * different font the second time and the downloaded file breaks its lines
 * where the card on screen did not.
 */
export const FACES = {
  sanskrit: { stack: FONT_STACKS.devanagari, style: 'normal', weight: '500' },
  transliteration: { stack: FONT_STACKS.translit, style: 'italic', weight: '400' },
  translation: { stack: FONT_STACKS.serif, style: 'normal', weight: '400' },
  reference: { stack: FONT_STACKS.sans, style: 'normal', weight: '600' },
  caption: { stack: FONT_STACKS.sans, style: 'normal', weight: '400' },
  notice: { stack: FONT_STACKS.sans, style: 'normal', weight: '500' },
} satisfies Record<string, FaceSpec>;

/** The family a preload has to name is the first one in the stack; the rest
 *  are what the system already has. */
function primaryFamily(stack: string): string {
  return (stack.split(',')[0] ?? stack).trim();
}

// A size does not select the face, but the shorthand `document.fonts.load()`
// parses is invalid without one.
const PRELOAD_SIZE = 64;

/** The minimum a browser must have loaded before a render is accurate. */
export const REQUIRED_FONTS: readonly string[] = Array.from(
  new Set(
    Object.values(FACES).map(
      (face) => `${face.style} ${face.weight} ${PRELOAD_SIZE}px ${primaryFamily(face.stack)}`,
    ),
  ),
);

type Ctx = CanvasRenderingContext2D;

interface Line {
  text: string;
  font: string;
  size: number;
  lineHeight: number;
  color: string;
  letterSpacing: number;
  /** Space after this line. Non-zero only on the last line of a layer. */
  gapAfter: number;
}

interface MeasuredBlock {
  lines: Line[];
  height: number;
}

function fontString(face: FaceSpec, size: number): string {
  return `${face.style} ${face.weight} ${size}px ${face.stack}`;
}

function setFont(ctx: Ctx, size: number, face: FaceSpec): void {
  ctx.font = fontString(face, size);
}

/**
 * The width a string will actually occupy once it is drawn.
 *
 * Tracked text is laid out glyph by glyph by `drawTracked`, so the advance the
 * shaper reports for the whole run is not what ends up on the canvas. Wrapping
 * to `measureText` alone puts the tracked reference line past `block.maxWidth`
 * by `letterSpacing * (n - 1)`.
 */
function textWidth(ctx: Ctx, text: string, spacing: number): number {
  if (spacing <= 0) return ctx.measureText(text).width;
  const characters = Array.from(text);
  let total = spacing * Math.max(0, characters.length - 1);
  for (const char of characters) total += ctx.measureText(char).width;
  return total;
}

/**
 * Greedy word wrap.
 *
 * Devanagari words are separated by spaces like Latin ones, so the same
 * algorithm serves both. A single word wider than the measure is left to
 * overflow rather than broken mid-conjunct, which would be worse.
 */
function wrap(ctx: Ctx, text: string, maxWidth: number, spacing = 0): string[] {
  const paragraphs = text.split('\n');
  const out: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = words[0] as string;
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index] as string;
      const candidate = `${line} ${word}`;
      if (textWidth(ctx, candidate, spacing) <= maxWidth) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Draw a string with manual letter spacing, since `ctx.letterSpacing` is not
 *  available everywhere and the reference line depends on it. */
function drawTracked(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: 'left' | 'center',
): void {
  if (spacing <= 0) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    return;
  }

  const characters = Array.from(text);
  const widths = characters.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (characters.length - 1);

  let cursor = align === 'center' ? x - total / 2 : x;
  ctx.textAlign = 'left';
  characters.forEach((char, index) => {
    ctx.fillText(char, cursor, y);
    cursor += (widths[index] ?? 0) + spacing;
  });
}

/** Cover-fit: fill the frame, crop the overflow, never distort. */
function drawCover(ctx: Ctx, image: CanvasImageSource, width: number, height: number): void {
  const source = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const sourceWidth = source.naturalWidth ?? source.width ?? width;
  const sourceHeight = source.naturalHeight ?? source.height ?? height;
  if (!sourceWidth || !sourceHeight) return;

  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('rgba')) return color;
  const hex = color.replace('#', '');
  const full =
    hex.length === 3
      ? hex.split('').map((c) => c + c).join('')
      : hex;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawScrim(ctx: Ctx, layout: LayoutResult): void {
  const { scrim, width, height } = layout;
  if (scrim.kind === 'none') return;

  if (scrim.kind === 'even') {
    ctx.fillStyle = withAlpha(scrim.color, scrim.stops[0]?.opacity ?? 0.4);
    ctx.fillRect(0, 0, width, height);
  } else {
    const gradient = ctx.createLinearGradient(0, height * scrim.from, 0, height * scrim.to);
    for (const stop of scrim.stops) {
      gradient.addColorStop(stop.at, withAlpha(scrim.color, stop.opacity));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height * scrim.from, width, height * (scrim.to - scrim.from));
  }

  if (scrim.vignette > 0) {
    // Keeps the frame from reading as a flat screenshot. Deliberately subtle:
    // a visible vignette is a filter, and this is not a filter.
    const radius = Math.max(width, height) * 0.75;
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      radius * 0.35,
      width / 2,
      height / 2,
      radius,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${scrim.vignette})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Collect every text line with its font and colour, and total the height. */
function measure(ctx: Ctx, layout: LayoutResult, content: QuoteContent): MeasuredBlock {
  const { type, colors, gap, block } = layout;
  const lines: Line[] = [];
  let height = 0;

  const push = (
    text: string,
    step: { size: number; lineHeight: number; letterSpacing: number },
    face: FaceSpec,
    color: string,
    gapAfterLayer = 0,
  ) => {
    setFont(ctx, step.size, face);

    const letterSpacing = step.letterSpacing * step.size;
    const wrapped = wrap(ctx, text, block.maxWidth, letterSpacing);
    wrapped.forEach((line, index) => {
      // The gap belongs to the last line of the layer, so measuring and
      // drawing advance by exactly the same amount.
      const gapAfter = index === wrapped.length - 1 ? gapAfterLayer : 0;
      lines.push({
        text: line,
        font: fontString(face, step.size),
        size: step.size,
        lineHeight: step.size * step.lineHeight,
        color,
        letterSpacing,
        gapAfter,
      });
      height += step.size * step.lineHeight + gapAfter;
    });
  };

  if (content.sanskrit) {
    push(content.sanskrit, type.sanskrit, FACES.sanskrit, colors.primary, gap.afterSanskrit);
  }
  if (content.transliteration) {
    push(
      content.transliteration,
      type.transliteration,
      FACES.transliteration,
      colors.muted,
      gap.afterTransliteration,
    );
  }
  if (content.translation) {
    push(
      content.translation,
      type.translation,
      FACES.translation,
      colors.secondary,
      gap.afterTranslation,
    );
  }

  // The reference is always present: a card without its citation is exactly
  // the kind of decontextualised scripture this product exists to avoid.
  push(
    content.reference,
    type.reference,
    FACES.reference,
    colors.accent,
    content.caption ? gap.beforeReference * 0.5 : 0,
  );

  if (content.caption) {
    push(content.caption, type.caption, FACES.caption, colors.muted);
  }

  return { lines, height };
}

/** The rule and the gap under it, which sit above the first line of type. */
function ruleSpace(layout: LayoutResult): number {
  return layout.rule ? layout.rule.height + layout.gap.afterTransliteration : 0;
}

interface FittedBlock {
  /** The layout the block was measured with: the given one, or a shrunk copy. */
  layout: LayoutResult;
  measured: MeasuredBlock;
}

/**
 * Shrink the type until the composed block fits the room its anchor leaves it.
 *
 * A four-line shloka with a transliteration and a translation is simply taller
 * than a 1200x630 link card at the top of the scale range, and the honest
 * answer is smaller type rather than a verse cropped at both edges.
 *
 * The result depends on nothing but the layout and the content — not on the
 * canvas size, not on which copy of the photograph is loaded — because the
 * preview and the export have to arrive at the same factor or the download is
 * not the thing that was on screen.
 */
function fitBlock(ctx: Ctx, layout: LayoutResult, content: QuoteContent): FittedBlock {
  const available = blockSpace(layout);
  const measured = measure(ctx, layout, content);
  if (available <= 0 || measured.height + ruleSpace(layout) <= available) {
    return { layout, measured };
  }

  // Walk down from full size and stop at the first factor that fits, so the
  // type only gives away what the overflow costs. Proportion is no shortcut
  // here: smaller type also wraps to fewer lines, so height falls away faster
  // than the factor does and a proportional guess overshoots badly.
  const floor = minFitFactor(layout);
  const rungs = Math.ceil((1 - floor) / FIT_STEP);
  for (let rung = 1; rung < rungs; rung += 1) {
    const candidate = scaleType(layout, 1 - rung * FIT_STEP);
    const candidateMeasured = measure(ctx, candidate, content);
    if (candidateMeasured.height + ruleSpace(candidate) <= available) {
      return { layout: candidate, measured: candidateMeasured };
    }
  }

  // Below the floor the verse stops being readable, which is not a better
  // failure than a block that sits tight against its margin.
  const floored = scaleType(layout, floor);
  return { layout: floored, measured: measure(ctx, floored, content) };
}

export interface RenderOptions {
  layout: LayoutResult;
  content: QuoteContent;
  /** Null renders a plain tinted ground, which is a legitimate choice. */
  image: CanvasImageSource | null;
  /** Used when there is no image. */
  fallbackColor?: string;
}

export function renderQuote(ctx: Ctx, options: RenderOptions): void {
  const { layout, content, image } = options;
  const { width, height, colors, block } = layout;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Ground.
  if (image) {
    drawCover(ctx, image, width, height);
  } else {
    ctx.fillStyle = options.fallbackColor ?? '#241F18';
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Measure before drawing anything that has to wrap around the text, and
  // take the type down if the block will not fit where the anchor puts it.
  // Everything after this point reads its type sizes and gaps from `fitted`.
  const fitted = fitBlock(ctx, layout, content);
  const { measured } = fitted;
  const gap = fitted.layout.gap;

  // 3. Where the block sits.
  let top: number;
  if (block.anchor === 'middle') top = block.anchorY - measured.height / 2;
  else if (block.anchor === 'bottom') top = block.anchorY - measured.height;
  else top = block.anchorY;

  const ruleHeight = ruleSpace(fitted.layout);
  top -= ruleHeight / 2;

  // `fitBlock` has already made the block small enough for its anchor, so this
  // only catches content that overflowed even at the floor. Losing the end of
  // a long verse is recoverable; losing its first line and its last is not.
  const inset = blockInset(layout);
  const lowestTop = Math.max(inset, height - inset - measured.height - ruleHeight);
  top = Math.min(Math.max(top, inset), lowestTop);

  // 4. Scrim, then the panel if this layout uses one.
  drawScrim(ctx, layout);

  if (layout.panel) {
    const padding = panelPadding(layout);
    const panelY = top - padding;
    const panelHeight = measured.height + ruleHeight + padding * 2;

    if (image) {
      // A real frosted panel: the image behind it is redrawn blurred and
      // clipped to the panel, rather than faked with a flat translucent fill.
      ctx.save();
      roundedRect(ctx, layout.panel.x, panelY, layout.panel.width, panelHeight, layout.panel.radius);
      ctx.clip();
      ctx.filter = `blur(${layout.panel.blur}px)`;
      drawCover(ctx, image, width, height);
      ctx.filter = 'none';
      ctx.restore();
    }

    ctx.save();
    roundedRect(ctx, layout.panel.x, panelY, layout.panel.width, panelHeight, layout.panel.radius);
    ctx.fillStyle = layout.panel.fill;
    ctx.fill();
    ctx.strokeStyle = layout.panel.border;
    ctx.lineWidth = Math.max(1, layout.typeBase * 0.0012);
    ctx.stroke();
    ctx.restore();
  }

  // 5. The accent rule, above the verse.
  let cursor = top;
  if (layout.rule) {
    const ruleX = block.align === 'center' ? block.x - layout.rule.width / 2 : block.x;
    ctx.fillStyle = colors.accent;
    ctx.fillRect(ruleX, cursor, layout.rule.width, layout.rule.height);
    cursor += layout.rule.height + gap.afterTransliteration;
  }

  // 6. Type.
  ctx.textBaseline = 'alphabetic';
  for (const line of measured.lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    // `lineHeight - size` splits above and below; adding most of the size puts
    // the baseline where it belongs for a mixed Devanagari/Latin stack.
    const baseline = cursor + line.size * 0.82 + (line.lineHeight - line.size) / 2;
    if (line.letterSpacing > 0) {
      drawTracked(ctx, line.text, block.x, baseline, line.letterSpacing, block.align);
    } else {
      ctx.textAlign = block.align;
      ctx.fillText(line.text, block.x, baseline);
    }
    cursor += line.lineHeight + line.gapAfter;
  }

  // 7. The unverified notice, if the verse has not been checked. It is baked
  // into the image on purpose: a screenshot reshared out of context is exactly
  // when this matters most.
  if (content.unverified) {
    const size = Math.round(layout.typeBase * 0.015);
    setFont(ctx, size, FACES.notice);
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.muted;
    ctx.fillText('Unverified draft', width - layout.margin, layout.margin + size);
  }

  ctx.restore();
}

/** Total height the text block will occupy, for callers that need to fit it.
 *  This is the height after the fit pass, so it is the height that is drawn. */
export function measureBlockHeight(ctx: Ctx, layout: LayoutResult, content: QuoteContent): number {
  return fitBlock(ctx, layout, content).measured.height;
}
