// CSP с per-request nonce (fix web-prod-blank-csp). Next.js в production App Router
// вставляет inline-скрипты гидратации (bootstrap, RSC flight-payload, module-preloads).
// Статический `script-src 'self'` (бывший в next.config headers()) их блокировал →
// router-чанк выкидывал SSR-шелл, гидрировать нечем → чёрный пустой `body` на боeвом
// деплое. Nonce генерится per-request, Next.js автоматически навешивает его на свои
// inline-скрипты через `x-nonce` request-header (механизм фреймворка). 'strict-dynamic'
// разрешает внешние чанки, которые грузит bootstrap. Требует dynamic-rendering — все
// наши страницы force-dynamic, fresh nonce на каждый view.
//
// runtime = nodejs: standalone-стек на Node, Buffer доступен, нет риска edge-API-гэпов.
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Всё, кроме API, статики, картинок next/image, favicon. Prefetch-запросы пропускаем.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
