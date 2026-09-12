/**
 * TanStack Query key factory.
 *
 * Keys live here so mobile and web invalidate the same things. Canonical
 * content keys are long-lived; user-data keys are scoped by user so signing
 * out cannot leak another account's cache.
 */
export const queryKeys = {
  health: ['health'] as const,

  chapters: () => ['chapters'] as const,
  chapter: (number: number) => ['chapters', number] as const,
  chapterVerses: (number: number, page = 0) => ['chapters', number, 'verses', page] as const,
  verse: (chapter: number, verse: number) => ['verses', chapter, verse] as const,

  topics: (category?: string) => ['topics', category ?? 'all'] as const,
  topic: (slug: string) => ['topics', slug] as const,
  glossary: () => ['glossary'] as const,
  glossaryTerm: (slug: string) => ['glossary', slug] as const,

  search: (query: string, language?: string) => ['search', query, language ?? 'auto'] as const,
  ask: (id: string) => ['ask', id] as const,

  dailyVerse: (date: string) => ['daily-verse', date] as const,
  readingPlans: () => ['reading-plans'] as const,
  readingPlan: (slug: string) => ['reading-plans', slug] as const,

  contentManifest: () => ['content', 'manifest'] as const,

  // User-scoped. `userId` is 'guest' for anonymous local-only usage.
  bookmarks: (userId: string) => ['user', userId, 'bookmarks'] as const,
  notes: (userId: string) => ['user', userId, 'notes'] as const,
  highlights: (userId: string) => ['user', userId, 'highlights'] as const,
  collections: (userId: string) => ['user', userId, 'collections'] as const,
  readingProgress: (userId: string) => ['user', userId, 'reading-progress'] as const,
  planProgress: (userId: string) => ['user', userId, 'plan-progress'] as const,
  memorization: (userId: string) => ['user', userId, 'memorization'] as const,
} as const;
