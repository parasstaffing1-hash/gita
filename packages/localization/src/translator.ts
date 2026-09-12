import { en, type TranslationSchema } from './locales/en';
import { hi } from './locales/hi';
import { DEFAULT_LOCALE, resolveLocale, type LocaleCode } from './types';

const BUNDLES: Record<LocaleCode, TranslationSchema> = { en, hi };

export type TranslationKey = NestedKeys<TranslationSchema>;

type NestedKeys<T> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? `${K}.${NestedKeys<T[K]>}`
    : K;
}[keyof T & string];

function lookup(bundle: unknown, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), bundle);
  return typeof value === 'string' ? value : undefined;
}

/** Replace {{name}} placeholders. Missing values are left visible, not blank. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export interface Translator {
  locale: LocaleCode;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/**
 * Create a translator. Falls back to English per-key (not per-bundle), so a
 * partially translated locale still renders instead of throwing.
 */
export function createTranslator(localeInput: string | null | undefined): Translator {
  const locale = resolveLocale(localeInput);
  const bundle = BUNDLES[locale] ?? BUNDLES[DEFAULT_LOCALE];
  return {
    locale,
    t(key, params) {
      const value = lookup(bundle, key) ?? lookup(BUNDLES[DEFAULT_LOCALE], key) ?? key;
      return interpolate(value, params);
    },
  };
}

export function getBundle(localeInput: string | null | undefined): TranslationSchema {
  return BUNDLES[resolveLocale(localeInput)] ?? BUNDLES[DEFAULT_LOCALE];
}

export { en, hi };
export type { TranslationSchema };
