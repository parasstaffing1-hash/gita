/** Transport-level shapes shared by every endpoint. */

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type VerificationFilter = 'published' | 'verified_or_published' | 'any';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  database: boolean;
  extensions: { vector: boolean; pg_trgm: boolean; unaccent: boolean };
  aiProvider: { name: string; healthy: boolean };
}
