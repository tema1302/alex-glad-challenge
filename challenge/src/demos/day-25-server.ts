// День 25 — STDIO-MCP-сервер чата с RAG + памятью задачи.
//
// Поверхность: STDIO (JSON-RPC over stdin/stdout). Никакого HTTP/port/listen/auth —
// IPC-канал, не сеть (см. план решения 3). Переиспользует RagStore/Retriever/
// makeLocalLlmClient/answerWithRag из core/rag и updateTaskState/renderTaskState
// из day-25.ts (DRY: одна и та же логика чата для CLI и MCP).
//
// 2 инструмента:
//   chat(message, session_id?) — один ход RAG-чата с историей+task state; возвращает
//     ответ/источники/цитаты/task_state/session_id.
//   task-state(session_id) — read-only снимок состояния сессии.
//
// Сессии (Memory) в RAM-мапе на процесс; между рестартами сервера не переживаются.
// debug/effQuery/куски промпта/ключи НИКОГДА не попадают в tool-result — только в stderr.
//
// Запуск (standalone): pnpm --filter challenge start -- day-25-server

import path from 'node:path';
import crypto from 'node:crypto';

import { loadEnvUpward } from '../core/env.js';
import type { LlmClient } from '../core/client.js';
import { msg } from '../core/types.js';
import { Memory } from '../core/memory.js';
import { McpStdioServer } from '../core/mcpServer.js';
import type { McpServerTool } from '../core/mcpServer.js';
import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  answerWithRag,
  DEFAULT_RAG_THRESHOLD,
} from '../core/rag/index.js';
import { updateTaskState, renderTaskState } from './day-25.js';

const RAG_DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const MEMORY_FILE_PATH = path.join(process.cwd(), '.data', 'day25-memory.json');
const SHORT_TERM_LIMIT = 8;
const STRATEGY = 'fixed' as const;

interface RagContext {
  client: LlmClient;
  retriever: Retriever;
  store: RagStore;
}

let ragCtx: RagContext | null = null;

// Ленивая инициализация индекс/ретривер/клиент — ОДИН раз на процесс. Fail-fast:
// если индекс пуст — кидаем ДО того, как сервер начнёт отвечать на tool-вызовы.
function loadRag(): RagContext {
  if (ragCtx) return ragCtx;
  const store = new RagStore(RAG_DB_PATH);
  const count = store.count(STRATEGY);
  if (count === 0) {
    store.close();
    throw new Error(
      'Индекс пуст: .data/rag.sqlite не содержит чанков стратегии ' + STRATEGY +
        '. Прогоните rag index перед стартом day-25-server.',
    );
  }
  ragCtx = {
    client: makeLocalLlmClient(),
    retriever: new Retriever(store, makeEmbedder(), STRATEGY),
    store,
  };
  return ragCtx;
}

// sessionId → Memory (RAM-на-сессию). loadLongTerm/saveLongTerm НЕ вызываются.
const SESSIONS = new Map<string, Memory>();

function getOrCreateSession(sessionId: string): Memory {
  let m = SESSIONS.get(sessionId);
  if (!m) {
    m = new Memory({ filePath: MEMORY_FILE_PATH, shortTermLimit: SHORT_TERM_LIMIT });
    SESSIONS.set(sessionId, m);
  }
  return m;
}

const chatTool: McpServerTool = {
  name: 'chat',
  description:
    'Один ход RAG-чата по мануалу EVOLUTE i-SPACE с учётом истории диалога и памяти задачи ' +
    '(цель/термины/ограничения). Возвращает ответ, источники, цитаты и обновлённый task state. ' +
    'Сессия (история + task state) хранится в RAM сервера; передавайте session_id из ответа ' +
    'для продолжения диалога.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Вопрос или сообщение пользователя.' },
      session_id: {
        type: 'string',
        description: 'Идентификатор сессии из ответа предыдущего вызова. Если не задан — создаётся новая сессия.',
      },
    },
    required: ['message'],
  },
  handler: async (args) => {
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) {
      return { content: [{ type: 'text', text: 'message is required' }], isError: true };
    }
    const sessionId =
      typeof args.session_id === 'string' && args.session_id.trim().length > 0
        ? args.session_id.trim()
        : crypto.randomUUID();
    const memory = getOrCreateSession(sessionId);
    const ctx = loadRag();

    const taskState = renderTaskState(memory);
    const history = memory.shortTermMessages;
    const t0 = Date.now();
    // debug-лог только в stderr — НИКОГДА не возвращается клиенту (контрмера: tainted).
    process.stderr.write(
      `[day-25-rag-chat] session=${sessionId} history=${history.length} ` +
        `taskState=${taskState.length > 0 ? 'yes' : 'no'} q="${message.slice(0, 60)}"\n`,
    );

    const rag = await answerWithRag(ctx.client, ctx.retriever, message, {
      k: 4,
      pool: 20,
      threshold: DEFAULT_RAG_THRESHOLD,
      history,
      taskState,
    });
    const dt = Date.now() - t0;
    memory.addMessage(msg.user(message));
    memory.addMessage(msg.assistant(rag.answer));
    if (rag.debug?.gaveUp !== true) {
      await updateTaskState(memory, message, rag.answer, ctx.client);
    }
    process.stderr.write(
      `[day-25-rag-chat] done in ${dt}ms sources=${rag.sources.length} ` +
        `guard=${rag.debug?.gaveUp === true ? 'yes' : 'no'}\n`,
    );

    // Сборка text-ответа. ВАЖНО: debug/effectiveQuery/куски промпта НЕ попадают сюда.
    const srcLines = rag.sources.map(
      (s, i) => `[${i + 1}] ${s.chunk.metadata.section} (score=${s.score.toFixed(2)}, source=${s.chunk.metadata.source})`,
    );
    const quoteLines = (rag.quotes ?? []).map((qq) => `- [${qq.chunkId}] ${qq.snippet.replace(/\s+/g, ' ')}`);
    const tsView = renderTaskState(memory);
    const parts: string[] = [
      rag.answer,
      '',
      'Источники:',
      srcLines.length > 0 ? srcLines.join('\n') : '(нет — сработал guard «не знаю»)',
    ];
    if (quoteLines.length > 0) {
      parts.push('', 'Цитаты:', quoteLines.join('\n'));
    }
    parts.push('', 'Task state:', tsView.length > 0 ? tsView : '(пуст)');
    parts.push('', `session_id: ${sessionId}`);
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  },
};

const taskStateTool: McpServerTool = {
  name: 'task-state',
  description:
    'Read-only снимок состояния сессии: цель / термины / ограничения / уточнения и размер истории. ' +
    'Не модифицирует состояние. Используется для инспекции памяти задачи без хода чата.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Идентификатор существующей сессии.' },
    },
    required: ['session_id'],
  },
  handler: async (args) => {
    const sid = typeof args.session_id === 'string' ? args.session_id.trim() : '';
    if (!sid) {
      return { content: [{ type: 'text', text: 'session_id is required' }], isError: true };
    }
    const memory = SESSIONS.get(sid);
    if (!memory) {
      return { content: [{ type: 'text', text: `session not found: ${sid}` }], isError: true };
    }
    const ts = renderTaskState(memory);
    const snap = memory.snapshot();
    const parts = [
      'Task state:',
      ts.length > 0 ? ts : '(пуст)',
      '',
      `shortTermCount: ${snap.shortTermCount}`,
      `session_id: ${sid}`,
    ];
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  },
};

export async function runDay25Server(): Promise<void> {
  loadEnvUpward();
  const ctx = loadRag();
  process.stderr.write(
    `[day-25-rag-chat] STDIO-MCP server starting (strategy=${STRATEGY}, ` +
      `shortTermLimit=${SHORT_TERM_LIMIT}). Индекс открыт на чтение.\n`,
  );
  const server = new McpStdioServer({
    name: 'day-25-rag-chat',
    version: '1.0.0',
    tools: [chatTool, taskStateTool],
  });
  await server.start();
  ctx.store.close();
}
