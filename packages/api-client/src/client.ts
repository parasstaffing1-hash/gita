/**
 * Typed API client.
 *
 * One client for web, admin and mobile. It is a thin fetch wrapper on purpose:
 * caching belongs to TanStack Query on the client and to Next.js on the server,
 * not to a bespoke layer here.
 */
import type {
  ApiErrorBody,
  AskRequest,
  AskResponse,
  Chapter,
  ContentBundleManifest,
  DailyVerse,
  GlossaryTerm,
  HealthResponse,
  Paginated,
  ReadingPlan,
  ReadingPlanSummary,
  SearchResponse,
  Topic,
  TopicSummary,
  Verse,
  VerseSummary,
} from '@gita/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when retrying the same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Bearer token for signed-in users. Read lazily so refreshes are picked up. */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Static token used by the admin panel and ingestion scripts. */
  adminToken?: string;
  /**
   * Marks the caller as this deployment's own renderer rather than a browser.
   * Server-only: it lifts the per-caller request ceiling, which a page render
   * would otherwise blow through - one build prerenders seven hundred verses
   * from a single address. Never give this to client-side code.
   */
  internalToken?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Next.js fetch cache hints; ignored elsewhere. */
  next?: { revalidate?: number | false; tags?: string[] };
  timeoutMs?: number;
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export class GitaApiClient {
  private readonly options: ApiClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.options.defaultHeaders,
    };
    const token = await this.options.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.options.adminToken) headers['X-Admin-Token'] = this.options.adminToken;
    if (this.options.internalToken) headers['X-Internal-Token'] = this.options.internalToken;
    return headers;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}${path}${buildQuery(options.query)}`;
    const headers = await this.headers();
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 20_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        // `next` is a Next.js extension; harmless in other runtimes.
        ...(options.next ? { next: options.next } : {}),
      } as RequestInit);
    } catch (cause) {
      // Network failure or timeout. Status 0 lets callers fall back to cache.
      throw new ApiError(
        0,
        'network_error',
        cause instanceof Error && cause.name === 'AbortError'
          ? 'The request timed out.'
          : 'Could not reach the server.',
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const body = payload as ApiErrorBody | null;
      throw new ApiError(
        response.status,
        body?.error?.code ?? 'http_error',
        body?.error?.message ?? `Request failed with status ${response.status}`,
        body?.error?.details,
      );
    }
    return payload as T;
  }

  // --- Health -------------------------------------------------------------

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  // --- Canonical content --------------------------------------------------

  listChapters(): Promise<Chapter[]> {
    return this.request<Chapter[]>('/v1/chapters', { next: { revalidate: 3600, tags: ['chapters'] } });
  }

  getChapter(number: number): Promise<Chapter> {
    return this.request<Chapter>(`/v1/chapters/${number}`, {
      next: { revalidate: 3600, tags: ['chapters', `chapter-${number}`] },
    });
  }

  listChapterVerses(
    number: number,
    params: { limit?: number; offset?: number; language?: string } = {},
  ): Promise<Paginated<VerseSummary>> {
    return this.request<Paginated<VerseSummary>>(`/v1/chapters/${number}/verses`, {
      query: params,
      next: { revalidate: 3600, tags: [`chapter-${number}`] },
    });
  }

  getVerse(chapter: number, verse: number, params: { language?: string } = {}): Promise<Verse> {
    return this.request<Verse>(`/v1/verses/${chapter}/${verse}`, {
      query: params,
      next: { revalidate: 3600, tags: [`verse-${chapter}-${verse}`] },
    });
  }

  // --- Discovery ----------------------------------------------------------

  listTopics(category?: string): Promise<TopicSummary[]> {
    return this.request<TopicSummary[]>('/v1/topics', {
      query: { category },
      next: { revalidate: 3600, tags: ['topics'] },
    });
  }

  getTopic(slug: string): Promise<Topic> {
    return this.request<Topic>(`/v1/topics/${slug}`, {
      next: { revalidate: 3600, tags: ['topics', `topic-${slug}`] },
    });
  }

  listGlossary(): Promise<GlossaryTerm[]> {
    return this.request<GlossaryTerm[]>('/v1/glossary', {
      next: { revalidate: 3600, tags: ['glossary'] },
    });
  }

  getGlossaryTerm(slug: string): Promise<GlossaryTerm> {
    return this.request<GlossaryTerm>(`/v1/glossary/${slug}`, {
      next: { revalidate: 3600, tags: ['glossary', `glossary-${slug}`] },
    });
  }

  search(
    query: string,
    params: { limit?: number; language?: string; semantic?: boolean } = {},
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>('/v1/search', { query: { q: query, ...params } });
  }

  // --- Ask the Gita -------------------------------------------------------

  ask(payload: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
    return this.request<AskResponse>('/v1/ask', {
      method: 'POST',
      body: payload,
      signal,
      timeoutMs: 90_000,
    });
  }

  // --- Daily + plans ------------------------------------------------------

  dailyVerse(date?: string): Promise<DailyVerse> {
    return this.request<DailyVerse>('/v1/daily-verse', { query: { date } });
  }

  listReadingPlans(): Promise<ReadingPlanSummary[]> {
    return this.request<ReadingPlanSummary[]>('/v1/reading-plans', {
      next: { revalidate: 3600, tags: ['plans'] },
    });
  }

  getReadingPlan(slug: string): Promise<ReadingPlan> {
    return this.request<ReadingPlan>(`/v1/reading-plans/${slug}`, {
      next: { revalidate: 3600, tags: ['plans', `plan-${slug}`] },
    });
  }

  // --- Offline bundle -----------------------------------------------------

  contentManifest(): Promise<ContentBundleManifest> {
    return this.request<ContentBundleManifest>('/v1/content/manifest');
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function createApiClient(options: ApiClientOptions): GitaApiClient {
  return new GitaApiClient(options);
}
