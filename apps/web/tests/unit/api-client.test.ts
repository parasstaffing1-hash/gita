/**
 * Failure handling in the server-side data layer.
 *
 * Regression cover for a bug that only showed up when the API restarted mid
 * session: `fetchOrNull` treated a network failure as a 404, the page called
 * `notFound()`, and Next cached that 404 for the whole revalidate window. A few
 * seconds of API downtime left real verse pages 404ing to readers and crawlers
 * for an hour.
 */
import { describe, expect, it, vi } from 'vitest';

import { ApiError, GitaApiClient } from '@gita/api-client';

import { fetchOrNull, tryFetch } from '@/lib/api';

describe('fetchOrNull', () => {
  it('returns null when the server says the record does not exist', async () => {
    const result = await fetchOrNull(async () => {
      throw new ApiError(404, 'http_error', 'Verse not found');
    });
    expect(result).toBeNull();
  });

  it('rethrows a network failure instead of reporting it as not-found', async () => {
    // "I could not reach the server" is not "this does not exist". Returning
    // null here is what poisoned the cache.
    const offline = new ApiError(0, 'network_error', 'Could not reach the server.');
    expect(offline.isOffline).toBe(true);

    await expect(
      fetchOrNull(async () => {
        throw offline;
      }),
    ).rejects.toThrow('Could not reach the server.');
  });

  it.each([500, 502, 503, 429])('rethrows a %i so the page does not render as missing', async (status) => {
    await expect(
      fetchOrNull(async () => {
        throw new ApiError(status, 'http_error', 'upstream problem');
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('passes a successful value straight through', async () => {
    await expect(fetchOrNull(async () => ({ ref: '2.47' }))).resolves.toEqual({ ref: '2.47' });
  });
});

describe('tryFetch', () => {
  it('falls back when the API is unreachable', async () => {
    // Used for optional page furniture — a missing daily verse must not take
    // the home page down.
    const result = await tryFetch(async () => {
      throw new ApiError(0, 'network_error', 'offline');
    }, []);
    expect(result).toEqual([]);
  });

  it('prefers the real value when the call succeeds', async () => {
    await expect(tryFetch(async () => ['a'], [])).resolves.toEqual(['a']);
  });
});

describe('ApiError', () => {
  it('classifies retryable failures', () => {
    expect(new ApiError(0, 'network_error', '').isRetryable).toBe(true);
    expect(new ApiError(429, 'rate_limited', '').isRetryable).toBe(true);
    expect(new ApiError(503, 'http_error', '').isRetryable).toBe(true);
    // A 404 will not become a 200 by asking again.
    expect(new ApiError(404, 'http_error', '').isRetryable).toBe(false);
    expect(new ApiError(422, 'validation_error', '').isRetryable).toBe(false);
  });
});

describe('GitaApiClient', () => {
  it('turns a transport failure into an offline ApiError, not a raw throw', async () => {
    const client = new GitaApiClient({
      baseUrl: 'http://example.invalid',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    });

    await expect(client.listChapters()).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'network_error',
    });
  });

  it('surfaces the API error envelope', async () => {
    const client = new GitaApiClient({
      baseUrl: 'http://example.invalid',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'http_error', message: 'Chapter not found' } }), {
          status: 404,
        }),
      ),
    });

    await expect(client.getChapter(19)).rejects.toMatchObject({
      status: 404,
      message: 'Chapter not found',
    });
  });

  it('sends the admin token only when one is configured', async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('[]', { status: 200 }));

    await new GitaApiClient({ baseUrl: 'http://x', fetchImpl }).listChapters();
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty('X-Admin-Token');

    fetchImpl.mockClear();
    await new GitaApiClient({ baseUrl: 'http://x', adminToken: 'secret', fetchImpl }).listChapters();
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      'X-Admin-Token': 'secret',
    });
  });
});
