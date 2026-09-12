/**
 * Canonical hashing.
 *
 * Every canonical text row stores a SHA-256 of its normalised content. The hash
 * is how we detect silent drift: if a stored hash stops matching its text, the
 * row was changed outside the audited revision path and the content-integrity
 * test fails.
 *
 * Normalisation before hashing (must match apps/api/gita_api/utils/hashing.py):
 *   1. Unicode NFC
 *   2. collapse all whitespace runs to a single space
 *   3. trim
 */

export function normalizeForHash(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Hex SHA-256 of the normalised text. Uses Web Crypto (Node 20+, browsers, RN 0.74+). */
export async function canonicalHash(text: string): Promise<string> {
  const normalized = normalizeForHash(text);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyCanonicalHash(text: string, expected: string): Promise<boolean> {
  const actual = await canonicalHash(text);
  return actual === expected.toLowerCase();
}
