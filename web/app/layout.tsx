// Корневой layout. forcedTheme="dark" — тема всегда тёмная (нет light-режима).
// Editorial-каркас: Header (Nav) сверху, main flex-1, Footer снизу (flex-col min-h-screen).
// Admin-auth (день 36): гость — урезанный хром (Nav без core-ссылок/статуса модели,
// БЕЗ Sidebar/Footer — те светят все защищённые маршруты); админ — полный каркас.
// Layout уже динамический (await headers() для nonce) — cookie-чтение кэш не ломает.
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from './components/ThemeProvider';
import { PerfProbe } from './components/perf-probe';
import Nav from './components/Nav';
import { Sidebar } from './components/Sidebar';
import Footer from './components/Footer';
import { isAdminAuthed } from '../lib/server/session';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Артемий — AI-инженер',
  description:
    'AI-инженер: локальные LLM-агенты, RAG, MCP, TG-автоматизация. 35 дней челленджа — proof-of-work.',
};

// Viewport — отдельный export (Next 15 App Router). Без него мобильные браузеры
// рендерят виртуальный ~980px viewport → сайт выглядит как уменьшенный десктоп.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // nonce из middleware.ts — пробрасывается в next-themes prop `nonce`, чтобы anti-FOUC
  // inline-скрипт тоже покрывался CSP (иначе 1 residual violation под nonce-based политикой).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const isAdmin = await isAdminAuthed();
  return (
    <html lang="ru" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange nonce={nonce}>
          <div className="flex min-h-screen flex-col">
            <Nav isAdmin={isAdmin} />
            {isAdmin ? (
              <>
                <div className="flex flex-1">
                  <Sidebar />
                  <main className="flex-1 px-5 py-6">
                    <div className="mx-auto max-w-6xl">{children}</div>
                  </main>
                </div>
                <Footer />
              </>
            ) : (
              <main className="flex-1 px-5 py-6">
                <div className="mx-auto max-w-6xl">{children}</div>
              </main>
            )}
          </div>
        </ThemeProvider>
        <PerfProbe />
      </body>
    </html>
  );
}
