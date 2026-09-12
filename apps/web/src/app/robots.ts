import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/api';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Search result pages add nothing to an index and would eat crawl
        // budget that belongs to the 700 verse pages.
        disallow: ['/search', '/api/'],
      },
    ],
    sitemap: `${SITE_URL.replace(/\/+$/, '')}/sitemap.xml`,
  };
}
