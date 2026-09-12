/**
 * Canonical (verified scripture) domain types.
 *
 * These mirror the API contract exactly. Canonical content is READ-ONLY for
 * every client and for the AI service — it is authored and reviewed in the
 * admin panel and never produced by a model.
 */

/** Lifecycle of any canonical content record. */
export type VerificationStatus = 'draft' | 'review' | 'verified' | 'published';

/** How a piece of content came to exist. Canonical content is never `ai_generated`. */
export type ContentOrigin = 'canonical' | 'curated' | 'ai_generated';

/** Script/notation a text is written in. */
export type TextScript =
  | 'devanagari'
  | 'iast'
  | 'itrans'
  | 'hk'
  | 'latin'
  | 'bengali'
  | 'gurmukhi'
  | 'gujarati'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam'
  | 'odia';

export interface Language {
  /** BCP-47-ish code: en, hi, sa, hi-Latn (Hinglish), bn, mr ... */
  code: string;
  name: string;
  nativeName: string;
  script: TextScript;
  isUiLanguage: boolean;
  isContentLanguage: boolean;
  direction: 'ltr' | 'rtl';
}

export interface ContentLicense {
  id: string;
  code: string;
  name: string;
  url: string | null;
  /** True when the text may be redistributed inside the app/website. */
  redistributable: boolean;
  requiresAttribution: boolean;
  commercialUseAllowed: boolean;
  notes: string | null;
}

export interface ContentSource {
  id: string;
  name: string;
  sourceUrl: string | null;
  author: string | null;
  publication: string | null;
  publicationYear: number | null;
  license: ContentLicense | null;
  copyrightStatus: string | null;
  dateAccessed: string | null;
  reviewer: string | null;
  verificationNotes: string | null;
}

export interface Chapter {
  id: string;
  number: number;
  slug: string;
  /** Devanagari chapter title, e.g. अर्जुनविषादयोग */
  nameSanskrit: string | null;
  nameTransliteration: string | null;
  nameEnglish: string;
  nameHindi: string | null;
  verseCount: number;
  summary: string | null;
  summaryHindi: string | null;
  majorTeachings: string[];
  keyConcepts: string[];
  keyVerses: VerseRef[];
  audioTrackId: string | null;
  verificationStatus: VerificationStatus;
}

/** A stable, human-meaningful pointer to a verse: "2.47". */
export interface VerseRef {
  chapter: number;
  verse: number;
  /** For merged verses such as 1.32-35 the API returns `verseEnd`. */
  verseEnd?: number | null;
}

export interface VerseTextVersion {
  id: string;
  script: TextScript;
  text: string;
  /** SHA-256 over normalised text; changes only via an audited revision. */
  canonicalHash: string;
  source: ContentSource | null;
  version: number;
  verificationStatus: VerificationStatus;
  isPrimary: boolean;
}

export interface Translation {
  id: string;
  languageCode: string;
  text: string;
  translatorName: string | null;
  /** e.g. "literal", "poetic", "simple" — lets the reader pick a register. */
  style: string | null;
  source: ContentSource | null;
  version: number;
  verificationStatus: VerificationStatus;
  origin: ContentOrigin;
}

export interface Transliteration {
  id: string;
  scheme: TextScript;
  text: string;
  source: ContentSource | null;
  version: number;
  verificationStatus: VerificationStatus;
}

export interface Commentator {
  id: string;
  slug: string;
  name: string;
  nameSanskrit: string | null;
  tradition: string | null;
  period: string | null;
  bio: string | null;
}

export interface Commentary {
  id: string;
  commentator: Commentator | null;
  languageCode: string;
  text: string;
  source: ContentSource | null;
  version: number;
  verificationStatus: VerificationStatus;
  origin: ContentOrigin;
}

export interface VerseWord {
  id: string;
  position: number;
  wordDevanagari: string;
  wordTransliteration: string | null;
  meaningEnglish: string | null;
  meaningHindi: string | null;
  grammarNote: string | null;
  /** Links into the Sanskrit glossary when the word is a known term. */
  sanskritTermId: string | null;
}

export interface AudioTrack {
  id: string;
  kind: 'verse' | 'chapter' | 'reflection' | 'intro';
  chapterNumber: number | null;
  verseNumber: number | null;
  languageCode: string;
  reciter: string | null;
  /** Human recitation vs. synthesised speech. Never silently synthetic. */
  isSynthetic: boolean;
  durationSeconds: number | null;
  sizeBytes: number | null;
  mimeType: string;
  /** Relative object key in R2; clients receive a resolved URL. */
  url: string | null;
  license: ContentLicense | null;
  verificationStatus: VerificationStatus;
}

/** Compact shape used in lists, search results and related-verse rails. */
export interface VerseSummary {
  id: string;
  chapterNumber: number;
  verseNumber: number;
  verseNumberEnd: number | null;
  ref: string;
  slug: string;
  sanskrit: string | null;
  transliteration: string | null;
  translationEnglish: string | null;
  translationHindi: string | null;
}

/** Everything the reader screen needs for one verse. */
export interface Verse extends VerseSummary {
  textVersions: VerseTextVersion[];
  transliterations: Transliteration[];
  translations: Translation[];
  commentaries: Commentary[];
  words: VerseWord[];
  audioTracks: AudioTrack[];
  topics: TopicSummary[];
  relatedVerses: RelatedVerse[];
  speaker: string | null;
  verificationStatus: VerificationStatus;
  canonicalHash: string | null;
  updatedAt: string;
}

export interface RelatedVerse {
  verse: VerseSummary;
  relationType: 'thematic' | 'continuation' | 'contrast' | 'reference' | 'parallel';
  note: string | null;
}

export interface TopicSummary {
  id: string;
  slug: string;
  name: string;
  nameHindi: string | null;
  category: 'emotion' | 'life' | 'practice' | 'concept';
  shortDescription: string | null;
  verseCount: number;
  icon: string | null;
}

export interface Topic extends TopicSummary {
  introduction: string | null;
  introductionHindi: string | null;
  relatedConcepts: string[];
  relatedTopics: TopicSummary[];
  verses: TopicVerse[];
}

export interface TopicVerse {
  verse: VerseSummary;
  /** Curated, not computed at runtime. */
  relevance: number;
  note: string | null;
}

export interface GlossaryTerm {
  id: string;
  slug: string;
  termSanskrit: string;
  termTransliteration: string;
  termEnglish: string | null;
  simpleDefinition: string;
  detailedDefinition: string | null;
  variants: string[];
  synonyms: string[];
  relatedTermSlugs: string[];
  relatedVerses: VerseSummary[];
  sources: ContentSource[];
  verificationStatus: VerificationStatus;
}
