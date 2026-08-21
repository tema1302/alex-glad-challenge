// /login — вход единственного админа (день 36). Публичная (PUBLIC_PATHS в middleware).
// Санитизация next: только внутренний путь (начинается с '/', НЕ '//', без '://'),
// иначе дефолт /dashboard — анти open-redirect. Уже авторизован → /dashboard.
// Auth не настроен → graceful-блок (fail-closed, имена env без значений).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isAdminAuthConfigured } from '../../lib/auth';
import { isAdminAuthed } from '../../lib/server/session';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Вход — Артемий Артель·AI' };

function sanitizeNext(raw: string | string[] | undefined): string {
  const next = Array.isArray(raw) ? raw[0] : raw;
  // '\' запрещён: WHATWG нормализует его в '/', '/\/evil.com' станет '//evil.com' (open-redirect).
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('://') || next.includes('\\')) {
    return '/dashboard';
  }
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await isAdminAuthed()) redirect('/dashboard');

  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5">
      <div className="w-full max-w-sm">
        {isAdminAuthConfigured() ? (
          <LoginForm next={safeNext} />
        ) : (
          <div className="bento-enter rounded-2xl border border-warn/40 bg-warn/10 p-6">
            <h1 className="font-mono text-lg font-semibold uppercase tracking-tight text-warn">
              Админ-доступ не настроен
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-warn">
              Задайте <code className="font-mono text-xs">WEB_ADMIN_PASSWORD</code> и{' '}
              <code className="font-mono text-xs">WEB_AUTH_SECRET</code> в корневом{' '}
              <code className="font-mono text-xs">.env</code> (см.{' '}
              <code className="font-mono text-xs">.env.example</code>) и перезапустите сервер.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
