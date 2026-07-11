// Корневой layout. forcedTheme="dark" — тема всегда тёмная (нет light-режима).
// Editorial-каркас: Header (Nav) сверху, main flex-1, Footer снизу (flex-col min-h-screen).
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from './components/ThemeProvider';
import Nav from './components/Nav';
import { Sidebar } from './components/Sidebar';
import Footer from './components/Footer';
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
  description: 'Локальные LLM-агенты, RAG, TG-автоматизация. Лендинг стэка на 127.0.0.1.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <div className="flex flex-1">
              <Sidebar />
              <main className="flex-1 px-5 py-6">
                <div className="mx-auto max-w-6xl">{children}</div>
              </main>
            </div>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
