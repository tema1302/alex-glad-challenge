// Корневой layout. <html lang="ru" suppressHydrationWarning> — последний нужен,
// чтобы next-themes мог ставить класс .dark на <html> до гидратации без warning.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import Nav from './components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Иди на факты глянь — web',
  description: 'Локальный dashboard и витрина системы (день 28)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="mx-auto max-w-6xl px-4 py-6">
            <Nav />
            <main className="mt-6">{children}</main>
            <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
              Локальный Next.js на 127.0.0.1. Не для production-deploy.
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
