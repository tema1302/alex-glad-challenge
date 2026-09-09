// Metadata-роут robots (Next file-convention → /robots.txt). Allowlist-подход:
// '/', но приватные хвосты (админка, чаты, API, служебные blog-роуты) — явно
// под Disallow; /login закрываем от выдачи. Sitemap отдаётся с того же origin,
// что metadataBase в layout.tsx.
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.WEB_PUBLIC_ORIGIN?.trim() || 'http://127.0.0.1:3000';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard',
        '/admin',
        '/chat',
        '/rag',
        '/mcp',
        '/agent',
        '/briefing',
        '/summary',
        '/settings',
        '/tg',
        '/telegram',
        '/blog/news',
        '/blog/posts',
        '/blog/digest',
        '/login',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
