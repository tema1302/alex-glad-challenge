// Route Handler: /api/auth/logout — снятие сессии админа (день 36).
// POST, не GET-линк: мутация состояния = POST (анти-CSRF-гигиена + канон web/).
// Cookie обнуляется (maxAge:0) — stateless-сессии в БД нет.
import 'server-only';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
