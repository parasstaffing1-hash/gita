/** User-owned data. Everything here works offline first and syncs when signed in. */

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  uiLanguage: string;
  contentLanguages: string[];
  createdAt: string;
}

export type ReaderLayout =
  | 'sanskrit_only'
  | 'sanskrit_hindi'
  | 'sanskrit_english'
  | 'sanskrit_transliteration'
  | 'translation_focus'
  | 'commentary_focus';

export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'system';

export interface ReaderPreferences {
  layout: ReaderLayout;
  theme: ReaderTheme;
  /** Multiplier applied on top of the platform's base body size. */
  fontScale: number;
  lineHeight: number;
  density: 'compact' | 'comfortable' | 'spacious';
  showWordMeanings: boolean;
  showCommentary: boolean;
  translationLanguage: string;
  preferredTranslatorId: string | null;
  preferredCommentatorId: string | null;
  transliterationScheme: 'iast' | 'itrans' | 'hk';
  reduceMotion: boolean;
}

export interface Bookmark {
  id: string;
  verseId: string;
  ref: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Highlight {
  id: string;
  verseId: string;
  ref: string;
  /** Which layer of the verse was highlighted. */
  target: 'sanskrit' | 'transliteration' | 'translation' | 'commentary';
  startOffset: number | null;
  endOffset: number | null;
  color: 'saffron' | 'gold' | 'sage' | 'sky' | 'rose';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Note {
  id: string;
  verseId: string | null;
  ref: string | null;
  body: string;
  tags: string[];
  /** Private by default and never sent to an AI provider without consent. */
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  verseId: string;
  ref: string;
  position: number;
  createdAt: string;
}

export interface ReadingProgress {
  chapterNumber: number;
  lastVerseNumber: number;
  versesRead: number;
  verseCount: number;
  percentComplete: number;
  updatedAt: string;
}

export interface ReadingSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  versesRead: number;
  durationSeconds: number;
  source: 'mobile' | 'web';
}

export interface MemorizationProgress {
  id: string;
  verseId: string;
  ref: string;
  stage: 'not_started' | 'learning' | 'reviewing' | 'memorized';
  repetitions: number;
  lastReviewedAt: string | null;
  /** Reserved for spaced repetition (SM-2 style) added later. */
  nextReviewAt: string | null;
  easeFactor: number;
  intervalDays: number;
  updatedAt: string;
}

export interface NotificationPreferences {
  morningVerseEnabled: boolean;
  morningVerseTime: string;
  eveningReflectionEnabled: boolean;
  eveningReflectionTime: string;
  readingPlanReminderEnabled: boolean;
  readingPlanReminderTime: string;
  customReminderEnabled: boolean;
  customReminderTime: string | null;
  timezone: string;
}
