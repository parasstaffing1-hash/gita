import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPOSITION,
  encodeComposition,
  type QuoteComposition,
} from '@gita/quote-composer';

import { parseCompositionCode } from '@/lib/composer-data';

const GOOD = 'v1~r2.47~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory';

describe('share codes', () => {
  it('reads a code this build wrote', () => {
    const composition = parseCompositionCode(GOOD);
    expect(composition).not.toBeNull();
    expect(composition?.ref).toBe('2.47');
    expect(composition?.layout).toBe('centered');
    expect(composition?.layers).toEqual({
      sanskrit: true,
      transliteration: true,
      translation: false,
    });
  });

  it('accepts everything the encoder can produce', () => {
    const cases: QuoteComposition[] = [
      DEFAULT_COMPOSITION,
      {
        ...DEFAULT_COMPOSITION,
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
      },
    ];

    for (const composition of cases) {
      expect(parseCompositionCode(encodeComposition(composition))).toEqual(composition);
    }
  });

  // The whole point: without this, every one of these is a cached, indexable
  // page declaring its own canonical.
  it.each([
    ['garbage', 'garbage'],
    ['empty', ''],
    ['a bare word that looks versioned', 'v1'],
    ['a plausible prefix and nothing else', 'v1~r2.47'],
    ['another scheme', 'v2~r2.47~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
    ['no version at all', 'r2.47~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
    ['a verse that does not exist', 'v1~r2.99~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
    ['a layout that does not exist', 'v1~r2.47~w-~lspiral~tauto~yst~gen~z1.00~agold~fstory'],
    ['a format that does not exist', 'v1~r2.47~w-~lcentered~tauto~yst~gen~z1.00~agold~fbillboard'],
    ['a wallpaper id out of the slug space', 'v1~r2.47~w../../etc~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
    ['a missing field', 'v1~r2.47~w-~lcentered~tauto~yst~gen~z1.00~agold'],
    ['a repeated field', 'v1~r2.47~r2.13~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
    ['an unknown field', 'v1~r2.47~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory~q1'],
    ['a caption that sanitises away', `${GOOD}~c${Buffer.from('   ').toString('base64url')}`],
  ])('refuses %s', (_name, code) => {
    expect(parseCompositionCode(code)).toBeNull();
  });

  // Each of these decodes to exactly the same card as GOOD. Honouring them
  // would hand one composition an unbounded set of addresses to be cached and
  // indexed under.
  it.each([
    ['a scale spelled with more decimals', 'v1~r2.47~w-~lcentered~tauto~yst~gen~z1.000~agold~fstory'],
    ['a scale outside the slider', 'v1~r2.47~w-~lcentered~tauto~yst~gen~z9.00~agold~fstory'],
    ['a padded verse number', 'v1~r02.47~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
    ['a spelled-out reference', 'v1~rChapter 2 Verse 47~w-~lcentered~tauto~yst~gen~z1.00~agold~fstory'],
  ])('refuses %s as a second spelling of one card', (_name, code) => {
    expect(parseCompositionCode(code)).toBeNull();
  });

  it('refuses a code longer than the encoder can write', () => {
    expect(parseCompositionCode(`${GOOD}~c${'A'.repeat(600)}`)).toBeNull();
  });

  it('gives a canonical address back for every code it accepts', () => {
    const composition = parseCompositionCode(GOOD);
    expect(composition).not.toBeNull();
    expect(encodeComposition(composition as QuoteComposition)).toBe(GOOD);
  });
});
