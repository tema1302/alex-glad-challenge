// /api/todos — CRUD через TodoDb напрямую (день 28, web P1).
// GET  → listTodos() (все). POST → addTodo(text, scheduledAt, recurring, dayOfWeek, intervalHours).
// server-only: импорт core/ только через web/lib/server/* chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { todoAddSchema } from '../../../lib/shared/forms';
import { getTodoDb, withDb } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const todos = await withDb(() => getTodoDb().listTodos());
  return NextResponse.json({ todos });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = todoAddSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { text, recurring, intervalHours } = parsed.data;
  // weekly: day_of_week = сегодня (каждую неделю в этот день). hourly: интервал из формы
  // (default 1). scheduledAt — разовые задачи; форма повторяющихся не выставляет время.
  const dayOfWeek = recurring === 'weekly' ? new Date().getDay() : null;
  const interval = recurring === 'hourly' ? (intervalHours ?? 1) : null;
  const id = await withDb(() =>
    getTodoDb().addTodo(text, null, recurring ?? null, dayOfWeek, interval),
  );
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
