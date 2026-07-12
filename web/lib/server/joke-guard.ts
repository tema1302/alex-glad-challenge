// Server-side guard кино-ответов CINE-PUN для /joker. Wrap'ит executeChat: аккумулирует
// токены первой строки (стрим клиенту НЕ идёт, пока не проверен маркер), валидирует
// маркер «🎬 Фильм (год) — сцена» сразу как закрылась первая \n, при провале — 1 retry
// (MAX_ATTEMPTS=2), затем fallback с валидным маркером. zh/CoT-leakage — log-only (R8).
//
// РЕАЛИЗАЦИЯ — ручной проход `iterator.next()` циклом while (ВАРИАНТ B плана rollback #1).
// НЕ используем `for await...of` с break: по спецификации ECMAScript (AsyncIteratorClose)
// break из for-await АВТОМАТИЧЕСКИ вызывает inner.return() → генератор закрывается в
// точке yield, последующий drain получает пустоту → клиент теряет всё после первой
// строки (rollback #1: dev-smoke 0/10, raw curl показал обрыв первой строки). Ручной
// next() даёт полный контроль: мы решаем, когда закрыть.
//
// Ключевая идея персиста: executeChat flush'ит (appendMessage user+assistant, updateSession
// usage) ПОСЛЕ stream-loop и ДО yield done. Значит abort inner через `iterator.return()`
// ДО done → flush НЕ выполняется → плохой ответ НЕ сохраняется в БД.
//
// 'server-only': весь модуль — server-side; regex/контракт в lib/shared/joker-marker.ts
// (client-safe, переиспользуется smoke-скриптом).
import 'server-only';
import type { SseEvent } from '../shared/sse';
import { hasJokerMarker, leakageSample } from '../shared/joker-marker';
import { executeChat } from './chat-adapter';
import type { ChatMessage, ChatParams } from './challenge';
import type { LlmPref } from './llm';

// Fallback с валидным маркером (parseBadge на клиенте отрендерит badge). Не пустой,
// не «шутник недоступен» без структуры — сохраняет UX-контракт «первая строка = кино».
const JOKER_FALLBACK =
  '🎬 Кино-Шутник отдыхает (2024) — техническая пауза\n' +
  'Не удалось подобрать кино-отсылку. Переформулируйте реплику — попробуем другую сцену.';

// 1 primary + ровно 1 retry (R2: не ×2 дальше — удвоение latency только на отказе).
const MAX_ATTEMPTS = 2;

// Opts тип дублирует executeChat (chat-adapter.ts инлайнит opts без выноса типа).
// DRY-нарушение осознанное: не трогаем chat-adapter ради export-типа (surgical).
type GuardedJokerOpts = {
  llm?: LlmPref;
  signal?: AbortSignal;
  systemBehavior?: 'bare' | 'default';
  fewShot?: ChatMessage[];
  temperature?: number;
  knobs?: ChatParams;
  clean?: boolean;
};

// null  = первая строка ещё не закрылась (накапливаем buf, клиенту НЕ стримим);
// valid = маркер ОК — passthrough включён, стримим токены до done;
// invalid / invalid-short = маркер НЕ валиден — abort + retry/fallback.
type Verdict = 'valid' | 'invalid' | 'invalid-short';

export async function* executeGuardedJoker(
  sessionId: string,
  text: string,
  opts: GuardedJokerOpts,
): AsyncGenerator<SseEvent> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const inner = executeChat(sessionId, text, opts);
    // Ручной проход (НЕ for-await): полный контроль над закрытием генератора.
    const iterator = inner[Symbol.asyncIterator]();
    let buf = '';
    let verdict: Verdict | null = null;

    while (true) {
      const res = await iterator.next();
      if (res.done) break; // генератор завершился сам (после последнего yield)
      const ev: SseEvent = res.value;

      if (ev.type === 'error') {
        // Проброс ошибки, не retry (транспортная/LLM-ошибка, не формат).
        yield ev;
        return;
      }

      if (ev.type === 'token') {
        if (verdict === null) {
          // Phase 1: аккумулируем первую строку, клиенту НЕ стримим.
          buf += ev.delta;
          const nl = buf.indexOf('\n');
          if (nl >= 0) {
            if (hasJokerMarker(buf.slice(0, nl))) {
              // ВАЛИДНО: включаем passthrough — отдаём накопленный буфер одним чанком.
              verdict = 'valid';
              yield { type: 'token', delta: buf };
              buf = '';
            } else {
              // НЕВАЛИДНО: abort inner ДО flush executeChat (плохой ответ не персистится).
              verdict = 'invalid';
              await iterator.return(undefined);
              break;
            }
          }
          // nl < 0: первая строка ещё не закрылась — продолжаем аккумулировать.
        } else {
          // verdict === 'valid': passthrough токенов клиенту в реальном времени.
          yield ev;
        }
        continue;
      }

      if (ev.type === 'done') {
        if (verdict === 'valid') {
          // Нормальный путь: маркер валиден, стрим шёл, done — финал. flush уже выполнен
          // в executeChat (это ОК — ответ валиден, персист welcome).
          leakageWarn(ev.answer);
          yield ev;
          return;
        }
        // verdict === null: короткий ответ без \n (done пришёл до первой строки).
        // Аномалия для joker (промпт обязывает \n), но обработаем. flush executeChat уже
        // выполнен (done идёт после flush) — отменять поздно. Проверим полный ответ.
        const answer = typeof ev.answer === 'string' ? ev.answer : buf;
        if (hasJokerMarker(answer)) {
          if (buf) yield { type: 'token', delta: buf };
          leakageWarn(answer);
          yield ev;
          return;
        }
        verdict = 'invalid-short';
        break;
      }

      // ev.type === 'stage': executeChat в joker-режиме stage не шлёт; пробрасываем,
      // если уже в passthrough (valid). До вердикта — глотаем (маркер-проверка важнее).
      if (verdict === 'valid') yield ev;
    }

    // Сюда — только при verdict !== 'valid' (invalid / invalid-short / null-после-break).
    console.warn(`[joker-guard] invalid marker (attempt ${attempt + 1})`);
    if (attempt === MAX_ATTEMPTS - 1) {
      console.warn('[joker-guard] fallback after retry');
      yield { type: 'token', delta: JOKER_FALLBACK };
      yield {
        type: 'done',
        answer: JOKER_FALLBACK,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }
    // иначе — цикл на retry с теми же opts (temp 0.9, без seed → non-deterministic).
  }
}

// zh/CoT-leakage detector (R8, log-only). Логирует ≤40 символов answer-семпла
// (answer = LLM-текст, НЕ секрет/URL/путь). Сервер-side console.warn не попадает в
// client bundle.
function leakageWarn(answer: string | undefined): void {
  if (!answer) return;
  const { has, sample } = leakageSample(answer);
  if (has) {
    console.warn('[joker-guard] zh/leakage detector', { sample: sample.slice(0, 40) });
  }
}
