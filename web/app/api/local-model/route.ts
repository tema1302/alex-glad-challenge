// /api/local-model — runtime-переключение локальной LLM «тюненая/базовая»
// (day-10). Закрыт middleware (не входит в PUBLIC_PATHS).
//   GET  → { ok, base, tuned, active, switchable }
//   POST {model} → переключение; 400 на невалидное тело/имя, 409 если
//        переключатель недоступен (LOCAL_LLM_TUNED_MODEL не задана).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { localModelSetSchema } from '../../../lib/shared/forms';
import {
  getLocalModelState,
  setLocalModelOverride,
} from '../../../lib/server/local-model-switch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return NextResponse.json(
    { ok: true, ...getLocalModelState() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = localModelSetSchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  try {
    const state = setLocalModelOverride(parsed.data.model);
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    const message = e instanceof RangeError ? e.message : 'switch failed';
    const status = /не задана|недоступен/.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
