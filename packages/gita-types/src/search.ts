/** Hybrid search + "Ask the Gita" contracts. */
import type { VerseSummary, GlossaryTerm, TopicSummary } from './canonical';

export type SearchMatchKind =
  | 'reference'      // "2.47", "bg 2 47", "chapter 2 verse 47"
  | 'exact'          // exact phrase in a stored text
  | 'fulltext'       // Postgres FTS
  | 'fuzzy'          // pg_trgm — handles krsna / krishn / कृष्ण
  | 'semantic'       // pgvector
  | 'topic';         // curated topic mapping

export interface SearchHit {
  verse: VerseSummary;
  /** Fusion score: orders results within one response, not an absolute value. */
  score: number;
  /** Absolute match strength, 0..1. */
  relevance: number;
  /** Which retrievers contributed, for debugging and transparency. */
  matchedBy: SearchMatchKind[];
  /** Server-rendered snippet with <mark> markers already escaped away. */
  snippet: string | null;
  snippetField: string | null;
}

export interface SearchResponse {
  query: string;
  normalizedQuery: string;
  detectedLanguage: string;
  /** Set when the query parsed as a direct chapter/verse reference. */
  reference: { chapter: number; verse: number | null } | null;
  hits: SearchHit[];
  topics: TopicSummary[];
  glossary: Pick<GlossaryTerm, 'id' | 'slug' | 'termSanskrit' | 'termTransliteration' | 'simpleDefinition'>[];
  total: number;
  tookMs: number;
}

export type AskMode =
  | 'default'
  | 'simple'
  | 'deep'
  | 'beginner'
  | 'sources_only'
  | 'compare_interpretations';

export interface AskRequest {
  question: string;
  mode?: AskMode;
  /** en | hi | hi-Latn (Hinglish). Auto-detected when omitted. */
  language?: string;
  /** Anchors the answer to one verse ("ask about this verse"). */
  verseRef?: string | null;
  conversationId?: string | null;
}

export interface AskCitation {
  verse: VerseSummary;
  /** Verbatim snippet copied from stored canonical content — never generated. */
  quotedText: string;
  quotedField: 'sanskrit' | 'transliteration' | 'translation' | 'commentary';
  translationLanguage: string | null;
  commentatorName: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  licenseCode: string | null;
}

export type GroundingStatus =
  | 'grounded'            // every claim maps to retrieved canonical content
  | 'partially_grounded'  // answered, but some citations were dropped
  | 'insufficient_evidence'; // refused to answer rather than fabricate

export interface AskResponse {
  id: string;
  question: string;
  normalizedQuestion: string;
  detectedLanguage: string;
  mode: AskMode;
  answer: string;
  groundingStatus: GroundingStatus;
  citations: AskCitation[];
  /** Citations the validator removed because they were not in the context. */
  rejectedCitations: string[];
  followUpSuggestions: string[];
  disclaimer: string | null;
  modelProvider: string;
  modelName: string;
  tookMs: number;
  createdAt: string;
}
