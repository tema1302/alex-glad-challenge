// Zod-схемы форм/Route-параметров. Доступны клиенту (без server-only, без core/).
// P1+: RAG-query + todo. Валидация на границе — инвариант CLAUDE.md.

import { z } from 'zod';

export const ragQuerySchema = z.object({
  query: z.string().trim().min(1, 'Введите вопрос').max(2000, 'Слишком длинный запрос'),
  strategy: z.enum(['fixed', 'structure', 'telegram']).optional(),
  k: z.coerce.number().int().min(1).max(20).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
  noRag: z.boolean().optional(),
});
export type RagQueryInput = z.infer<typeof ragQuerySchema>;

export const todoAddSchema = z.object({
  text: z.string().trim().min(1, 'Текст обязателен').max(500),
  recurring: z.enum(['daily', 'weekly', 'hourly']).nullable().optional(),
  // Для recurring='hourly': интервал в часах. По умолчанию 1 (наследует getDueTodos-логику).
  intervalHours: z.coerce.number().int().min(1).max(168).optional(),
});
export type TodoAddInput = z.infer<typeof todoAddSchema>;

// --- P2: Chat-агент ---

// Стратегия контекста (зеркало repl.ts STRATEGY_NAMES).
export const strategyNameSchema = z.enum(['full', 'sliding', 'sticky', 'branching']);
export type StrategyName = z.infer<typeof strategyNameSchema>;

// POST /api/chat/[sessionId] — отправить реплику (SSE-стрим).
export const chatSendSchema = z.object({
  text: z.string().trim().min(1, 'Введите сообщение').max(8000, 'Слишком длинное сообщение'),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type ChatSendInput = z.infer<typeof chatSendSchema>;

// POST /api/chat — создать сессию.
export const chatSessionCreateSchema = z.object({
  strategy: strategyNameSchema.optional(),
  system: z.string().trim().max(2000).optional(),
  windowSize: z.coerce.number().int().min(1).max(100).optional(),
  memoryEnabled: z.boolean().optional(),
});
export type ChatSessionCreateInput = z.infer<typeof chatSessionCreateSchema>;

// PATCH /api/chat/[sessionId] — обновить настройки сессии (без mutations памяти — это P2b).
export const chatSessionUpdateSchema = z.object({
  strategy: strategyNameSchema.optional(),
  system: z.string().trim().max(2000).optional(),
  windowSize: z.coerce.number().int().min(1).max(100).optional(),
  memoryEnabled: z.boolean().optional(),
  reset: z.boolean().optional(),
});
export type ChatSessionUpdateInput = z.infer<typeof chatSessionUpdateSchema>;

// --- P2b: Chat-фичи — mutations (memory/branch/profile/constraints) ---

export const constraintTypeSchema = z.enum(['architecture', 'tech_decision', 'stack', 'business', 'custom']);
export type ConstraintTypeInput = z.infer<typeof constraintTypeSchema>;

// POST /api/chat/[sessionId]/memory
export const memoryActionSchema = z.object({
  action: z.enum(['remember', 'forget', 'task', 'task-add', 'task-clear', 'fact-rm', 'on', 'off']),
  key: z.string().trim().min(1).max(200).optional(),
  value: z.string().trim().max(2000).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type MemoryActionInput = z.infer<typeof memoryActionSchema>;

// POST /api/chat/[sessionId]/branch
export const branchActionSchema = z.object({
  action: z.enum(['checkpoint', 'switch']),
  label: z.string().trim().min(1).max(100).optional(),
  id: z.coerce.number().int().min(0).optional(),
});
export type BranchActionInput = z.infer<typeof branchActionSchema>;

// POST /api/chat/[sessionId]/profile
export const profileActionSchema = z.object({
  action: z.enum(['use', 'edit', 'new', 'copy', 'delete', 'reset', 'note']),
  name: z.string().trim().min(1).max(100).optional(),
  base: z.string().trim().min(1).max(100).optional(),
  instruction: z.string().trim().min(1).max(2000).optional(),
  text: z.string().trim().min(1).max(2000).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type ProfileActionInput = z.infer<typeof profileActionSchema>;

// POST /api/chat/[sessionId]/constraints
export const constraintsActionSchema = z.object({
  action: z.enum(['add', 'rm']),
  type: constraintTypeSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  id: z.string().trim().min(1).max(100).optional(),
});
export type ConstraintsActionInput = z.infer<typeof constraintsActionSchema>;

// --- P3a: RAG-chat (DialogDb session) + TG top (read-only) + chat-alias catalog ---

// POST /api/rag/chat — создать DialogDb-чат.
export const ragChatCreateSchema = z.object({
  title: z.string().trim().max(120).optional(),
});
export type RagChatCreateInput = z.infer<typeof ragChatCreateSchema>;

// POST /api/rag/chat/[dialogChatId] — RAG-реплика (SSE-стрим).
// strategy='telegram' включает ChatSourceFilter (нужен chatKey; topicId опц.).
export const ragChatSendSchema = z.object({
  text: z.string().trim().min(1, 'Введите сообщение').max(8000, 'Слишком длинное сообщение'),
  strategy: z.enum(['fixed', 'structure', 'telegram']).optional(),
  k: z.coerce.number().int().min(1).max(20).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
  chatKey: z.string().trim().max(200).optional(),
  topicId: z.coerce.number().int().min(0).optional(),
  // P3b: /norag — ответ без RAG-стадий (answerNoRag + chatStream). Зеркало /api/rag/query.
  noRag: z.boolean().optional(),
});
export type RagChatSendInput = z.infer<typeof ragChatSendSchema>;

// PATCH /api/rag/chat/[dialogChatId] — переименование + task state (/-команды).
// task — задать goal (task state остаётся: terms/constraints не трогаем здесь);
// taskClear — сбросить весь task state.
export const ragChatPatchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  task: z.string().trim().max(500).optional(),
  taskClear: z.boolean().optional(),
});
export type RagChatPatchInput = z.infer<typeof ragChatPatchSchema>;

// GET /api/tg/top — топ-сообщения топика (read-only).
export const tgTopSchema = z.object({
  chatKey: z.string().trim().min(1, 'chatKey обязателен').max(200),
  topicId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  by: z.enum(['reactions', 'date']).optional(),
});
export type TgTopInput = z.infer<typeof tgTopSchema>;

// POST /api/rag/chats — alias add/rm.
export const aliasActionSchema = z.object({
  action: z.enum(['add', 'rm']),
  name: z.string().trim().min(1, 'Имя alias обязательно').max(100),
  chatKey: z.string().trim().max(200).optional(),
  topicId: z.coerce.number().int().min(0).optional(),
});
export type AliasActionInput = z.infer<typeof aliasActionSchema>;

// --- P4a: Блог-ядро (news pipeline + posts + style) ---

// POST /api/blog/news (SSE) — news-pipeline opts. Зеркало cli runNewsCommand flags
// (--hours/--top/--for). Поле `forIndex` соответствует `writeForIndex` в runNewsPipeline
// (имя `for` зарезервировано, не используем как ключ-деструктуризацию).
export const newsOptsSchema = z.object({
  hours: z.coerce.number().int().min(1, 'hours: 1..168').max(168).optional(),
  top: z.coerce.number().int().min(1, 'top: 1..50').max(50).optional(),
  forIndex: z.coerce.number().int().min(0).optional(),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type NewsOptsInput = z.infer<typeof newsOptsSchema>;

// PATCH /api/blog/posts/[id] — обновить контент поста.
export const postUpdateSchema = z.object({
  content: z.string().trim().min(1, 'Контент обязателен').max(8000, 'Слишком длинный пост'),
});
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

// POST /api/blog/style — образец стиля.
export const styleSampleSchema = z.object({
  text: z.string().trim().min(1, 'Текст обязателен').max(4000, 'Слишком длинный образец'),
});
export type StyleSampleInput = z.infer<typeof styleSampleSchema>;

// --- P4b: FSM pipeline-state + scout ---

// 6 стадий FSM (зеркало core/agents/stateMachine.ts PipelineStage).
export const pipelineStageSchema = z.enum([
  'idle',
  'planning',
  'execution',
  'validation',
  'revision',
  'done',
]);
export type PipelineStageInput = z.infer<typeof pipelineStageSchema>;

// POST /api/blog/pipeline — transition | reset. `to` обязателен для transition.
export const pipelineActionSchema = z
  .object({
    action: z.enum(['transition', 'reset']),
    to: pipelineStageSchema.optional(),
    detail: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.action !== 'transition' || d.to !== undefined, {
    message: 'Стадия назначения (to) обязательна для transition',
    path: ['to'],
  });
export type PipelineActionInput = z.infer<typeof pipelineActionSchema>;

// POST /api/blog/scout (SSE) — opts для runSourceAgents. enableTelegram по умолчанию
// выключен на уровне route (MTProto/TG_SESSION — credential-тяжёлый путь); Forum — вкл.
export const scoutOptsSchema = z.object({
  hours: z.coerce.number().int().min(1, 'hours: 1..168').max(168).optional(),
  topK: z.coerce.number().int().min(1, 'topK: 1..10').max(10).optional(),
  query: z.string().trim().max(500).optional(),
  enableTelegram: z.boolean().optional(),
  enableForum: z.boolean().optional(),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type ScoutOptsInput = z.infer<typeof scoutOptsSchema>;

// --- P5: MCP admin + agent + summary + settings ---

// POST /api/mcp/call — generic вызов MCP-инструмента. args = user-supplied JSON, идёт
// КАК ДАННЫЕ (JSON-RPC params в McpHttpClient.callTool), не исполняется как код.
export const mcpCallSchema = z.object({
  tool: z.string().trim().min(1, 'Имя инструмента обязательно').max(200),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type McpCallInput = z.infer<typeof mcpCallSchema>;

// POST /api/agent — single-shot вопрос LLM через core/Agent (stateless, без сессии).
export const agentSchema = z.object({
  prompt: z.string().trim().min(1, 'Введите вопрос').max(8000, 'Слишком длинный промпт'),
  llm: z.enum(['local', 'cloud']).optional(),
});
export type AgentInput = z.infer<typeof agentSchema>;

// POST /api/summary — опубликовать сводку ожидающих задач в TG-канал.
// publish:true + isTelegramConfigured() → publishPost(summary). Иначе — только текст.
export const summaryPublishSchema = z.object({
  publish: z.boolean().optional(),
});
export type SummaryPublishInput = z.infer<typeof summaryPublishSchema>;

// POST /api/settings — preference client→cookie. MCP_URL НЕ принимается (read-only, §8 SSRF).
export const settingsSchema = z.object({
  modelPref: z.enum(['local', 'cloud']).optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

// --- P3b: TG collect + RAG index/index-tg + TG publish ---

// POST /api/tg/collect (SSE) — single-topic MTProto-сбор в tg.sqlite. Зеркало cli tg-collect.
// topicId опционален: resolveChatTopic бросает понятную ошибку, если он не извлекается
// из chatRef (t.me/<chat>/<topicId>) и не задан явно (кли требует topicId для forum).
export const tgCollectSchema = z.object({
  chatRef: z.string().trim().min(1, 'chatRef обязателен').max(200),
  topicId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1, 'limit: 1..5000').max(5000).optional(),
  reset: z.boolean().optional(),
});
export type TgCollectInput = z.infer<typeof tgCollectSchema>;

// POST /api/rag/index (SSE) — индексация docs (fixed/structure). Мутирует rag.sqlite.
// strategies обязательно и непустое: web = destructive-action, полный reindex без явного
// выбора запрещён (memory-инвариант «индекс собран вручную, не реиндексировать без запроса»).
export const ragIndexSchema = z.object({
  strategies: z.array(z.enum(['fixed', 'structure'])).min(1, 'Укажите хотя бы одну стратегию'),
});
export type RagIndexInput = z.infer<typeof ragIndexSchema>;

// POST /api/rag/index-tg (SSE) — индексация telegram. ⚠️ LANDMINE:
// single-topic (topicId задан) при reset:true чистит ВСЮ telegram-партицию (clearStrategy).
// whole-chat (topicId не задан) чистит только чат (clearBySourcePrefix) — безопаснее.
export const ragIndexTgSchema = z.object({
  chatRef: z.string().trim().min(1, 'chatRef обязателен').max(200),
  topicId: z.coerce.number().int().min(0).optional(),
  reset: z.boolean().optional(),
  limit: z.coerce.number().int().min(1, 'limit: 1..5000').max(5000).optional(),
  wholeChat: z.boolean().optional(),
  top: z.coerce.number().int().min(1, 'top: 1..5000').max(5000).optional(),
});
export type RagIndexTgInput = z.infer<typeof ragIndexTgSchema>;

// POST /api/telegram/publish — отправка текста в TG-канал (Bot API). Реальный внешний эффект.
export const tgPublishSchema = z.object({
  text: z.string().trim().min(1, 'Текст обязателен').max(4000, 'TG: до 4096 символов'),
});
export type TgPublishInput = z.infer<typeof tgPublishSchema>;

// --- Day 36: admin-auth ---

// POST /api/auth/login — пароль единственного админа. Без .trim(): пробелы в
// пароле легальны (граница = длина, валидация — на сервере).
export const loginSchema = z.object({
  password: z.string().min(1, 'Введите пароль').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
