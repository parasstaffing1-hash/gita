/** Reading plans, daily verse and streaks. */
import type { VerseSummary } from './canonical';

export interface ReadingPlanSummary {
  id: string;
  slug: string;
  title: string;
  titleHindi: string | null;
  subtitle: string | null;
  description: string | null;
  durationDays: number;
  level: 'beginner' | 'intermediate' | 'advanced';
  coverImageUrl: string | null;
  tags: string[];
}

export interface ReadingPlanDay {
  id: string;
  dayNumber: number;
  title: string;
  intro: string | null;
  verses: VerseSummary[];
  reflection: string | null;
  audioTrackIds: string[];
  estimatedMinutes: number;
}

export interface ReadingPlan extends ReadingPlanSummary {
  days: ReadingPlanDay[];
}

export interface UserPlanProgress {
  planId: string;
  planSlug: string;
  startedAt: string;
  completedDays: number[];
  currentDay: number;
  percentComplete: number;
  completedAt: string | null;
  reminderEnabled: boolean;
}

export interface DailyVerse {
  date: string;
  verse: VerseSummary;
  /** A short, human-written, reviewed reflection. Never model output. */
  reflection: string | null;
  reflectionHindi: string | null;
  audioTrackId: string | null;
  relatedVerse: VerseSummary | null;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}
