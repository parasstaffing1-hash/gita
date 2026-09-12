import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeComposition, encodeComposition, DEFAULT_COMPOSITION } from '@gita/quote-composer';

/**
 * The composer runs in a browser canvas, a Next server render, a Node test
 * runner and a React Native bundle. Only one of those has Node's `Buffer`, so
 * the base64 path has to stand on its own — and the manual table is the branch
 * no environment normally reaches, which is exactly why it needs a test.
 */
describe('caption encoding without platform base64', () => {
  afterEach(() => vi.unstubAllGlobals());

  const sample = { ...DEFAULT_COMPOSITION, ref: '2.13', caption: 'for Amma ~ x' };

  it('round trips using the platform btoa/atob', () => {
    expect(decodeComposition(encodeComposition(sample)).caption).toBe('for Amma ~ x');
  });

  it('round trips with btoa and atob absent', () => {
    vi.stubGlobal('btoa', undefined);
    vi.stubGlobal('atob', undefined);
    expect(decodeComposition(encodeComposition(sample)).caption).toBe('for Amma ~ x');
  });

  it('agrees with the platform implementation byte for byte', () => {
    // Lengths 1, 2 and 0 mod 3 exercise every padding case.
    for (const caption of ['a', 'ab', 'abc', 'abcd', 'for Amma', 'x'.repeat(80)]) {
      const withPlatform = encodeComposition({ ...sample, caption });
      vi.stubGlobal('btoa', undefined);
      vi.stubGlobal('atob', undefined);
      const withFallback = encodeComposition({ ...sample, caption });
      expect(withFallback).toBe(withPlatform);
      expect(decodeComposition(withFallback).caption).toBe(caption);
      vi.unstubAllGlobals();
    }
  });
});
