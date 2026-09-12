/**
 * SEO helpers.
 *
 * Titles are descriptive rather than keyword-stuffed. The pattern
 *   "Bhagavad Gita 2.47: Sanskrit, Meaning, Translation and Explanation"
 * is what a person searching for a verse actually types, and it says honestly
 * what is on the page.
 */
import type { Metadata } from 'next';
import type { Chapter, GlossaryTerm, Topic, Verse } from '@gita/types';
import { truncateWords } from '@gita/shared-utils';

import { SITE_URL } from './api';

export const SITE_NAME = 'Gita';
export const SITE_TAGLINE = 'Read, listen and understand the Bhagavad Gita';

const DEFAULT_DESCRIPTION =
  'Read the Bhagavad Gita with Sanskrit, transliteration, Hindi and English translations, ' +
  'word-by-word meanings and commentary. Every explanation is grounded in the verses themselves.';

export function absoluteUrl(path: string): string {
  return `${SITE_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

interface PageMetaInput {
  title: string;
  description: string;
  path: string;
  /** Locales this page also exists in, for hreflang. */
  locales?: string[];
  type?: 'website' | 'article';
  imagePath?: string;
}

export function buildMetadata({
  title,
  description,
  path,
  locales = ['en', 'hi'],
  type = 'website',
  imagePath,
}: PageMetaInput): Metadata {
  const url = absoluteUrl(path);
  const image = absoluteUrl(imagePath ?? '/opengraph-image');

  return {
    title,
    description: truncateWords(description, 158),
    alternates: {
      canonical: url,
      languages: Object.fromEntries(
        locales.map((locale) => [locale, locale === 'en' ? url : `${url}?lang=${locale}`]),
      ),
    },
    openGraph: {
      type,
      url,
      siteName: SITE_NAME,
      title,
      description: truncateWords(description, 158),
      images: [{ url: image, width: 1200, height: 630, alt: title }],
      locale: 'en_IN',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: truncateWords(description, 158),
      images: [image],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
  };
}

export const defaultMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  formatDetection: { telephone: false, address: false, email: false },
  ...buildMetadata({
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: DEFAULT_DESCRIPTION,
    path: '/',
  }),
};

// --- Per-entity metadata ---------------------------------------------------

export function verseMetadata(verse: Verse, chapterName?: string): Metadata {
  const ref = `${verse.chapterNumber}.${verse.verseNumber}`;
  const title = `Bhagavad Gita ${ref}: Sanskrit, Meaning, Translation and Explanation`;

  const translation = verse.translationEnglish ?? '';
  const description = translation
    ? `"${truncateWords(translation, 110)}" — Bhagavad Gita Chapter ${verse.chapterNumber}, ` +
      `Verse ${verse.verseNumber}${chapterName ? ` (${chapterName})` : ''}. ` +
      'Sanskrit, transliteration, word meanings and commentary.'
    : `Bhagavad Gita Chapter ${verse.chapterNumber}, Verse ${verse.verseNumber}: Sanskrit text, ` +
      'transliteration, translations, word-by-word meanings and commentary.';

  return buildMetadata({
    title,
    description,
    path: `/gita/${verse.chapterNumber}/${verse.verseNumber}`,
    type: 'article',
    imagePath: `/gita/${verse.chapterNumber}/${verse.verseNumber}/opengraph-image`,
  });
}

export function chapterMetadata(chapter: Chapter): Metadata {
  const title = `Bhagavad Gita Chapter ${chapter.number}: ${chapter.nameEnglish} — All ${chapter.verseCount} Verses`;
  const description = chapter.summary
    ? truncateWords(chapter.summary, 155)
    : `Chapter ${chapter.number} of the Bhagavad Gita, ${chapter.nameEnglish}, in ${chapter.verseCount} verses. ` +
      'Sanskrit, transliteration, translation and summary.';

  return buildMetadata({
    title,
    description,
    path: `/gita/chapter/${chapter.number}`,
    type: 'article',
  });
}

export function topicMetadata(topic: Topic): Metadata {
  const title = `What the Bhagavad Gita Says About ${topic.name}`;
  const description =
    topic.shortDescription ??
    `Verses from the Bhagavad Gita on ${topic.name.toLowerCase()}, chosen and explained by editors.`;

  return buildMetadata({
    title,
    description,
    path: `/gita/topics/${topic.slug}`,
    type: 'article',
  });
}

export function glossaryMetadata(term: GlossaryTerm): Metadata {
  const title = `${term.termTransliteration} (${term.termSanskrit}) — Meaning in the Bhagavad Gita`;
  return buildMetadata({
    title,
    description: truncateWords(term.simpleDefinition, 155),
    path: `/gita/glossary/${term.slug}`,
    type: 'article',
  });
}

// --- Structured data -------------------------------------------------------

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * A verse page is a quotation with commentary. `Article` with a `citation`
 * describes that more honestly than `CreativeWork` alone, and the `about`
 * link ties the page to the Gita as a work rather than to a generic topic.
 */
export function verseJsonLd(verse: Verse, chapterName?: string) {
  const ref = `${verse.chapterNumber}.${verse.verseNumber}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `Bhagavad Gita ${ref}`,
    description: verse.translationEnglish ?? undefined,
    inLanguage: 'en',
    isPartOf: {
      '@type': 'Book',
      name: 'Bhagavad Gita',
      alternateName: 'श्रीमद्भगवद्गीता',
      inLanguage: 'sa',
    },
    about: {
      '@type': 'Chapter',
      name: chapterName ? `Chapter ${verse.chapterNumber}: ${chapterName}` : `Chapter ${verse.chapterNumber}`,
      position: verse.chapterNumber,
    },
    citation: verse.sanskrit ?? undefined,
    url: absoluteUrl(`/gita/${verse.chapterNumber}/${verse.verseNumber}`),
    dateModified: verse.updatedAt,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };
}

export function chapterJsonLd(chapter: Chapter) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Chapter',
    name: `Bhagavad Gita Chapter ${chapter.number}: ${chapter.nameEnglish}`,
    alternateName: chapter.nameSanskrit ?? undefined,
    position: chapter.number,
    description: chapter.summary ?? undefined,
    url: absoluteUrl(`/gita/chapter/${chapter.number}`),
    isPartOf: {
      '@type': 'Book',
      name: 'Bhagavad Gita',
      numberOfPages: 18,
      inLanguage: 'sa',
    },
  };
}

export function glossaryJsonLd(term: GlossaryTerm) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: term.termTransliteration,
    alternateName: [term.termSanskrit, ...term.variants],
    description: term.simpleDefinition,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'Bhagavad Gita Glossary',
      url: absoluteUrl('/gita/glossary'),
    },
    url: absoluteUrl(`/gita/glossary/${term.slug}`),
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}
