// Route Handler: POST /api/blog/digest/generate — черновик еженедельного дайджеста
// одним LLM-вызовом (админ-фича «Дайджест одним кликом»). Отправки в TG здесь НЕТ —
// публикация только вручную через существующий /api/telegram/publish. Путь:
//   requireAuth (второй слой; middleware гейтит — путь НЕ в PUBLIC_PATHS) → zod
//   digestGenerateSchema (days 1..30, дефолт 7) → withDb(newsSince) [read-only:
//   по published_at, включая used; пул pipeline-новостей не расходуется] →
//   409 при пустом окне (LLM не вызывается) → LLM ВНЕ withDb-мьютекса (cloud-first,
//   фолбэк local — прецедент /api/demo/rag) → clamp ≤4096 (лимит TG, обрезка по
//   границе строки) → 200 {ok, digest, newsCount, sources, truncated}.
// Новости — tainted (RSS): clean() до промпта; в промпт идут только
// title/summary(≤200)/url/published_at из БД; sources — из БД-выборки, не из ответа
// LLM (grounded by design). Ошибки LLM/сети → 502 safeMessage. server-only.
import 'server-only';
import { NextRequest } from 'next/server';

import { digestGenerateSchema } from '../../../../../lib/shared/forms';
import { requireAuth } from '../../../../../lib/auth';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { pickLlmClient } from '../../../../../lib/server/llm';
import { getKeysStatus } from '../../../../../lib/server/env';
import { safeMessage } from '../../../../../lib/server/safe-message';
import { clean, msg } from '../../../../../lib/server/challenge';
import type { ChatMessage } from '../../../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 7;
const MAX_NEWS = 60;           // cap свежайших — промпт не разрастается с ростом базы
const FIELD_MAX = 200;         // title/summary одной новости в промпте
const DIGEST_MAX_CHARS = 4096; // жёсткий лимит TG-сообщения
const PROMPT_TARGET_CHARS = 3500; // буфер под лимит TG (clamp — страховка)

const DIGEST_SYSTEM = [
  'Ты — редактор телеграм-канала «Иди на факты глянь» (футбол: Челси, АПЛ). Собираешь дайджест недели.',
  'Жёсткие правила:',
  '1. Использовать ТОЛЬКО факты из списка новостей: не добавлять счёты, даты, имена и трансферы, которых нет в списке.',
  '2. Каждый пункт завершается точным URL из списка — других ссылок нет.',
  '3. Plain text, без HTML/Markdown-разметки.',
  `4. Формат: заголовок + 5-7 пунктов вида «заголовок — 1-2 предложения — URL». Объём ≤${PROMPT_TARGET_CHARS} символов.`,
  '5. Последняя строка: «Подборка по новостям недели — полные разборы в канале».',
].join('\n');

interface DigestNewsItem {
  title: string;
  summary: string;
  url: string;
  published_at: string;
}

function digestMessages(news: DigestNewsItem[]): ChatMessage[] {
  const payload = JSON.stringify(news, null, 2);
  return [
    msg.system(DIGEST_SYSTEM),
    msg.user(`Собери дайджест недели ТОЛЬКО по новостям из списка.\n\nНовости:\n${payload}`),
  ];
}

// Обрезка по границе строки + '…'; итог гарантированно ≤4096 (UI-счётчик и zod
// tgPublishSchema — вторая и третья линии защиты перед отправкой).
function clampDigest(raw: string): { text: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length <= DIGEST_MAX_CHARS) return { text: trimmed, truncated: false };
  const cut = trimmed.slice(0, DIGEST_MAX_CHARS);
  const nl = cut.lastIndexOf('\n');
  const base = (nl > 0 ? cut.slice(0, nl) : cut).trimEnd().slice(0, DIGEST_MAX_CHARS - 2);
  return { text: `${base} …`, truncated: true };
}

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой: генерация жжёт токены владельца — ошибка в middleware-matcher
  // не должна открывать бесплатный LLM-endpoint.
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = digestGenerateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const days = parsed.data.days ?? DEFAULT_DAYS;

  // Чтение окна — короткий sync-read внутри withDb; LLM-вызов ниже — вне мьютекса,
  // чтобы не блокировать админ-операции на время генерации.
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const rows = await withDb(() => getBlogDb().newsSince(since));
  if (rows.length === 0) {
    return Response.json(
      {
        ok: false,
        error: `За ${days} дней новостей нет — расширьте окно`,
        errorKind: 'empty-window',
      },
      { status: 409 },
    );
  }

  // RSS-контент tainted → clean() до промпта; ORDER BY published_at DESC —
  // slice берёт свежайшие.
  const news: DigestNewsItem[] = rows.slice(0, MAX_NEWS).map((n) => ({
    title: clean(n.title, FIELD_MAX),
    summary: clean(n.summary, FIELD_MAX),
    url: n.url,
    published_at: n.published_at,
  }));

  // Провайдера фиксирует сервер: cloud → фолбэк local; ни один не настроен → 502.
  const keys = getKeysStatus();
  try {
    const client = pickLlmClient(keys.cloud.configured ? 'cloud' : 'local');
    const raw = await client.chat(digestMessages(news), { temperature: 0.4, maxTokens: 1500 });
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('LLM вернул пустой дайджест');
    const { text, truncated } = clampDigest(trimmed);
    const sources = news.map(({ title, url }) => ({ title, url }));
    return Response.json({ ok: true, digest: text, newsCount: sources.length, sources, truncated });
  } catch (e) {
    return Response.json(
      { ok: false, error: safeMessage(e instanceof Error ? e.message : 'digest generation failed') },
      { status: 502 },
    );
  }
}
