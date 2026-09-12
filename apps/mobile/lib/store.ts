/**
 * App state.
 *
 * Zustand rather than context: the reader preferences are read by nearly every
 * component on the verse screen, and a context change there re-renders the
 * whole tree on every font-size nudge.
 *
 * Preferences persist to SQLite (not AsyncStorage) so they sit alongside the
 * rest of the reader's data and go up in the same sync.
 */
import { create } from 'zustand';

import { STATE_KEYS, getJsonState, setJsonState } from './db';
import type { ThemeName } from './theme';

export type ReaderLayout =
  | 'sanskrit_only'
  | 'sanskrit_hindi'
  | 'sanskrit_english'
  | 'sanskrit_transliteration'
  | 'translation_focus'
  | 'commentary_focus';

export type Density = 'compact' | 'comfortable' | 'spacious';

export interface ReaderPreferences {
  layout: ReaderLayout;
  theme: ThemeName | 'system';
  /** Multiplier on the base body size. Clamped so the layout cannot break. */
  fontScale: number;
  lineHeight: number;
  density: Density;
  showWordMeanings: boolean;
  showCommentary: boolean;
  translationLanguage: 'en' | 'hi';
  transliterationScheme: 'iast' | 'itrans' | 'hk';
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  layout: 'sanskrit_english',
  theme: 'system',
  fontScale: 1,
  lineHeight: 1.75,
  density: 'comfortable',
  showWordMeanings: true,
  showCommentary: true,
  translationLanguage: 'en',
  transliterationScheme: 'iast',
  reduceMotion: false,
};

export const FONT_SCALE_RANGE = { min: 0.85, max: 2.0, step: 0.05 } as const;

interface PreferencesState {
  preferences: ReaderPreferences;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<ReaderPreferences>) => Promise<void>;
  reset: () => Promise<void>;
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  loaded: false,

  async load() {
    const stored = await getJsonState<Partial<ReaderPreferences>>(
      STATE_KEYS.readerPreferences,
      {},
    );
    // Merge rather than replace: a preference added in a later release must
    // not be undefined for someone upgrading.
    set({ preferences: { ...DEFAULT_PREFERENCES, ...stored }, loaded: true });
  },

  async update(patch) {
    const next = { ...get().preferences, ...patch };
    if (patch.fontScale !== undefined) {
      next.fontScale = Math.min(
        FONT_SCALE_RANGE.max,
        Math.max(FONT_SCALE_RANGE.min, patch.fontScale),
      );
    }
    set({ preferences: next });
    await setJsonState(STATE_KEYS.readerPreferences, next);
  },

  async reset() {
    set({ preferences: DEFAULT_PREFERENCES });
    await setJsonState(STATE_KEYS.readerPreferences, DEFAULT_PREFERENCES);
  },
}));

// --- Content readiness ----------------------------------------------------

interface ContentState {
  ready: boolean;
  syncing: boolean;
  progress: { done: number; total: number };
  error: string | null;
  setReady: (ready: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setProgress: (done: number, total: number) => void;
  setError: (error: string | null) => void;
}

export const useContentState = create<ContentState>((set) => ({
  ready: false,
  syncing: false,
  progress: { done: 0, total: 18 },
  error: null,
  setReady: (ready) => set({ ready }),
  setSyncing: (syncing) => set({ syncing }),
  setProgress: (done, total) => set({ progress: { done, total } }),
  setError: (error) => set({ error }),
}));

// --- Session --------------------------------------------------------------

interface SessionState {
  /** Null while signed out. Reading, search and local notes all work anyway. */
  userId: string | null;
  email: string | null;
  signIn: (userId: string, email: string) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>((set) => ({
  userId: null,
  email: null,
  signIn: (userId, email) => set({ userId, email }),
  signOut: () => set({ userId: null, email: null }),
}));
