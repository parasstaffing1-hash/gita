import type { MetadataRoute } from 'next';

import { api, tryFetch } from '@/lib/api';
import { absoluteUrl } from '@/lib/seo';

/**
 * XML sitemap.
 *
 * Verse URLs come from each chapter's verse count rather than from the rows
 * that happen to be imported, so the sitemap describes the finished text and
 * stays stable while content is still landing. Priorities are relative
 * weights, not claims about importance.
 */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/gita'), lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    {
      url: absoluteUrl('/gita/topics'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: absoluteUrl('/gita/glossary'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: absoluteUrl('/reading-plans'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    { url: absoluteUrl('/ask'), lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/create'), lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    {
      url: absoluteUrl('/start-here'),
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];

  const [chapters, topics, glossary, plans] = await Promise.all([
    tryFetch(() => api.listChapters(), []),
    tryFetch(() => api.listTopics(), []),
    tryFetch(() => api.listGlossary(), []),
    tryFetch(() => api.listReadingPlans(), []),
  ]);

  const chapterPages: MetadataRoute.Sitemap = chapters.map((chapter) => ({
    url: absoluteUrl(`/gita/chapter/${chapter.number}`),
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  const versePages: MetadataRoute.Sitemap = chapters.flatMap((chapter) =>
    Array.from({ length: chapter.verseCount }, (_, index) => ({
      url: absoluteUrl(`/gita/${chapter.number}/${index + 1}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  );

  return [
    ...staticPages,
    ...chapterPages,
    ...versePages,
    ...topics.map((topic) => ({
      url: absoluteUrl(`/gita/topics/${topic.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...glossary.map((term) => ({
      url: absoluteUrl(`/gita/glossary/${term.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
    ...plans.map((plan) => ({
      url: absoluteUrl(`/reading-plans/${plan.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
}
