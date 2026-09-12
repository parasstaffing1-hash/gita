/**
 * Runtime validation shared by web, admin and mobile.
 *
 * The API is the source of truth for its own validation (Pydantic). These
 * schemas guard the *client* boundary: form input before it is sent, and
 * untrusted payloads (deep links, cached SQLite rows, share URLs) before they
 * are trusted by the UI.
 */
import { z } from 'zod';

export const verificationStatusSchema = z.enum(['draft', 'review', 'verified', 'published']);
export const contentOriginSchema = z.enum(['canonical', 'curated', 'ai_generated']);

export const chapterNumberSchema = z.number().int().min(1).max(18);
export const verseNumberSchema = z.number().int().min(1).max(78);

export const verseRefStringSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}\.\d{1,3}(-\d{1,3})?$/, 'Expected a reference like "2.47" or "1.32-35"');

/** Free-text user input that will be sent to the server. */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1, 'Enter something to search for')
  .max(200, 'That query is too long');

export const askQuestionSchema = z
  .string()
  .trim()
  .min(3, 'Please ask a fuller question')
  .max(1000, 'Please shorten your question');

export const askModeSchema = z.enum([
  'default',
  'simple',
  'deep',
  'beginner',
  'sources_only',
  'compare_interpretations',
]);

export const askRequestSchema = z.object({
  question: askQuestionSchema,
  mode: askModeSchema.optional(),
  language: z.string().max(10).optional(),
  verseRef: verseRefStringSchema.nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
});

// --- User content ---------------------------------------------------------

export const noteBodySchema = z
  .string()
  .trim()
  .min(1, 'A note needs some text')
  .max(10000, 'Notes are limited to 10,000 characters');

export const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[\p{L}\p{N} _-]+$/u, 'Tags may contain letters, numbers, spaces, - and _');

export const noteInputSchema = z.object({
  verseId: z.string().uuid().nullable(),
  body: noteBodySchema,
  tags: z.array(tagSchema).max(20).default([]),
  isPrivate: z.boolean().default(true),
});

export const highlightColorSchema = z.enum(['saffron', 'gold', 'sage', 'sky', 'rose']);

export const highlightInputSchema = z.object({
  verseId: z.string().uuid(),
  target: z.enum(['sanskrit', 'transliteration', 'translation', 'commentary']),
  startOffset: z.number().int().min(0).nullable().default(null),
  endOffset: z.number().int().min(0).nullable().default(null),
  color: highlightColorSchema.default('saffron'),
});

export const collectionInputSchema = z.object({
  name: z.string().trim().min(1, 'Name your collection').max(80),
  description: z.string().trim().max(500).nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
});

// --- Reader preferences ---------------------------------------------------

export const readerPreferencesSchema = z.object({
  layout: z.enum([
    'sanskrit_only',
    'sanskrit_hindi',
    'sanskrit_english',
    'sanskrit_transliteration',
    'translation_focus',
    'commentary_focus',
  ]),
  theme: z.enum(['light', 'dark', 'sepia', 'system']),
  fontScale: z.number().min(0.85).max(2.0),
  lineHeight: z.number().min(1.2).max(2.4),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  showWordMeanings: z.boolean(),
  showCommentary: z.boolean(),
  translationLanguage: z.string().min(2).max(10),
  preferredTranslatorId: z.string().uuid().nullable(),
  preferredCommentatorId: z.string().uuid().nullable(),
  transliterationScheme: z.enum(['iast', 'itrans', 'hk']),
  reduceMotion: z.boolean(),
});

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationPreferencesSchema = z.object({
  morningVerseEnabled: z.boolean(),
  morningVerseTime: z.string().regex(TIME_OF_DAY),
  eveningReflectionEnabled: z.boolean(),
  eveningReflectionTime: z.string().regex(TIME_OF_DAY),
  readingPlanReminderEnabled: z.boolean(),
  readingPlanReminderTime: z.string().regex(TIME_OF_DAY),
  customReminderEnabled: z.boolean(),
  customReminderTime: z.string().regex(TIME_OF_DAY).nullable(),
  timezone: z.string().min(1).max(64),
});

// --- Sync -----------------------------------------------------------------

export const syncEntitySchema = z.enum([
  'bookmarks',
  'highlights',
  'notes',
  'collections',
  'collection_items',
  'reading_progress',
  'memorization_progress',
  'preferences',
  'plan_progress',
]);

export const syncChangeSchema = z.object({
  entity: syncEntitySchema,
  clientId: z.string().uuid(),
  revision: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  deleted: z.boolean(),
  payload: z.record(z.unknown()),
});

export const syncPushRequestSchema = z.object({
  deviceId: z.string().uuid(),
  since: z.string().nullable(),
  changes: z.array(syncChangeSchema).max(500),
});

// --- Helpers --------------------------------------------------------------

const HTML_TAG = /<[^>]*>/g;

/** C0/C1 control characters, except tab and newline which are legal in notes. */
function isControlChar(code: number): boolean {
  if (code === 9 || code === 10) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Strip anything that could execute if a user-authored string is ever rendered
 * as HTML. Notes render as plain text everywhere; this is defence in depth for
 * share cards and admin views.
 */
export function sanitizeUserText(input: string): string {
  let out = '';
  for (const ch of input.replace(HTML_TAG, '')) {
    if (!isControlChar(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out.trim();
}

export type ReaderPreferencesInput = z.infer<typeof readerPreferencesSchema>;
export type NoteInput = z.infer<typeof noteInputSchema>;
export type HighlightInput = z.infer<typeof highlightInputSchema>;
export type CollectionInput = z.infer<typeof collectionInputSchema>;
export type AskRequestInput = z.infer<typeof askRequestSchema>;
