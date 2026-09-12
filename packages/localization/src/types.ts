/**
 * Localization contract.
 *
 * UI languages ship now: English and Hindi. The `SUPPORTED_LOCALES` list and
 * the `PLANNED_LOCALES` list are separate on purpose — planned locales are
 * routable in the architecture (URL shape, font stack, content language rows)
 * but are not offered in the language picker until their bundle is complete.
 */

export type LocaleCode = 'en' | 'hi';

export interface LocaleMeta {
  code: string;
  name: string;
  nativeName: string;
  script: string;
  fontStack: 'devanagari' | 'latin' | 'bengali' | 'gurmukhi' | 'gujarati' | 'tamil' | 'telugu' | 'kannada' | 'malayalam' | 'odia';
  direction: 'ltr' | 'rtl';
  /** True when a complete UI bundle exists. */
  uiReady: boolean;
}

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  { code: 'en', name: 'English', nativeName: 'English', script: 'Latin', fontStack: 'latin', direction: 'ltr', uiReady: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari', fontStack: 'devanagari', direction: 'ltr', uiReady: true },
];

/** Architecture is ready for these; bundles are not written yet. */
export const PLANNED_LOCALES: LocaleMeta[] = [
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali', fontStack: 'bengali', direction: 'ltr', uiReady: false },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari', fontStack: 'devanagari', direction: 'ltr', uiReady: false },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati', fontStack: 'gujarati', direction: 'ltr', uiReady: false },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil', fontStack: 'tamil', direction: 'ltr', uiReady: false },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu', fontStack: 'telugu', direction: 'ltr', uiReady: false },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada', fontStack: 'kannada', direction: 'ltr', uiReady: false },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam', fontStack: 'malayalam', direction: 'ltr', uiReady: false },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', fontStack: 'gurmukhi', direction: 'ltr', uiReady: false },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia', fontStack: 'odia', direction: 'ltr', uiReady: false },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', script: 'Bengali', fontStack: 'bengali', direction: 'ltr', uiReady: false },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', script: 'Devanagari', fontStack: 'devanagari', direction: 'ltr', uiReady: false },
];

/** Content languages are a superset of UI languages. */
export const CONTENT_LANGUAGES = [
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'en', name: 'English', nativeName: 'English' },
  // Hinglish: Hindi written in Latin script. Always manually authored/reviewed
  // and marked as such — never presented as canonical scripture.
  { code: 'hi-Latn', name: 'Hinglish', nativeName: 'Hinglish' },
] as const;

export const DEFAULT_LOCALE: LocaleCode = 'en';

export function isSupportedLocale(code: string): code is LocaleCode {
  return SUPPORTED_LOCALES.some((l) => l.code === code);
}

export function resolveLocale(input: string | null | undefined): LocaleCode {
  if (!input) return DEFAULT_LOCALE;
  const base = input.toLowerCase().split('-')[0] ?? '';
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}
