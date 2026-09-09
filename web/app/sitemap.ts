// Metadata-роут sitemap (Next file-convention → /sitemap.xml). Ровно публичные
// маршруты, согласованы с PUBLIC_PATHS в middleware.ts (без /login и API).
// Origin — тот же fallback, что metadataBase в layout.tsx.
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.WEB_PUBLIC_ORIGIN?.trim() || 'http://127.0.0.1:3000';
  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/demo`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/jira`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/harness`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    {
      url: `${base}/blog/pipeline`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
  ];
}
