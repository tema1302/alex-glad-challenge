// Route Handler: /api/auth/login — вход единственного админа (день 36).
// zod на входе → rate-limit → fail-closed (503 при незаданном env; имена переменных
// — не секрет) → timing-safe сравнение → stateless cookie admin_session
// (httpOnly, sameSite=lax, path=/, maxAge 7 дней — копия параметров settings-роута).
//
// Rate-limit: глобальный in-memory fixed-window, 10 неудач / 15 мин → 429 до конца
// окна. Глобальный (не per-IP) сознательно: за прокси XFF подделываем; доступ
// владельца loopback. Сбрасывается рестартом — допущение single-admin, зафиксировано
// в плане day-36.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { loginSchema } from '../../../../lib/shared/forms';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  createSessionValue,
  isAdminAuthConfigured,
  verifyAdminPassword,
} from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = 10; // неудачных попыток до блокировки
const RATE_WINDOW_MS = 15 * 60 * 1000; // окно 15 минут

// Модульное состояние окна (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as { __adminLoginFails?: { fails: number; resetAt: number } };
const state = (g.__adminLoginFails ??= { fails: 0, resetAt: 0 });

function isRateLimited(): boolean {
  return state.fails >= RATE_LIMIT && Date.now() < state.resetAt;
}

function registerFail(): void {
  const now = Date.now();
  if (now >= state.resetAt) {
    state.fails = 0;
    state.resetAt = now + RATE_WINDOW_MS;
  }
  state.fails += 1;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (isRateLimited()) {
    return NextResponse.json(
      { ok: false, error: 'Слишком много попыток входа. Подождите до конца 15-минутного окна.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '900' } },
    );
  }

  const parsed = loginSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }

  if (!isAdminAuthConfigured()) {
    // fail-closed: без пароля/секрета вход невозможен в принципе (503, не 401 —
    // это конфигурация, а не неверный пароль).
    return NextResponse.json(
      {
        ok: false,
        error: 'Админ-доступ не настроен: задайте WEB_ADMIN_PASSWORD и WEB_AUTH_SECRET в .env',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    registerFail();
    return NextResponse.json(
      { ok: false, error: 'Неверный пароль' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Успех: сброс окна + выдача сессии.
  state.fails = 0;
  state.resetAt = 0;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
