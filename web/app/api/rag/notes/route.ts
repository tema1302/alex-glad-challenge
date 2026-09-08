// Route Handler: /api/rag/notes — «База знаний» (/rag/ingest), партиция 'notes' rag.sqlite.
// POST — добавить заметку: JSON {title,text} ИЛИ multipart (file: .txt/.md/.markdown
// ≤512КБ, title опц. — иначе имя файла). DELETE — удалить заметку по source (note://).
// GET — полоса «что в базе»: счётчики всех партиций (RagStore.count) + список заметок.
// requireAuth — второй auth-слой (middleware '/api/:path*' — первый); read-only GET
// тоже под ним: список заметок — приватные данные владельца. server-only.
import 'server-only';
import { NextRequest } from 'next/server';

import {
  noteDeleteSchema,
  noteFileError,
  noteIngestSchema,
  NOTE_FILE_EXT,
  NOTE_FILE_MAX_BYTES,
} from '../../../../lib/shared/forms';
import { requireAuth } from '../../../../lib/auth';
import { getRagStore, withDb } from '../../../../lib/server/db';
import { clean, ingestNote, makeEmbedder } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fail(e: unknown): Response {
  // dim-mismatch (смена модели эмбеддингов) / LLM-embeddings / сеть / БД → 502,
  // safeMessage вырезает URL/Bearer/пути (инвариант CLAUDE.md).
  return jsonError(e instanceof Error ? safeMessage(e.message) : 'internal error', 502);
}

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой (день 36): запись в rag.sqlite.
  const denied = requireAuth(req);
  if (denied) return denied;

  const contentType = req.headers.get('content-type') ?? '';
  let title: string;
  let text: string;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return jsonError('Ожидается multipart/form-data с полем file', 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return jsonError('Ожидается файл в поле file', 400);
    }
    const lowerName = file.name.toLowerCase();
    const badExt = !NOTE_FILE_EXT.some((ext) => lowerName.endsWith(ext));
    if (badExt || file.size > NOTE_FILE_MAX_BYTES) {
      return jsonError(
        noteFileError(file.name, file.size) ?? 'Файл не поддерживается',
        badExt ? 415 : 413,
      );
    }
    const titleRaw = form.get('title');
    title = clean(
      typeof titleRaw === 'string' && titleRaw.trim().length > 0
        ? titleRaw
        : file.name.replace(/\.[^.]+$/, ''),
      120,
    );
    // Чистый текст: UTF-8 через TextDecoder (битые последовательности → U+FFFD),
    // clean() поверх — control-chars/cap 20000. Пустой после чистки → 400.
    text = clean(new TextDecoder('utf-8').decode(await file.arrayBuffer()), 20000);
    if (!text) {
      return jsonError('Файл пуст — нечего добавлять в базу', 400);
    }
  } else {
    const parsed = noteIngestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
    }
    // clean() поверх zod: tainted от клиента — control-chars/trim/cap до ингеста.
    title = clean(parsed.data.title, 120);
    text = clean(parsed.data.text, 20000);
    if (!title || !text) {
      return jsonError('Введите заголовок и текст заметки', 400);
    }
  }

  try {
    // Гонки записей в rag.sqlite — строго под withDb (R4). Коллизия slug (тот же
    // title) — осознанная перезапись: delete-then-insert в ingestNote = «обновить».
    const result = await withDb(() => ingestNote(getRagStore(), makeEmbedder(), { title, text }));
    return Response.json(
      { ok: true, source: result.source, title: result.title, chunks: result.chunks },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = noteDeleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  }
  // Префикс ДО SQL: deleteBySource — exact-match по (strategy='notes', source);
  // без префикс-чека точный source чужой партиции удалил бы её чанк.
  if (!parsed.data.source.startsWith('note://')) {
    return jsonError('source должен начинаться с note://', 400);
  }
  try {
    const deleted = await withDb(() => getRagStore().deleteBySource('notes', parsed.data.source));
    return Response.json(
      { ok: true, deleted },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return denied;

  try {
    const data = await withDb(() => {
      const store = getRagStore();
      return {
        partitions: {
          fixed: store.count('fixed'),
          structure: store.count('structure'),
          telegram: store.count('telegram'),
          notes: store.count('notes'),
          docs: store.count('docs'),
          faq: store.count('faq'),
        },
        // Без tg-метаданных: список чатов TG в ответ не попадает (только счётчик).
        notes: store.listNotes(),
      };
    });
    return Response.json(
      { ok: true, ...data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}
