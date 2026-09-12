/** Conflict-safe offline sync envelope shared by mobile and web. */

export type SyncEntity =
  | 'bookmarks'
  | 'highlights'
  | 'notes'
  | 'collections'
  | 'collection_items'
  | 'reading_progress'
  | 'memorization_progress'
  | 'preferences'
  | 'plan_progress';

/**
 * One local change. `clientId` is generated on-device (UUID v4) and is the
 * primary key everywhere, so a record created offline keeps its identity after
 * it reaches the server — no id remapping, no duplicate rows.
 */
export interface SyncChange<T = Record<string, unknown>> {
  entity: SyncEntity;
  clientId: string;
  /** Monotonic per-record counter, incremented on every local edit. */
  revision: number;
  updatedAt: string;
  deleted: boolean;
  payload: T;
}

export interface SyncPushRequest {
  deviceId: string;
  /** Server cursor from the last successful pull; omit on first sync. */
  since: string | null;
  changes: SyncChange[];
}

export interface SyncConflict {
  entity: SyncEntity;
  clientId: string;
  reason: 'stale_revision' | 'deleted_remotely' | 'validation_failed';
  /** Authoritative server state so the client can reconcile without a refetch. */
  serverState: SyncChange | null;
}

export interface SyncPullResponse {
  cursor: string;
  changes: SyncChange[];
  hasMore: boolean;
}

export interface SyncPushResponse {
  cursor: string;
  accepted: string[];
  conflicts: SyncConflict[];
  /** Server-side changes the client had not yet seen, applied in the same round trip. */
  changes: SyncChange[];
}

/** Manifest describing the offline content bundle the mobile app downloads. */
export interface ContentBundleManifest {
  version: string;
  generatedAt: string;
  schemaVersion: number;
  chapterCount: number;
  verseCount: number;
  languages: string[];
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  /** True when the bundle contains verified content only. */
  verifiedOnly: boolean;
}
