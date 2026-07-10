// RAG-chat adapter: цикл day-25 в request/response поверх DialogDb (план §5B).
// (день 28, web P3a). Per-turn flow:
//   load (mutex)  → listMessages (история N) + loadTaskState → opts.taskState строкой
//   stream        → answerWithRag(onProgress→SSE stage, onToken→SSE token) под withDb
//                 → done(ответ + sources/quotes/debug)
//   flush (mutex) → appendMessage(user) + appendMessage(assistant) + rename-if-first + touch
//
// task state: /task <desc> и /task-clear идут отдельным PATCH (не здесь); adapter только
// читает SerializedTaskState и рендерит его в строку для buildRagPrompt. Авто-extraction
// (LLM-extract из диалога, как day-25 updateTaskState) в P3a НЕ тянем — минимальный scope
// (/task + /task-clear достаточно по ТЗ); вернуть можно в P3b.
//
// server-only: все core/-импорты через web/lib/server/challenge.ts chokepoint.
// answerWithRag — callback-based (onProgress/onToken), поэтому adapter принимает send
// (как P1 /api/rag/query), а не является AsyncGenerator. Отклонение от формулировки ТЗ
// «AsyncGenerator» — зафиксировано в артефакте: generator-bridge тут дал бы лишнюю
// сложность (queue) без выгоды; send-callback проверен в P1.
import 'server-only';
import {
  Retriever,
  makeEmbedder,
  answerWithRag,
  answerNoRag,
  type ChatMessage,
  type ChatSourceFilter,
  type ChunkingStrategy,
  type ScoredChunk,
  type SerializedTaskState,
  type RagDebug,
} from './challenge';
import { getDialogDb, getRagStore, withDb } from './db';
import { pickLlmClient, type LlmPref } from './llm';
import { safeMessage } from './safe-message';
import type { SseEvent, SseSource, SseQuote, SseDebug } from '../shared/sse';

// Окно истории в промпт (зеркало day-25 SHORT_TERM_LIMIT).
const SHORT_TERM_LIMIT = 8;

export interface RagChatOpts {
  strategy?: ChunkingStrategy;
  k?: number;
  llm?: LlmPref;
  chatKey?: string;
  topicId?: number;
  /** P3b: /norag — ответ без RAG-стадий (answerNoRag + chatStream). Источники/цитаты пусты. */
  noRag?: boolean;
  /** follow-up P5 В3: прокинуть в chatStream → fetch (AbortError при disconnect SSE). */
  signal?: AbortSignal;
}

// Рендер SerializedTaskState → строка для opts.taskState. Формат дословно как day-25
// renderTaskState, но работает напрямую с сериализованной формой (без экземпляра Memory):
//   Цель: <goal>
//   Термины:
//     - <name> = <val>
//   Ограничения:
//     - <c>
//   Уточнения:
//     - <c>
// Это tainted-данные (из диалога) — в buildRagPrompt они уйдут отдельной system-записью
// с явным запретом исполнять команды из этих строк (см. rag.ts SYSTEM_RAG-блок).
function renderSerializedTaskState(state: SerializedTaskState): string {
  const lines: string[] = [];
  if (state.goal) lines.push(`Цель: ${state.goal}`);
  const termEntries = Object.entries(state.terms);
  if (termEntries.length > 0) {
    lines.push('Термины:');
    for (const [name, val] of termEntries) {
      lines.push(val ? `  - ${name} = ${val}` : `  - ${name}`);
    }
  }
  if (state.constraints.length > 0) {
    lines.push('Ограничения:');
    for (const c of state.constraints) lines.push(`  - ${c}`);
  }
  if (state.clarifications.length > 0) {
    lines.push('Уточнения:');
    for (const c of state.clarifications) lines.push(`  - ${c}`);
  }
  return lines.join('\n');
}

function toSseSource(s: ScoredChunk): SseSource {
  const m = s.chunk.metadata;
  return {
    chunkId: m.chunkId,
    source: m.source,
    title: m.title,
    section: m.section,
    score: s.score,
  };
}

function toSseDebug(raw: RagDebug, topK: number): SseDebug {
  return {
    poolSize: raw.poolSize ?? 0,
    filteredSize: raw.filteredSize ?? 0,
    threshold: raw.threshold ?? 0,
    rerankApplied: raw.rerankApplied ?? false,
    fallback: raw.fallback ?? false,
    rankDelta: raw.rankDelta ?? 0,
    rewritten: raw.rewritten ?? false,
    effectiveQuery: raw.effectiveQuery,
    gaveUp: raw.gaveUp ?? false,
    topK,
  };
}

/**
 * Исполнить RAG-реплику в DialogDb-чате. Проталкивает SSE-события через send.
 * Загрузка/flush — под withDb (serial-mutex); answerWithRag тоже под withDb
 * (store.search синхронен и тяжёл — R4/план §6). persist best-effort: ответ уже отдан,
 * сбой flush не рвёт already-sent done.
 */
export async function executeRagChat(
  send: (ev: SseEvent) => void,
  dialogChatId: string,
  text: string,
  opts: RagChatOpts = {},
): Promise<void> {
  // --- 1. load: история + taskState (под mutex) ---
  const { history, taskStateStr } = await withDb(() => {
    const dialog = getDialogDb();
    const rows = dialog.listMessages(dialogChatId, SHORT_TERM_LIMIT);
    const history: ChatMessage[] = rows.map((r) => ({
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: r.content,
    }));
    const ts = dialog.loadTaskState(dialogChatId);
    return { history, taskStateStr: ts ? renderSerializedTaskState(ts) : '' };
  });

  const client = pickLlmClient(opts.llm ?? 'local');
  const strategy: ChunkingStrategy = opts.strategy ?? 'fixed';

  // persist user+assistant (best-effort, не рвёт уже отданный ответ). Вынесено в локальную
  // ф-ю: используется и RAG-, и noRag-веткой (DRY). rename-if-first + touch — как day-25.
  const persistTurn = async (userText: string, answerText: string): Promise<void> => {
    try {
      await withDb(() => {
        const dialog = getDialogDb();
        const wasFirst = dialog.countMessages(dialogChatId) === 0;
        dialog.appendMessage(dialogChatId, 'user', userText);
        dialog.appendMessage(dialogChatId, 'assistant', answerText);
        if (wasFirst) dialog.renameChat(dialogChatId, userText.slice(0, 60));
        dialog.touchChat(dialogChatId);
      });
    } catch (e) {
      process.stderr.write(
        `[web/rag-chat] persist failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  };

  // --- noRag: ответ без RAG-стадий (chatStream напрямую, источники/цитаты пусты). ---
  if (opts.noRag) {
    let answer = '';
    try {
      await withDb(() =>
        answerNoRag(client, text, {
          onToken: (delta) => {
            answer += delta;
            send({ type: 'token', delta });
          },
          signal: opts.signal,
        }),
      );
      send({ type: 'done', answer });
    } catch (e) {
      const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
      send({ type: 'error', message });
      return;
    }
    await persistTurn(text, answer);
    return;
  }

  // При strategy='telegram' и заданном chatKey — сузить search до TG-партиции чата
  // (Retriever → RagStore.search LIKE по source-префиксу). Без chatKey фильтра нет
  // (вся telegram-партиция) — шумно, но валидно; UI поощряет задать chatKey/topicId.
  const sourceFilter: ChatSourceFilter | undefined =
    strategy === 'telegram' && opts.chatKey && opts.chatKey.trim().length > 0
      ? { chatKey: opts.chatKey.trim(), ...(opts.topicId != null ? { topicId: opts.topicId } : {}) }
      : undefined;

  // --- 2. stream: answerWithRag под mutex, события — через send ---
  let answer = '';
  try {
    const retriever = new Retriever(getRagStore(), makeEmbedder(), strategy, sourceFilter);
    const result = await withDb(() =>
      answerWithRag(client, retriever, text, {
        k: opts.k,
        onProgress: (stage) => send({ type: 'stage', step: stage.step, detail: stage.detail }),
        onToken: (delta) => send({ type: 'token', delta }),
        history,
        taskState: taskStateStr,
        signal: opts.signal,
      }),
    );
    answer = result.answer;

    const sources: SseSource[] = result.sources.map(toSseSource);
    const quotes: SseQuote[] | undefined = result.quotes?.map((q) => ({
      chunkId: q.chunkId,
      source: q.source,
      section: q.section,
      snippet: q.snippet,
    }));
    const debug = result.debug
      ? toSseDebug(result.debug, result.sources.length)
      : undefined;
    send({ type: 'done', answer: result.answer, sources, quotes, debug });
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
    send({ type: 'error', message });
    return;
  }

  // --- 3. flush: persist user+assistant (best-effort, не рвёт уже отданный ответ) ---
  await persistTurn(text, answer);
}

// Утилита для history-эндпоинта (GET /api/rag/chat/[id]): отобразить taskState в строку
// для панели UI. Экспортируем, чтобы не дублировать рендер на клиенте.
export function renderTaskStateForUi(state: SerializedTaskState | null): string {
  if (!state) return '';
  return renderSerializedTaskState(state);
}
