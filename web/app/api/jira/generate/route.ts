// /api/jira/generate — публичный single-shot генератор Jira-задач (meetup-web).
// POST {description, llm?, format?} → 200 {ok:true, story} | ошибки: 400 (zod), 429 (rate-limit),
// 502 (модель не по контракту/сеть), 503 (LLM не настроен).
//
// Stateless: без истории, БД и персиста; ответ целиком (не UX-стриминг) — генерация
// идёт server-side через chatStream как транспорт abort (signal в fetch), AbortController
// 120 с на попытку, максимум 2 попытки (повтор при нарушении моделью контракта формата
// (7 блоков User Story / 6 секций STAR) или сетевом сбое). LLM-ответ tainted → clean() перед отдачей.
//
// Security публичного LLM-endpoint: двойной rate-limit (per-IP + глобальный предохранитель,
// in-memory fixed-window на globalThis — переживает HMR dev, сбрасывается рестартом),
// cap длины описания в jiraGenerateSchema, safeMessage в catch. Ключи НЕ читаются и не
// логируются; provider/model наружу не уходят из этого роута.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { jiraGenerateSchema } from '../../../../lib/shared/forms';
import {
  clean,
  msg,
  type ChatMessage,
} from '../../../../lib/server/challenge';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getKeysStatus } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';
import {
  JIRA_SYSTEM,
  JIRA_FEWSHOT,
  JIRA_KNOBS,
  validateJiraStory,
  STAR_SYSTEM,
  STAR_FEWSHOT,
  STAR_KNOBS,
  validateStarStory,
} from '../../../../lib/server/jira-persona';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 120_000; // abort одной попытки (умещает локальную 4B и облако)
const MAX_ATTEMPTS = 2;
const MAX_STORY_LEN = 8000;

// Rate-limit (fixed-window): per-IP 10 запросов / 15 мин + глобальный предохранитель
// 120 / 15 мин против распределённого дожигания ключей. XFF подделывается за прокси —
// лимиты остаточные, для митапа достаточно; константы легко крутить.
const RATE_PER_IP = 10;
const RATE_GLOBAL = 120;
const RATE_WINDOW_MS = 15 * 60 * 1000;

interface RateWindow {
  count: number;
  resetAt: number;
}

// Модульное состояние окон (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as {
  __jiraRate?: { ips: Map<string, RateWindow>; total: RateWindow };
};
const rate = (g.__jiraRate ??= { ips: new Map(), total: { count: 0, resetAt: 0 } });

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function rollWindow(w: RateWindow, now: number): void {
  if (now >= w.resetAt) {
    w.count = 0;
    w.resetAt = now + RATE_WINDOW_MS;
  }
}

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'Слишком много запросов к генератору — попробуйте через несколько минут.' },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSec) } },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  // --- Rate-limit до всего остального ---
  const now0 = Date.now();
  const ip = clientIp(req);
  // Sweep протухших окон: не даём карте расти бесконечно при спуфинге XFF.
  if (rate.ips.size > 500) {
    for (const [k, v] of rate.ips) {
      if (now0 >= v.resetAt) rate.ips.delete(k);
    }
  }
  let win = rate.ips.get(ip);
  if (!win) {
    win = { count: 0, resetAt: now0 + RATE_WINDOW_MS };
    rate.ips.set(ip, win);
  }
  rollWindow(win, now0);
  win.count += 1;
  if (win.count > RATE_PER_IP) {
    return tooMany(Math.max(1, Math.ceil((win.resetAt - now0) / 1000)));
  }

  rollWindow(rate.total, now0);
  rate.total.count += 1;
  if (rate.total.count > RATE_GLOBAL) {
    return tooMany(Math.max(1, Math.ceil((rate.total.resetAt - now0) / 1000)));
  }

  // --- Валидация входа (граница) ---
  const parsed = jiraGenerateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // --- Провайдер: недоступный выбор фолбэкается на второй; оба закрыты → fail-closed 503 ---
  const keys = getKeysStatus();
  let pref: 'local' | 'cloud' = parsed.data.llm ?? (keys.cloud.configured ? 'cloud' : 'local');
  if (pref === 'cloud' && !keys.cloud.configured) pref = 'local';
  if (pref === 'local' && !keys.local.configured) {
    if (!keys.cloud.configured) {
      return NextResponse.json(
        { ok: false, error: 'LLM не настроен ни локально, ни в облаке — генерация временно недоступна.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    pref = 'cloud';
  }

  const description = clean(parsed.data.description, 2000);
  // Формат вывода: опционален в схеме, дефолт 'user-story' — запросы без поля
  // получают байт-в-байт прежнее поведение (тот же промпт/knobs/валидатор).
  const format = parsed.data.format ?? 'user-story';
  const isStar = format === 'star';
  const system = isStar ? STAR_SYSTEM : JIRA_SYSTEM;
  const fewshot = isStar ? STAR_FEWSHOT : JIRA_FEWSHOT;
  const knobs = isStar ? STAR_KNOBS : JIRA_KNOBS;
  const validate = isStar ? validateStarStory : validateJiraStory;
  const messages: ChatMessage[] = [
    msg.system(system),
    ...fewshot,
    msg.user(description),
  ];
  const client = pickLlmClient(pref);

  // --- До 2 попыток: сбор ответа целиком + sanity-валидация контракта ---
  let lastProblem: string | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      let out = '';
      for await (const chunk of client.chatStream(messages, knobs, ac.signal)) {
        out += chunk;
      }
      out = clean(out, MAX_STORY_LEN);
      const invalid = validate(out);
      if (!invalid) {
        return NextResponse.json(
          { ok: true, story: out },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      lastProblem = invalid; // нарушение шаблона — повод для повторной попытки
    } catch (e) {
      lastProblem = e instanceof Error ? e.message : 'generation failed';
    } finally {
      clearTimeout(timer);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        `Модель вернула не по шаблону либо ответ не пришёл (${safeMessage(lastProblem ?? 'unknown')}). ` +
        'Попробуйте ещё раз или чуть переформулируйте описание.',
    },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  );
}
