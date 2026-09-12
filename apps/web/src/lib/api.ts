/**
 * Server-side API access.
 *
 * Every canonical page fetches through this module inside a Server Component,
 * so the HTML the crawler receives already contains the verse. Nothing
 * important is behind client-side JavaScript.
 */
import { createApiClient, ApiError } from '@gita/api-client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const api = createApiClient({
  baseUrl: API_URL,
  timeoutMs: 15_000,
  // Read without the NEXT_PUBLIC_ prefix on purpose: it must never be inlined
  // into a client bundle. A build prerenders every verse page from one address,
  // which is indistinguishable from abuse unless the renderer says who it is.
  internalToken: process.env.INTERNAL_API_TOKEN,
});

export { ApiError };

/**
 * Run a fetch that may legitimately fail at build time.
 *
 * Static generation happens before the API necessarily exists (a cold CI box, a
 * first deploy). Rather than failing the build, those pages fall back to
 * on-demand rendering and pick the content up on the first request.
 */
export async function tryFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[gita] API unavailable, using fallback: ${message}`);
    }
    return fallback;
  }
}

/**
 * Null when the server says the record does not exist, so a page can call
 * `notFound()`.
 *
 * A network failure is deliberately *not* treated as a 404. Returning null
 * there would make the page render a not-found, which Next then caches for the
 * whole `revalidate` window — so a few seconds of API downtime would leave real
 * verse pages 404ing to readers and crawlers for an hour. Letting the error
 * propagate produces an error response instead, which is not cached and is
 * retried on the next request.
 */
export async function fetchOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
