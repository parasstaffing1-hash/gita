/**
 * Admin API access.
 *
 * Every call runs on the server. The admin token is read from the server-only
 * environment and never reaches the browser — that is the whole reason these
 * are Server Components and Server Actions rather than client fetches.
 */
import { createApiClient } from '@gita/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** Server-only. Referencing this from a client component is a build error. */
function adminToken(): string {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new Error(
      'ADMIN_API_TOKEN is not set. The admin panel cannot reach the API without it.',
    );
  }
  return token;
}

export function adminApi() {
  return createApiClient({ baseUrl: API_URL, adminToken: adminToken(), timeoutMs: 20_000 });
}

export interface Dashboard {
  chapters: number;
  verses: number;
  translations: number;
  commentaries: number;
  publishedVerses: number;
  draftVerses: number;
  pendingReviews: number;
  flaggedAiAnswers: number;
  recentChanges: number;
}

export interface ChangeLogEntry {
  id: string;
  tableName: string;
  recordId: string;
  recordRef: string | null;
  action: string;
  fieldName: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  editorEmail: string | null;
  reason: string;
  reviewStatus: string;
  createdAt: string;
}

export interface AiAnswerReview {
  id: string;
  answer: string;
  groundingStatus: string;
  rejectedCitations: string[];
  reviewStatus: string;
  userFeedback: number | null;
  modelProvider: string;
  modelName: string;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function getDashboard() {
  return adminApi().request<Dashboard>('/v1/admin/dashboard');
}

export function getChanges(params: { limit?: number; offset?: number; tableName?: string } = {}) {
  return adminApi().request<Paged<ChangeLogEntry>>('/v1/admin/changes', {
    query: { limit: params.limit ?? 50, offset: params.offset ?? 0, table_name: params.tableName },
  });
}

export function getAiAnswers(params: { reviewStatus?: string; limit?: number } = {}) {
  return adminApi().request<Paged<AiAnswerReview>>('/v1/admin/ai-answers', {
    query: { review_status: params.reviewStatus, limit: params.limit ?? 50 },
  });
}

/** A canonical edit. `reason` is mandatory; the API rejects a blank one. */
export function updateContent(
  tableName: string,
  recordId: string,
  fields: Record<string, unknown>,
  reason: string,
) {
  return adminApi().request<ChangeLogEntry[]>(`/v1/admin/content/${tableName}/${recordId}`, {
    method: 'PATCH',
    body: { fields, reason },
  });
}

export function setVerificationStatus(
  tableName: string,
  recordId: string,
  verificationStatus: string,
  reason: string,
) {
  return adminApi().request<ChangeLogEntry>(
    `/v1/admin/content/${tableName}/${recordId}/status`,
    { method: 'POST', body: { verificationStatus, reason } },
  );
}

export function rollbackChange(changeId: string, reason: string) {
  return adminApi().request<ChangeLogEntry>(`/v1/admin/changes/${changeId}/rollback`, {
    method: 'POST',
    body: { reason },
  });
}

export function reviewAiAnswer(answerId: string, reviewStatus: string, note: string | null) {
  return adminApi().request<AiAnswerReview>(`/v1/admin/ai-answers/${answerId}/review`, {
    method: 'POST',
    body: { reviewStatus, note },
  });
}

export interface WallpaperAdmin {
  id: string;
  slug: string;
  title: string | null;
  orientation: string;
  textZone: string;
  luminance: number | null;
  moods: string[];
  thumbUrl: string | null;
  verificationStatus: string;
  isActive: boolean;
  useCount: number;
  licenceCode: string | null;
  attribution: string | null;
  photographer: string | null;
}

export function getWallpapers(
  params: { verificationStatus?: string; orientation?: string; limit?: number; offset?: number } = {},
) {
  return adminApi().request<Paged<WallpaperAdmin>>('/v1/admin/wallpapers', {
    query: {
      verification_status: params.verificationStatus,
      orientation: params.orientation,
      limit: params.limit ?? 60,
      offset: params.offset ?? 0,
    },
  });
}

/**
 * Review a batch under one reason.
 *
 * A library arrives a thousand images at a time under a single licence, so the
 * bulk route is the normal path here rather than an escape hatch. Each row
 * still gets its own audit entry, and the API refuses the whole batch if any
 * image lacks a licence.
 */
export function setWallpaperStatusBulk(
  ids: string[],
  verificationStatus: string,
  reason: string,
) {
  return adminApi().request<WallpaperAdmin[]>('/v1/admin/wallpapers/status', {
    method: 'POST',
    body: { ids, verificationStatus, reason },
  });
}

export function setWallpaperActive(wallpaperId: string, isActive: boolean, reason: string) {
  return adminApi().request<WallpaperAdmin>(`/v1/admin/wallpapers/${wallpaperId}/active`, {
    method: 'POST',
    body: { isActive, reason },
  });
}
