import { ImageResponse } from 'next/og';

import { palette } from '@gita/design-tokens';

/**
 * Share card rendering.
 *
 * One layout, several sizes. `next/og` renders these with Satori, so a card is
 * generated on demand and then cached — no build-time pre-rendering of 700
 * images, and no headless browser.
 *
 * Satori supports a deliberately small subset of CSS: flexbox only, and every
 * text node must sit inside an element with an explicit `display: flex`. The
 * styles below stay inside that subset on purpose.
 */

export const SHARE_SIZES = {
  /** Open Graph / Twitter card, and the WhatsApp link preview. */
  og: { width: 1200, height: 630 },
  /** Instagram feed post. */
  square: { width: 1080, height: 1080 },
  /** Instagram / WhatsApp story. */
  story: { width: 1080, height: 1920 },
} as const;

export type ShareSize = keyof typeof SHARE_SIZES;

export function isShareSize(value: string | null | undefined): value is ShareSize {
  return value === 'og' || value === 'square' || value === 'story';
}

interface VerseCardInput {
  ref: string;
  sanskrit: string | null;
  transliteration: string | null;
  translation: string | null;
  chapterName?: string | null;
  /** Shown when the text has not been through editorial verification. */
  unverified?: boolean;
}

/** Trim to a word boundary so a long translation never overflows the card. */
function fit(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Devanagari needs a real size drop as the line count grows. */
function sanskritSize(text: string | null, base: number): number {
  if (!text) return base;
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((line) => line.length));
  if (lines.length > 2 || longest > 60) return Math.round(base * 0.74);
  if (longest > 44) return Math.round(base * 0.86);
  return base;
}

export function renderVerseCard(
  verse: VerseCardInput,
  size: ShareSize,
  fonts: Array<{ name: string; data: ArrayBuffer; weight?: 400 | 500 | 600; style?: 'normal' }>,
) {
  const { width, height } = SHARE_SIZES[size];
  const isStory = size === 'story';
  const scale = isStory ? 1.35 : size === 'square' ? 1.05 : 1;

  const sanskrit = verse.sanskrit?.split('\n').slice(0, 4).join('\n') ?? null;
  const translation = fit(verse.translation, isStory ? 200 : 165);
  const transliteration = fit(verse.transliteration?.split('\n')[0], 90);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: isStory ? '140px 96px' : '72px 88px',
          // Warm paper with one quiet vertical wash. No other gradient.
          backgroundColor: palette.sand[50],
          backgroundImage: `linear-gradient(180deg, ${palette.sand[50]} 0%, ${palette.sand[100]} 100%)`,
          fontFamily: 'Lora',
          position: 'relative',
        }}
      >
        {/* A hairline rule in gold. The only ornament on the card. */}
        <div
          style={{
            display: 'flex',
            width: 72,
            height: 3,
            backgroundColor: palette.gold[500],
            marginBottom: 40 * scale,
          }}
        />

        {sanskrit ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'NotoSerifDevanagari',
              fontSize: sanskritSize(sanskrit, 46 * scale),
              lineHeight: 1.75,
              color: palette.ink[900],
              marginBottom: 34 * scale,
              whiteSpace: 'pre-wrap',
            }}
          >
            {sanskrit}
          </div>
        ) : null}

        {transliteration ? (
          <div
            style={{
              display: 'flex',
              fontSize: 22 * scale,
              fontStyle: 'italic',
              color: palette.ink[500],
              marginBottom: 28 * scale,
            }}
          >
            {transliteration}
          </div>
        ) : null}

        {translation ? (
          <div
            style={{
              display: 'flex',
              fontSize: 30 * scale,
              lineHeight: 1.55,
              color: palette.ink[700],
              marginBottom: 44 * scale,
            }}
          >
            {translation}
          </div>
        ) : null}

        {/* Reference on the left, restrained branding on the right. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: 32 * scale,
            borderTop: `1px solid ${palette.sand[300]}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 30 * scale,
                fontWeight: 600,
                color: palette.saffron[700],
              }}
            >
              Bhagavad Gita {verse.ref}
            </div>
            {verse.chapterName ? (
              <div
                style={{
                  display: 'flex',
                  fontSize: 20 * scale,
                  color: palette.ink[500],
                  marginTop: 6,
                }}
              >
                {verse.chapterName}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 30 * scale,
                color: palette.gold[500],
                marginRight: 12,
              }}
            >
              ॐ
            </div>
            <div style={{ display: 'flex', fontSize: 24 * scale, color: palette.ink[500] }}>
              Gita
            </div>
          </div>
        </div>

        {/*
          Unverified text has to say so even when the card is screenshotted and
          reshared out of context — which is exactly when the label matters.
        */}
        {verse.unverified ? (
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              top: isStory ? 60 : 28,
              right: isStory ? 60 : 32,
              fontSize: 16 * scale,
              color: palette.state.warning,
            }}
          >
            Unverified draft
          </div>
        ) : null}
      </div>
    ),
    { width, height, fonts },
  );
}

type LoadedFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: 'normal' };

/**
 * Load the font bytes Satori needs.
 *
 * Satori cannot take a CSS font stack — it needs the actual file. These are
 * fetched once per cold start and then held by the platform fetch cache, which
 * is why the card routes set a long revalidate.
 */
export async function loadShareFonts(): Promise<LoadedFont[]> {
  const [lora, devanagari] = await Promise.all([
    fetchGoogleFont('Lora', 500),
    fetchGoogleFont('Noto+Serif+Devanagari', 500),
  ]);

  const fonts: LoadedFont[] = [];
  if (lora) fonts.push({ name: 'Lora', data: lora, weight: 500, style: 'normal' });
  if (devanagari) {
    fonts.push({ name: 'NotoSerifDevanagari', data: devanagari, weight: 500, style: 'normal' });
  }
  return fonts;
}

const FONT_URL_PATTERN = /src:\s*url\(([^)]+)\)/;

async function fetchGoogleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`;
    const css = await fetch(cssUrl, {
      // A desktop UA gets TTF back. Satori cannot read woff2.
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      next: { revalidate: 60 * 60 * 24 * 30 },
    }).then((response) => response.text());

    const match = css.match(FONT_URL_PATTERN);
    if (!match?.[1]) return null;
    return await fetch(match[1], { next: { revalidate: 60 * 60 * 24 * 30 } }).then((response) =>
      response.arrayBuffer(),
    );
  } catch {
    // A font that fails to load must not take the page down. The card falls
    // back to Satori's built-in face, which still renders Latin correctly.
    return null;
  }
}
