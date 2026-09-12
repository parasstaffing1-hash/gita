/**
 * Content ingestion schema.
 *
 * This is the file format that `services/ingestion` accepts and that the admin
 * export produces. It is deliberately explicit about provenance: a record
 * without a source and a license cannot be ingested as canonical.
 */
import { z } from 'zod';

export const CONTENT_SCHEMA_VERSION = 1;

export const licenseSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  url: z.string().url().nullable().default(null),
  redistributable: z.boolean(),
  requiresAttribution: z.boolean().default(true),
  commercialUseAllowed: z.boolean().default(false),
  notes: z.string().max(2000).nullable().default(null),
});

export const sourceSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Source keys are lowercase slugs'),
  name: z.string().min(1).max(300),
  sourceUrl: z.string().url().nullable().default(null),
  author: z.string().max(300).nullable().default(null),
  publication: z.string().max(300).nullable().default(null),
  publicationYear: z.number().int().min(1).max(2200).nullable().default(null),
  licenseCode: z.string().min(1).max(64),
  copyrightStatus: z
    .enum(['public_domain', 'licensed', 'permission_granted', 'proprietary', 'unknown'])
    .default('unknown'),
  dateAccessed: z.string().nullable().default(null),
  reviewer: z.string().max(200).nullable().default(null),
  verificationNotes: z.string().max(4000).nullable().default(null),
});

const verificationStatus = z.enum(['draft', 'review', 'verified', 'published']);
const verseRefPattern = /^\d{1,2}\.\d{1,3}$/;

export const chapterRecordSchema = z.object({
  number: z.number().int().min(1).max(18),
  nameSanskrit: z.string().max(300).nullable().default(null),
  nameTransliteration: z.string().max(300).nullable().default(null),
  nameEnglish: z.string().min(1).max(300),
  nameHindi: z.string().max(300).nullable().default(null),
  verseCount: z.number().int().min(1).max(200),
  summary: z.string().max(8000).nullable().default(null),
  summaryHindi: z.string().max(8000).nullable().default(null),
  majorTeachings: z.array(z.string().max(500)).default([]),
  keyConcepts: z.array(z.string().max(200)).default([]),
  keyVerses: z.array(z.string().regex(verseRefPattern)).default([]),
  sourceKey: z.string().min(1),
  verificationStatus: verificationStatus.default('draft'),
});

export const verseTextSchema = z.object({
  script: z.enum(['devanagari', 'iast', 'itrans', 'hk']),
  text: z.string().min(1).max(4000),
  sourceKey: z.string().min(1),
  isPrimary: z.boolean().default(false),
  verificationStatus: verificationStatus.default('draft'),
});

export const translationRecordSchema = z.object({
  languageCode: z.string().min(2).max(10),
  text: z.string().min(1).max(8000),
  translatorName: z.string().max(300).nullable().default(null),
  style: z.enum(['literal', 'poetic', 'simple', 'explanatory']).nullable().default(null),
  sourceKey: z.string().min(1),
  // Hinglish and simplified explanations are `curated`, never `canonical`.
  origin: z.enum(['canonical', 'curated']).default('canonical'),
  verificationStatus: verificationStatus.default('draft'),
});

export const commentaryRecordSchema = z.object({
  commentatorSlug: z.string().min(1).max(80),
  languageCode: z.string().min(2).max(10),
  text: z.string().min(1).max(60000),
  sourceKey: z.string().min(1),
  origin: z.enum(['canonical', 'curated']).default('canonical'),
  verificationStatus: verificationStatus.default('draft'),
});

export const verseWordSchema = z.object({
  position: z.number().int().min(1),
  wordDevanagari: z.string().min(1).max(200),
  wordTransliteration: z.string().max(200).nullable().default(null),
  meaningEnglish: z.string().max(500).nullable().default(null),
  meaningHindi: z.string().max(500).nullable().default(null),
  grammarNote: z.string().max(500).nullable().default(null),
  sanskritTermSlug: z.string().max(120).nullable().default(null),
});

export const verseRecordSchema = z.object({
  chapter: z.number().int().min(1).max(18),
  verse: z.number().int().min(1).max(200),
  verseEnd: z.number().int().min(1).max(200).nullable().default(null),
  speaker: z.string().max(120).nullable().default(null),
  texts: z.array(verseTextSchema).min(1),
  translations: z.array(translationRecordSchema).default([]),
  commentaries: z.array(commentaryRecordSchema).default([]),
  words: z.array(verseWordSchema).default([]),
  verificationStatus: verificationStatus.default('draft'),
});

export const commentatorRecordSchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(300),
  nameSanskrit: z.string().max(300).nullable().default(null),
  tradition: z.string().max(200).nullable().default(null),
  period: z.string().max(120).nullable().default(null),
  bio: z.string().max(4000).nullable().default(null),
});

export const glossaryRecordSchema = z.object({
  slug: z.string().min(1).max(120),
  termSanskrit: z.string().min(1).max(200),
  termTransliteration: z.string().min(1).max(200),
  termEnglish: z.string().max(200).nullable().default(null),
  simpleDefinition: z.string().min(1).max(1000),
  detailedDefinition: z.string().max(20000).nullable().default(null),
  variants: z.array(z.string().max(120)).default([]),
  synonyms: z.array(z.string().max(120)).default([]),
  relatedTermSlugs: z.array(z.string().max(120)).default([]),
  relatedVerses: z.array(z.string().regex(verseRefPattern)).default([]),
  sourceKeys: z.array(z.string()).default([]),
  verificationStatus: verificationStatus.default('draft'),
});

export const topicRecordSchema = z.object({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  nameHindi: z.string().max(200).nullable().default(null),
  category: z.enum(['emotion', 'life', 'practice', 'concept']),
  icon: z.string().max(60).nullable().default(null),
  shortDescription: z.string().max(400).nullable().default(null),
  introduction: z.string().max(20000).nullable().default(null),
  introductionHindi: z.string().max(20000).nullable().default(null),
  relatedConcepts: z.array(z.string().max(120)).default([]),
  relatedTopicSlugs: z.array(z.string().max(120)).default([]),
  // Curated mappings only. Topic pages never compute their verse list at runtime.
  verses: z
    .array(
      z.object({
        ref: z.string().regex(verseRefPattern),
        relevance: z.number().min(0).max(1).default(0.8),
        note: z.string().max(1000).nullable().default(null),
      }),
    )
    .default([]),
  sourceKey: z.string().min(1),
  verificationStatus: verificationStatus.default('draft'),
});

export const relatedVerseRecordSchema = z.object({
  fromRef: z.string().regex(verseRefPattern),
  toRef: z.string().regex(verseRefPattern),
  relationType: z.enum(['thematic', 'continuation', 'contrast', 'reference', 'parallel']),
  note: z.string().max(1000).nullable().default(null),
  bidirectional: z.boolean().default(true),
});

export const readingPlanRecordSchema = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  titleHindi: z.string().max(200).nullable().default(null),
  subtitle: z.string().max(300).nullable().default(null),
  description: z.string().max(8000).nullable().default(null),
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  tags: z.array(z.string().max(60)).default([]),
  days: z
    .array(
      z.object({
        dayNumber: z.number().int().min(1).max(400),
        title: z.string().min(1).max(200),
        intro: z.string().max(4000).nullable().default(null),
        verseRefs: z.array(z.string().regex(verseRefPattern)).default([]),
        reflection: z.string().max(4000).nullable().default(null),
        estimatedMinutes: z.number().int().min(1).max(240).default(10),
      }),
    )
    .min(1),
  verificationStatus: verificationStatus.default('draft'),
});

export const audioRecordSchema = z.object({
  kind: z.enum(['verse', 'chapter', 'reflection', 'intro']),
  chapter: z.number().int().min(1).max(18).nullable().default(null),
  verse: z.number().int().min(1).max(200).nullable().default(null),
  languageCode: z.string().min(2).max(10).default('sa'),
  reciter: z.string().max(200).nullable().default(null),
  // Must be explicit. Synthetic audio is never presented as canonical chanting.
  isSynthetic: z.boolean(),
  objectKey: z.string().min(1).max(500),
  mimeType: z.string().default('audio/mpeg'),
  durationSeconds: z.number().int().min(0).nullable().default(null),
  sizeBytes: z.number().int().min(0).nullable().default(null),
  licenseCode: z.string().min(1),
  verificationStatus: verificationStatus.default('draft'),
});

/** Top-level ingestion file. Every import is one of these. */
export const contentBundleSchema = z.object({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  bundleName: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  /**
   * Set false for anything not yet checked against a printed/authoritative
   * edition. Development placeholders MUST be false. The importer refuses to
   * mark records verified or published from a bundle where this is false.
   */
  authoritative: z.boolean(),
  generatedAt: z.string().nullable().default(null),
  licenses: z.array(licenseSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  commentators: z.array(commentatorRecordSchema).default([]),
  chapters: z.array(chapterRecordSchema).default([]),
  verses: z.array(verseRecordSchema).default([]),
  glossary: z.array(glossaryRecordSchema).default([]),
  topics: z.array(topicRecordSchema).default([]),
  relatedVerses: z.array(relatedVerseRecordSchema).default([]),
  readingPlans: z.array(readingPlanRecordSchema).default([]),
  audio: z.array(audioRecordSchema).default([]),
});

export type ContentBundle = z.infer<typeof contentBundleSchema>;
export type VerseRecord = z.infer<typeof verseRecordSchema>;
export type ChapterRecord = z.infer<typeof chapterRecordSchema>;
export type TopicRecord = z.infer<typeof topicRecordSchema>;
export type GlossaryRecord = z.infer<typeof glossaryRecordSchema>;
export type ReadingPlanRecord = z.infer<typeof readingPlanRecordSchema>;
export type SourceRecord = z.infer<typeof sourceSchema>;
export type AudioRecord = z.infer<typeof audioRecordSchema>;
