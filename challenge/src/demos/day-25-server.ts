// День 25 — STDIO-MCP-сервер чата с RAG + памятью задачи.
//
// Поверхность: STDIO (JSON-RPC over stdin/stdout). Никакого HTTP/port/listen/auth —
// IPC-канал, не сеть (см. план решения 3). Переиспользует RagStore/Retriever/
// makeLocalLlmClient/answerWithRag из core/rag и updateTaskState/renderTaskState/
// serializeTaskState/deserializeTaskStateInto/extractKeywords из day-25.ts (DRY:
// одна и та же логика чата для CLI и MCP).
//
// 5 инструментов:
//   chat(message, chat_id?, cross_chat?) — один ход RAG-чата с историей+task state;
//     persist в dialog.sqlite; past-Q&A поиск по другим чатам. Возвращает
//     ответ/источники/цитаты/task_state/chat_id.
//   task-state(chat_id) — read-only снимок состояния чата.
//   list-chats() — список чатов.
//   new-chat(title?) — создать чат.
//   switch-chat(chat_id) — проверить существование чата.
//
// Сессии (Memory) в RAM-мапе на процесс; ПРИ первом обращении восстанавливаются из
// dialog.sqlite (если чат уже есть). debug/effQuery/куски промпта/ключи НИКОГДА не
// попадают в tool-result — только в stderr.
//
// Запуск (standalone): pnpm --filter challenge start -- day-25-server

import path from 'node:path';
import crypto from 'node:crypto';

import { loadEnvUpward } from '../core/env.js';
import type { LlmClient } from '../core/client.js';
import { msg } from '../core/types.js';
import type { ChatMessage } from '../core/types.js';
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
import { DialogDb } from '../core/dialogDb.js';
import {
  updateTaskState,
  renderTaskState,
  serializeTaskState,
  deserializeTaskStateInto,
  extractKeywords,
} from './day-25.js';

const RAG_DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const MEMORY_FILE_PATH = path.join(process.cwd(), '.data', 'day25-memory.json');
const DIALOG_DB_PATH = path.join(process.cwd(), '.data', 'dialog.sqlite');
const SHORT_TERM_LIMIT = 8;
const STRATEGY = 'fixed' as const;

interface RagContext {
  client: LlmClient;
  retriever: Retriever;
  store: RagStore;
  dialogDb: DialogDb;
}

let ragCtx: RagContext | null = null;

// Ленивая инициализация индекс/ретривер/клиент/dialogDb — ОДИН раз на процесс.
// Fail-fast: если индекс пуст — кидаем ДО того, как сервер начнёт отвечать на tool-вызовы.
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
    dialogDb: new DialogDb(DIALOG_DB_PATH),
  };
  return ragCtx;
}

// chatId → Memory (RAM-на-сессию). При первом обращении, если чат уже есть в БД,
// восстанавливаем последние N сообщений и task state. session_id — обратно-совместимый
// alias к chat_id (1:1).
const SESSIONS = new Map<string, Memory>();

function getOrCreateSession(chatId: string, dialogDb: DialogDb): Memory {
  let m = SESSIONS.get(chatId);
  if (!m) {
    m = new Memory({ filePath: MEMORY_FILE_PATH, shortTermLimit: SHORT_TERM_LIMIT });
    if (dialogDb.getChat(chatId)) {
      const msgs = dialogDb.listMessages(chatId, SHORT_TERM_LIMIT);
      for (const mm of msgs) {
        m.addMessage({ role: mm.role as ChatMessage['role'], content: mm.content });
      }
      const state = dialogDb.loadTaskState(chatId);
      if (state) deserializeTaskStateInto(state, m);
    }
    SESSIONS.set(chatId, m);
  }
  return m;
}

const chatTool: McpServerTool = {
  name: 'chat',
  description:
    'Один ход RAG-чата по мануалу EVOLUTE i-SPACE с учётом истории диалога и памяти задачи ' +
    '(цель/термины/ограничения). Сообщения и task state сохраняются в dialog.sqlite, переживают ' +
    'рестарт сервера. Опц. cross_chat=true (default) включает поиск прошлых Q&A по другим чатам. ' +
    'Возвращает ответ, источники, цитаты, обновлённый task state и chat_id. Параметр session_id — ' +
    'обратно-совместимый alias к chat_id.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Вопрос или сообщение пользователя.' },
      chat_id: {
        type: 'string',
        description: 'Идентификатор чата из ответа предыдущего вызова. Если не задан — создаётся новый чат.',
      },
      session_id: {
        type: 'string',
        description: 'Обратно-совместимый alias для chat_id (эквивалентен 1:1).',
      },
      cross_chat: {
        type: 'boolean',
        description: 'Искать ли прошлые Q&A по всем чатам (default: true).',
      },
    },
    required: ['message'],
  },
  handler: async (args) => {
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) {
      return { content: [{ type: 'text', text: 'message is required' }], isError: true };
    }
    const ctx = loadRag();
    const dialogDb = ctx.dialogDb;
    const chatId =
      (typeof args.chat_id === 'string' && args.chat_id.trim().length > 0 ? args.chat_id.trim() : '') ||
      (typeof args.session_id === 'string' && args.session_id.trim().length > 0 ? args.session_id.trim() : '') ||
      crypto.randomUUID();
    const crossChat = typeof args.cross_chat === 'boolean' ? args.cross_chat : true;
    const memory = getOrCreateSession(chatId, dialogDb);

    // Если чата ещё нет в БД — создаём (auto-create при первом ходе; R6 — auto-create
    // только здесь, не при старте сервера).
    if (!dialogDb.getChat(chatId)) {
      dialogDb.createChat(chatId, message.slice(0, 60));
    }

    // Past-Q&A retrieval ДО ответа (best-effort).
    let dialogContext = '';
    let pastQaCount = 0;
    if (crossChat) {
      const keywords = extractKeywords(message);
      if (keywords.length > 0) {
        try {
          const found = dialogDb.searchPastQa(keywords, chatId, 4);
          const pairs: { q: string; a: string }[] = [];
          for (const u of found) {
            const after = dialogDb.listMessageAfter(u.chatId, u.id, 1);
            if (after.length > 0 && after[0].role === 'assistant') {
              pairs.push({ q: u.content, a: after[0].content });
              if (pairs.length >= 2) break;
            }
          }
          pastQaCount = pairs.length;
          if (pairs.length > 0) {
            dialogContext = pairs.map((p) => `Q: ${p.q}\nA: ${p.a}`).join('\n\n');
          }
        } catch (e) {
          process.stderr.write(`[day-25-rag-chat] past-Q&A failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
      }
    }

    const taskState = renderTaskState(memory);
    const history = memory.shortTermMessages;
    const t0 = Date.now();
    // debug-лог только в stderr — НИКОГДА не возвращается клиенту (контрмера: tainted).
    process.stderr.write(
      `[day-25-rag-chat] chat=${chatId} history=${history.length} ` +
        `taskState=${taskState.length > 0 ? 'yes' : 'no'} cross=${crossChat ? 'on' : 'off'} ` +
        `pastQa=${pastQaCount} q="${message.slice(0, 60)}"\n`,
    );

    const rag = await answerWithRag(ctx.client, ctx.retriever, message, {
      k: 4,
      pool: 20,
      threshold: DEFAULT_RAG_THRESHOLD,
      history,
      taskState,
      dialogContext,
    });
    const dt = Date.now() - t0;
    memory.addMessage(msg.user(message));
    memory.addMessage(msg.assistant(rag.answer));

    // Persist в dialog.sqlite (best-effort).
    try {
      const wasFirst = dialogDb.countMessages(chatId) === 0;
      dialogDb.appendMessage(chatId, 'user', message);
      dialogDb.appendMessage(chatId, 'assistant', rag.answer);
      if (rag.debug?.gaveUp !== true) {
        await updateTaskState(memory, message, rag.answer, ctx.client);
        dialogDb.upsertTaskState(chatId, serializeTaskState(memory));
      }
      if (wasFirst) dialogDb.renameChat(chatId, message.slice(0, 60));
      dialogDb.touchChat(chatId);
    } catch (e) {
      process.stderr.write(`[day-25-rag-chat] persist failed: ${e instanceof Error ? e.message : String(e)}\n`);
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
    if (pastQaCount > 0) {
      parts.push('', `Прошлые Q&A: найдено ${pastQaCount} пар из других чатов (вставлены в промпт как данные).`);
    }
    parts.push('', 'Task state:', tsView.length > 0 ? tsView : '(пуст)');
    // chat_id = session_id (1:1 alias). Возвращаем оба для обратной совместимости.
    parts.push('', `chat_id: ${chatId}`);
    parts.push('', `session_id: ${chatId}`);
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  },
};

const taskStateTool: McpServerTool = {
  name: 'task-state',
  description:
    'Read-only снимок состояния чата: цель / термины / ограничения / уточнения и размер истории. ' +
    'Не модифицирует состояние. Параметр chat_id — идентификатор чата (session_id — alias). ' +
    'Если чат не загружен в RAM, состояние читается прямо из dialog.sqlite.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'Идентификатор существующего чата.' },
      session_id: { type: 'string', description: 'Обратно-совместимый alias для chat_id.' },
    },
    required: [],
  },
  handler: async (args) => {
    const ctx = loadRag();
    const cid =
      (typeof args.chat_id === 'string' && args.chat_id.trim().length > 0 ? args.chat_id.trim() : '') ||
      (typeof args.session_id === 'string' && args.session_id.trim().length > 0 ? args.session_id.trim() : '');
    if (!cid) {
      return { content: [{ type: 'text', text: 'chat_id (или session_id) is required' }], isError: true };
    }
    // Берём snapshot сессии из RAM (если была); иначе читаем прямо из БД.
    let goal = '';
    let shortTermCount = 0;
    const memory = SESSIONS.get(cid);
    if (memory) {
      goal = renderTaskState(memory);
      shortTermCount = memory.snapshot().shortTermCount;
    } else {
      const state = ctx.dialogDb.loadTaskState(cid);
      if (!state) {
        return { content: [{ type: 'text', text: `chat not found: ${cid}` }], isError: true };
      }
      const fake = new Memory({ filePath: MEMORY_FILE_PATH, shortTermLimit: SHORT_TERM_LIMIT });
      deserializeTaskStateInto(state, fake);
      goal = renderTaskState(fake);
      shortTermCount = ctx.dialogDb.countMessages(cid);
    }
    const parts = [
      'Task state:',
      goal.length > 0 ? goal : '(пуст)',
      '',
      `shortTermCount: ${shortTermCount}`,
      `chat_id: ${cid}`,
      `session_id: ${cid}`,
    ];
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  },
};

const listChatsTool: McpServerTool = {
  name: 'list-chats',
  description: 'Список сохранённых чатов (id | title | msgs | updated). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const ctx = loadRag();
    const chats = ctx.dialogDb.listChats(50);
    if (chats.length === 0) {
      return { content: [{ type: 'text', text: '(нет сохранённых чатов)' }] };
    }
    const lines = chats.map(
      (c) => `${c.id} | ${c.msg_count} msgs | ${c.title} | ${c.updated_at}`,
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};

const newChatTool: McpServerTool = {
  name: 'new-chat',
  description: 'Создать новый пустой чат и вернуть его chat_id. Title опционален.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Заголовок чата (необязательно).' },
    },
    required: [],
  },
  handler: async (args) => {
    const ctx = loadRag();
    const id = crypto.randomUUID();
    const title = typeof args.title === 'string' && args.title.trim().length > 0 ? args.title.trim() : 'untitled';
    ctx.dialogDb.createChat(id, title);
    return { content: [{ type: 'text', text: `chat_id: ${id}\ntitle: ${title}` }] };
  },
};

const switchChatTool: McpServerTool = {
  name: 'switch-chat',
  description:
    'Проверить существование чата и поднять его данные в RAM-сессию (история + task state). ' +
    'Read-only относительно БД — не модифицирует чат.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'Идентификатор существующего чата.' },
    },
    required: ['chat_id'],
  },
  handler: async (args) => {
    const ctx = loadRag();
    const cid = typeof args.chat_id === 'string' ? args.chat_id.trim() : '';
    if (!cid) {
      return { content: [{ type: 'text', text: 'chat_id is required' }], isError: true };
    }
    const chat = ctx.dialogDb.getChat(cid);
    if (!chat) {
      return { content: [{ type: 'text', text: `chat not found: ${cid}` }], isError: true };
    }
    // Поднимаем в RAM (idempotent — если уже загружен, не перезаписываем).
    getOrCreateSession(cid, ctx.dialogDb);
    const count = ctx.dialogDb.countMessages(cid);
    return {
      content: [{
        type: 'text',
        text: `switched to chat ${cid} | ${chat.title} | ${count} messages`,
      }],
    };
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
    tools: [chatTool, taskStateTool, listChatsTool, newChatTool, switchChatTool],
  });
  try {
    await server.start();
  } finally {
    ctx.dialogDb.close();
    ctx.store.close();
  }
}
