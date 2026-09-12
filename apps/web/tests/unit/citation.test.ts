import { describe, expect, it } from 'vitest';
import { citationRef } from '@/components/quote-maker';

/**
 * Some editions read several verses as one passage — 1.32 through 1.35 is a
 * single unit. A card carrying that text and citing "1.32" credits four
 * verses' worth of scripture to the first of them, which for this product is
 * a correctness bug, not a formatting one.
 */
describe('how a card cites its verse', () => {
  it('cites a single verse plainly', () => {
    expect(citationRef('2.47', null)).toBe('2.47');
    expect(citationRef('2.47', undefined as unknown as null)).toBe('2.47');
  });

  it('cites a merged record as the range it covers', () => {
    expect(citationRef('1.32', 35)).toBe('1.32\u201335');
    expect(citationRef('1.16', 18)).toBe('1.16\u201318');
  });

  it('uses an en dash rather than a hyphen', () => {
    expect(citationRef('1.32', 35)).not.toContain('-');
  });

  it('ignores an end that is not after the start', () => {
    // Defensive: a record whose end equals or precedes its start is bad data,
    // and "1.32-32" or "1.32-30" would be worse than citing the verse alone.
    expect(citationRef('1.32', 32)).toBe('1.32');
    expect(citationRef('1.32', 30)).toBe('1.32');
  });

  it('leaves a malformed ref alone', () => {
    expect(citationRef('nonsense', 35)).toBe('nonsense');
  });
});
