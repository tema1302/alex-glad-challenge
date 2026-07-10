// Chat-adapter: связка персистентной web-сессии с core/ Memory+strategy+profile+constraints.
// (день 28, web P2). per-request flow (план §5A):
//   load(sessionId)  → hydrate Memory/strategy/profile/constraints (read-only context)
//                    → buildContext (как repl.ts: constraints + profile + structural + history)
//                    → client.chatStream(context) → SSE token-события
//                    → flush: persist user+assistant реплик в web_messages, usage++.
//
// Long-term memory / profiles / constraints НЕ мутируются здесь — они читаются для контекста
// и мутируются только их собственными action'ами (P2b: /remember /task /profile-use /constraint).
// Memory.short-term/working подаются external (класс Memory НЕ правится — surgical).
//
// server-only: все импорты core/ через web/lib/server/challenge.ts chokepoint.
import 'server-only';
import {
  Memory,
  ProfileManager,
  Constraints,
  FullHistory,
  SlidingWindow,
  StickyFacts,
  Branching,
  msg,
  dataPath,
  type ChatMessage,
  type ContextStrategy,
} from './challenge';
import { getWebSessionStore, type StrategyName, type Usage } from './web-session-store';
import { withDb } from './db';
import { pickLlmClient, type LlmPref } from './llm';
import { safeMessage } from './safe-message';
import type { SseEvent, SseUsage } from '../shared/sse';

// Структурный system (день 14 из repl.ts) — заставляет LLM думать по этапам.
// Дословно из repl.ts:219-229 (не редактируется — reuse).
const STRUCTURAL_SYSTEM = msg.system(
  'СТРУКТУРНЫЙ РЕЖИМ. Каждый твой ответ следует шаблону:\n' +
  '1. ПЛАН — кратко: что собираешься сделать (1-2 строки).\n' +
  '2. ВАЛИДАЦИЯ — проверка: хватает ли данных? Нет ли противоречий?\n' +
  '3. ОТВЕТ — сам результат.\n\n' +
  'Правила:\n' +
  '- НЕ перепрыгивай к ответу без плана.\n' +
  '- Если данных недостаточно — скажи это в валидации и спроси.\n' +
  '- План и валидация — КРАТКО (по 1-2 строки), не раздувай.\n' +
  '- Отвечай на том же языке, что и пользователь.\n' +
  '- Для простых вопросов (калькулятор, факт) план может быть в одно слово.',
);

function makeStrategy(name: StrategyName, windowSize: number): ContextStrategy {
  switch (name) {
    case 'sliding': return new SlidingWindow(windowSize);
    case 'sticky': return new StickyFacts(windowSize);
    case 'branching': return new Branching();
    case 'full':
    default: return new FullHistory();
  }
}

// Аппроксимация token-count по символам (≈4 char/token для русского/английского смешанного текста).
// chatStream не возвращает usage (менять core/ в P2 запрещено); для локального usage-счётчика
// достаточна грубая оценка. Отмечено в артефакте как отклонение.
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function accumulateUsage(acc: Usage, add: Usage): Usage {
  return {
    prompt_tokens: acc.prompt_tokens + add.prompt_tokens,
    completion_tokens: acc.completion_tokens + add.completion_tokens,
    total_tokens: acc.total_tokens + add.total_tokens,
  };
}

export interface ExecuteChatResult {
  answer: string;
  usage: SseUsage;
}

/**
 * Исполнить реплику в сессии: build context → stream токенов → flush.
 * Yield'ит SSE-события (token, done, error). Все .data-обращения — под withDb (serial-mutex);
 * chatStream идёт без mutex (R4-аналог плана §6: для 1-юзер локально приемлемо).
 *
 * opts.signal (follow-up P5 В3): прокидывается в chatStream → fetch. При disconnect
 * клиентского SSE LLM-запрос обрывается чисто (AbortError), без orphan-дожигания токенов.
 */
export async function* executeChat(
  sessionId: string,
  text: string,
  opts: { llm?: LlmPref; signal?: AbortSignal } = {},
): AsyncGenerator<SseEvent> {
  // --- load (под mutex) ---
  const data = await withDb(() => getWebSessionStore().load(sessionId));
  if (!data) {
    yield { type: 'error', message: 'Сессия не найдена' };
    return;
  }

  // --- hydrate (in-memory, без БД) ---
  const memory = new Memory({ filePath: dataPath('memory.json'), shortTermLimit: data.windowSize });
  memory.loadLongTerm();
  if (data.task) memory.setTask(data.task);
  for (const [k, v] of Object.entries(data.working)) memory.setWorkingFact(k, v);

  const strategy = makeStrategy(data.strategy, data.windowSize);
  // Короткая история (web_messages) → feed в strategy и (для memory-mode) в memory.shortTerm.
  // System-реплик в web_messages нет (system хранится отдельно в web_sessions.system_prompt).
  for (const m of data.messages) {
    const cm: ChatMessage = { role: m.role, content: m.content };
    strategy.addMessage(cm);
    if (data.memoryEnabled) memory.addMessage(cm);
  }

  const profile = new ProfileManager(dataPath('profiles'));
  const profiles = profile.list();
  if (data.activeProfile && profiles.includes(data.activeProfile)) {
    profile.load(data.activeProfile);
  } else if (profiles.length > 0) {
    profile.load(profiles.includes('default') ? 'default' : profiles[0]);
  }

  const constraints = new Constraints(dataPath('constraints.json'));
  constraints.load();

  // --- build context (как repl.ts, с улучшением: session.system явно в начале) ---
  const systemPrompt = data.system || '';
  // Добавляем ТЕКУЩУЮ реплику пользователя в короткую историю перед сборкой контекста.
  memory.addMessage(msg.user(text));
  strategy.addMessage(msg.user(text));

  const constraintMsgs = constraints.toSystemMessages();
  const profileMsg = msg.system(profile.toSystemBlock());

  let context: ChatMessage[];
  if (data.memoryEnabled) {
    // memory.context уже включает: system + long-term + working + short-term (с новой user-репликой).
    context = [...constraintMsgs, profileMsg, STRUCTURAL_SYSTEM, ...memory.context(systemPrompt)];
  } else {
    // strategy.context — только сообщения; system-промпт добавляем явно (улучшение над repl,
    // где strategy-mode упускает session.system из контекста).
    context = [...constraintMsgs, msg.system(systemPrompt), profileMsg, STRUCTURAL_SYSTEM, ...strategy.context()];
  }

  const client = pickLlmClient(opts.llm ?? 'local');

  // --- stream (без mutex) ---
  let answer = '';
  try {
    for await (const delta of client.chatStream(context, { temperature: 0.7 }, opts.signal)) {
      answer += delta;
      yield { type: 'token', delta };
    }
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
    yield { type: 'error', message };
    return;
  }

  // --- usage (аппроксимация) + flush (под mutex) ---
  const promptText = context.map((m) => m.content).join('');
  const deltaUsage: Usage = {
    prompt_tokens: approxTokens(promptText),
    completion_tokens: approxTokens(answer),
    total_tokens: 0,
  };
  deltaUsage.total_tokens = deltaUsage.prompt_tokens + deltaUsage.completion_tokens;
  const total = accumulateUsage(data.usage, deltaUsage);

  await withDb(() => {
    const s = getWebSessionStore();
    // Branching: реплики пишутся в активную ветку (web_branches). Остальные стратегии — в web_messages.
    if (data.strategy === 'branching') {
      s.ensureMainBranch(sessionId);
      s.appendBranchMessage(sessionId, 'user', text);
      s.appendBranchMessage(sessionId, 'assistant', answer);
    } else {
      s.appendMessage(sessionId, 'user', text);
      s.appendMessage(sessionId, 'assistant', answer);
    }
    s.updateSession(sessionId, { usage: total });
  });

  yield { type: 'done', answer, usage: total };
}
