// Корневой layout. forcedTheme="dark" — тема всегда тёмная (нет light-режима).
// Editorial-каркас: Header (Nav) сверху, main flex-1, Footer снизу (flex-col min-h-screen).
// MatrixRain размонтирован (de-Matrix троп, опция C); файл components/MatrixRain.tsx оставлен.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import Nav from './components/Nav';
import Footer from './components/Footer';
import './globals.css';

export const metadata: Metadata = {
  title: 'Артемий — AI-инженер',
  description: 'Локальные LLM-агенты, RAG, TG-автоматизация. Лендинг стэка на 127.0.0.1.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-950 font-mono text-neutral-100 antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
          <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
            <Nav />
            <main className="mt-8 flex-1">{children}</main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
