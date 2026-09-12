import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPOSITION,
  FORMAT_SPECS,
  LAYOUTS,
  PRESETS,
  ZONE_LAYOUT,
  clampScale,
  computeLayout,
  decodeComposition,
  encodeComposition,
  resolveTone,
  type QuoteComposition,
} from '@gita/quote-composer';

const sample: QuoteComposition = {
  ref: '18.66',
  wallpaperId: 'dusk-mountains-04',
  layout: 'panel',
  tone: 'light',
  layers: { sanskrit: true, transliteration: true, translation: false },
  translationLanguage: 'hi',
  scale: 1.25,
  accent: 'saffron',
  caption: 'for Amma ~ with love',
  format: 'desktop4k',
};

describe('composition links', () => {
  it('survives a round trip', () => {
    expect(decodeComposition(encodeComposition(sample))).toEqual(sample);
  });

  it('round trips the default too', () => {
    expect(decodeComposition(encodeComposition(DEFAULT_COMPOSITION))).toEqual(DEFAULT_COMPOSITION);
  });

  it('keeps a caption containing the field separator intact', () => {
    // The caption is free text and the scheme is `~`-separated, so this is the
    // case that would corrupt every field after it if the encoding were naive.
    const decoded = decodeComposition(encodeComposition(sample));
    expect(decoded.caption).toBe('for Amma ~ with love');
  });

  it('produces a URL-safe string', () => {
    expect(encodeComposition(sample)).toMatch(/^[A-Za-z0-9._~-]+$/);
  });

  it('falls back to a usable composition for a corrupt code', () => {
    const result = decodeComposition('not-a-real-code');
    expect(result.ref).toBe(DEFAULT_COMPOSITION.ref);
    expect(LAYOUTS).toContain(result.layout);
  });

  it('never decodes to a card with no text layer', () => {
    const blank = encodeComposition({
      ...sample,
      layers: { sanskrit: false, transliteration: false, translation: false },
    });
    const layers = decodeComposition(blank).layers;
    expect(layers.sanskrit || layers.transliteration || layers.translation).toBe(true);
  });

  it('drops a wallpaper id that is not a slug', () => {
    // The value reaches a request path, and a link is untrusted input.
    for (const hostile of ['../../admin', 'a/b', 'Night Mountains', 'x?y=1', '..']) {
      const forged = encodeComposition(sample).replace(
        `w${sample.wallpaperId}`,
        `w${hostile}`,
      );
      expect(decodeComposition(forged).wallpaperId).toBeNull();
    }
  });

  it('keeps a real slug, variant suffix and all', () => {
    for (const slug of ['dawn-arcs', 'night-mountains-3', 'sand-glow-wide', 'ink-plain-wide-2']) {
      expect(decodeComposition(encodeComposition({ ...sample, wallpaperId: slug })).wallpaperId).toBe(
        slug,
      );
    }
  });

  it('carries no verse text, only the reference', () => {
    // A link must not be able to transport an altered shloka.
    expect(encodeComposition(sample)).not.toMatch(/[\u0900-\u097F]/);
  });
});

describe('a link cannot smuggle scripture', () => {
  // The project's first rule: the verse on a card comes from the library, not
  // from whoever made the link. These are the two ways a link could get around
  // that without ever carrying verse text.

  it('rejects a well-formed reference to a verse that does not exist', () => {
    // 2.99 passes a shape check and chapter 2 has 72 verses. Accepting it means
    // the card resolves no verse at all, leaving the caption as the only body
    // text under a "\hagavad Gita 2.99" heading.
    for (const missing of ['2.99', '19.1', '1.48', '18.79', '0.1']) {
      const forged = encodeComposition(sample).replace(`r${sample.ref}`, `r${missing}`);
      expect(decodeComposition(forged).ref).toBe(DEFAULT_COMPOSITION.ref);
    }
  });

  it('accepts every real reference, including the last verse of a chapter', () => {
    for (const real of ['1.1', '1.47', '2.72', '11.55', '18.78']) {
      expect(decodeComposition(encodeComposition({ ...sample, ref: real })).ref).toBe(real);
    }
  });

  it('strips Devanagari from the caption', () => {
    // A caption is set small and apart, but Devanagari in it would still read
    // as the verse to anyone glancing at the card.
    const forged = encodeComposition({
      ...sample,
      caption: 'कर्मण्येवाधिकारस्ते fake',
    });
    const caption = decodeComposition(forged).caption ?? '';
    expect(caption).not.toMatch(/[\U0900-\U097F]/);
    expect(caption).toContain('fake');
  });

  it('collapses a caption to a single line', () => {
    // Eight short lines is a paragraph of body copy; one line is a signature.
    const forged = encodeComposition({ ...sample, caption: 'one\ntwo\nthree\nfour' });
    const caption = decodeComposition(forged).caption ?? '';
    expect(caption).not.toMatch(/[\n\r]/);
    expect(caption).toBe('one two three four');
  });

  it('drops a caption that was nothing but scripture', () => {
    const forged = encodeComposition({ ...sample, caption: 'मा फलेषु कदाचन' });
    expect(decodeComposition(forged).caption).toBeNull();
  });
});

describe('scale', () => {
  it('clamps out-of-range and non-finite input', () => {
    expect(clampScale(99)).toBe(1.4);
    expect(clampScale(0)).toBe(0.75);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe('tone', () => {
  it('respects an explicit choice', () => {
    expect(resolveTone('light', 0.05)).toBe('light');
    expect(resolveTone('dark', 0.95)).toBe('dark');
  });

  it('reads a bright image as needing dark type', () => {
    expect(resolveTone('auto', 0.9)).toBe('light');
  });

  it('assumes dark type over an unmeasured background', () => {
    expect(resolveTone('auto', null)).toBe('dark');
  });
});

describe('layout', () => {
  it('matches the requested output size exactly', () => {
    for (const format of Object.keys(FORMAT_SPECS) as Array<keyof typeof FORMAT_SPECS>) {
      const layout = computeLayout({ ...sample, format });
      expect([layout.width, layout.height]).toEqual([
        FORMAT_SPECS[format].width,
        FORMAT_SPECS[format].height,
      ]);
    }
  });

  it('keeps the text block inside the frame for every layout and format', () => {
    for (const layout of LAYOUTS) {
      for (const format of Object.keys(FORMAT_SPECS) as Array<keyof typeof FORMAT_SPECS>) {
        const result = computeLayout({ ...sample, layout, format, scale: 1.4 });
        // `block.x` is the left edge for a left-aligned block and the centre
        // line for a centred one, so the edges have to be derived per align.
        const { x, maxWidth, align } = result.block;
        const left = align === 'center' ? x - maxWidth / 2 : x;
        expect(maxWidth).toBeGreaterThan(0);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + maxWidth).toBeLessThanOrEqual(result.width + 0.5);
        expect(result.block.anchorY).toBeGreaterThanOrEqual(0);
        expect(result.block.anchorY).toBeLessThanOrEqual(result.height);
      }
    }
  });

  it('keeps the frosted panel inside the frame', () => {
    // Only horizontally: a panel wraps its text, so its top and height are not
    // known until the block has been measured and fitted. They are deliberately
    // absent from `PanelSpec` rather than zero — this assertion used to include
    // them and was passing on 0 + 0 <= height, which tested nothing.
    for (const format of ['story', 'square', 'link', 'desktop4k'] as const) {
      const result = computeLayout({ ...sample, layout: 'panel', format });
      expect(result.panel).not.toBeNull();
      expect(result.panel!.x).toBeGreaterThanOrEqual(0);
      expect(result.panel!.width).toBeGreaterThan(0);
      expect(result.panel!.x + result.panel!.width).toBeLessThanOrEqual(result.width + 0.5);
      // The panel has to be wider than the text it wraps, or it is a box with
      // the verse hanging out of both sides.
      expect(result.panel!.width).toBeGreaterThan(result.block.maxWidth);
    }
  });

  it('scales type with the scale control', () => {
    const small = computeLayout({ ...sample, scale: 0.75 });
    const large = computeLayout({ ...sample, scale: 1.4 });
    expect(large.type.sanskrit.size).toBeGreaterThan(small.type.sanskrit.size);
  });

  it('sizes landscape type off the height, not the width', () => {
    // Typed off its width, a 3840px desktop card would set the verse at nearly
    // three times the size a story card uses. Relative to the frame, landscape
    // type has to be a much smaller fraction of the width.
    const desktop = computeLayout({ ...sample, format: 'desktop4k' });
    const story = computeLayout({ ...sample, format: 'story' });
    expect(desktop.type.sanskrit.size / desktop.width).toBeLessThan(
      (story.type.sanskrit.size / story.width) * 0.6,
    );
    // ...but still large enough to read on a monitor.
    expect(desktop.type.sanskrit.size).toBeGreaterThan(60);
  });

  it('gives Devanagari more leading than the Latin lines', () => {
    // `lineHeight` is a multiplier on `size`, so these compare directly.
    const result = computeLayout(sample);
    expect(result.type.sanskrit.lineHeight).toBeGreaterThan(result.type.translation.lineHeight);
    expect(result.type.sanskrit.lineHeight).toBeGreaterThanOrEqual(1.7);
  });
});

describe('text zone placement', () => {
  // The importer only ever writes one of these four, so a gap here is a
  // wallpaper whose measurement silently does nothing.
  const ZONES = ['top', 'middle', 'bottom', 'any'] as const;

  it('has an answer for every zone the importer can record', () => {
    for (const zone of ZONES) {
      expect(Object.prototype.hasOwnProperty.call(ZONE_LAYOUT, zone)).toBe(true);
    }
  });

  it('anchors the verse in the third the image left quiet', () => {
    const expected = { top: 'top', middle: 'middle', bottom: 'bottom' } as const;
    for (const [zone, anchor] of Object.entries(expected)) {
      const layout = ZONE_LAYOUT[zone];
      expect(layout).toBeDefined();
      expect(computeLayout({ ...sample, layout: layout! }).block.anchor).toBe(anchor);
    }
  });

  it('leaves the layout alone when no third was clearly quieter', () => {
    expect(ZONE_LAYOUT.any).toBeUndefined();
  });
});

describe('presets', () => {
  it('each produces a card with something on it', () => {
    for (const preset of PRESETS) {
      const merged = { ...DEFAULT_COMPOSITION, ...preset.patch };
      const layers = merged.layers;
      expect(layers.sanskrit || layers.transliteration || layers.translation).toBe(true);
      expect(() => computeLayout(merged)).not.toThrow();
    }
  });
});
