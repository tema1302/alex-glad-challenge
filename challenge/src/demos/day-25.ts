// День 25. Мини-чат с RAG + «памятью задачи».
//
// Многоходовый REPL поверх существующего RAG-конвейера (answerWithRag): каждый ход
// в окно истории (Memory.shortTerm, limit=8) и сериализованный task state (Memory.working)
// прокидываются в buildRagPrompt. Task state авто-обновляется из диалога (LLM-extract
// c JSON-схемой + rule-fallback); сбой extraction никогда не рвёт основной ответ.
//
// Источник знаний — мануал EVOLUTE i-SPACE в .data/rag.sqlite (READ-ONLY, не пишем,
// не реиндексируем). LLM — строго локальная (makeLocalLlmClient).
//
// Запуск:
//   pnpm --filter challenge start -- day-25

import crypto from 'node:crypto';
import readline from 'node:readline';

import { loadEnvUpward } from '../core/env.js';
import { dataPath } from '../core/paths.js';
import type { LlmClient } from '../core/client.js';
import { msg } from '../core/types.js';
import type { ChatMessage } from '../core/types.js';
import { Memory } from '../core/memory.js';
import {
  RagStore,
  Retriever,
  makeEmbedder,
  makeLocalLlmClient,
  answerWithRag,
  DEFAULT_RAG_THRESHOLD,
} from '../core/rag/index.js';
import type { Quote, ScoredChunk } from '../core/rag/index.js';
import { DialogDb } from '../core/dialogDb.js';
import type { SerializedTaskState } from '../core/dialogDb.js';
import type { Demo } from './types.js';

const RAG_DB_PATH = dataPath('rag.sqlite');
const MEMORY_FILE_PATH = dataPath('day25-memory.json');
const DIALOG_DB_PATH = dataPath('dialog.sqlite');
const SHORT_TERM_LIMIT = 8;
const STRATEGY = 'fixed' as const;

// live-индикатор ожидания локальной модели; stop() затирает линию (без ANSI).
// Клон startSpinner из cli.ts — там он не экспортируется, копия минимальна.
function startSpinner(label: string): { stop: () => void } {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  let maxLen = 0;
  const render = (): void => {
    const s = `  ${label}… ${frames[i % frames.length]}`;
    if (s.length > maxLen) maxLen = s.length;
    process.stdout.write('\r' + s);
    i++;
  };
  render();
  const id = setInterval(render, 150);
  return {
    stop() {
      clearInterval(id);
      process.stdout.write('\r' + ' '.repeat(maxLen) + '\r');
    },
  };
}

// --- Task state: детерминированная сериализация для инъекции в промпт и для /task ---
// Ключи в Memory.working типизированы префиксами: term:* / constraint:* / clar:*.
// Пустые секции опускаются; это же значение уходит в промпт как ДАННЫЕ (контрмера injection).
export function renderTaskState(memory: Memory): string {
  const goal = memory.task;
  const keys = memory.workingKeys;
  const terms = keys.filter((k) => k.startsWith('term:'));
  const constraints = keys.filter((k) => k.startsWith('constraint:'));
  const clars = keys.filter((k) => k.startsWith('clar:'));
  const lines: string[] = [];
  if (goal) lines.push(`Цель: ${goal}`);
  if (terms.length > 0) {
    lines.push('Термины:');
    for (const k of terms) {
      const name = k.slice('term:'.length);
      const val = memory.getWorkingFact(k) ?? '';
      lines.push(val ? `  - ${name} = ${val}` : `  - ${name}`);
    }
  }
  if (constraints.length > 0) {
    lines.push('Ограничения:');
    for (const k of constraints) lines.push(`  - ${k.slice('constraint:'.length)}`);
  }
  if (clars.length > 0) {
    lines.push('Уточнения:');
    for (const k of clars) lines.push(`  - ${k.slice('clar:'.length)}`);
  }
  return lines.join('\n');
}

// --- Task state extraction ---

interface ExtractedTaskState {
  goal: string | null;
  terms: Record<string, string>;
  constraints: string[];
  clarifications: string[];
}

const EXTRACT_SYSTEM =
  'Отвечай ТОЛЬКО на русском языке. Использовать другие языки запрещено. ' +
  'Проанализируй последний обмен репликами в диалоге про автомобиль EVOLUTE i-SPACE и ' +
  'извлеки структурированные данные о задаче пользователя. Верни СТРОГО валидный JSON ' +
  'без markdown-обёрток и без пояснений. Схема: ' +
  '{"goal": string|null, "terms": {"<термин>": "<определение>"}, "constraints": string[], "clarifications": string[]}. ' +
  'В goal — основная цель пользователя (одной фразой), если она прозвучала. ' +
  'В terms — термины, которые пользователь назвал или переименовал (термин → определение). ' +
  'В constraints — явно названные ограничения (например «только розетка 220 В», «только psi»). ' +
  'В clarifications — остальные уточнения пользователя. ' +
  'Бери ТОЛЬКО то, что пользователь ЯВНО сказал в этом обмене. Не додумывай. ' +
  'Разделителем между маркером и значением может быть «:», «—» (em-dash), «–» (en-dash), «-» или «→». ' +
  'Примеры: «моя цель — выбрать режим прогрева» → goal: «выбрать режим прогрева»; ' +
  '«итог: нужна стоимость зарядки» → goal: «узнать стоимость зарядки»; ' +
  '«запомни термин: рекуперация = возврат тепла» → terms: {"рекуперация": "возврат тепла"}; ' +
  '«назову его ACC. запомни.» → terms: {"ACC": ""} если расшифровки нет. ' +
  'Если новых данных нет — верни {"goal": null, "terms": {}, "constraints": [], "clarifications": []}.';

function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

// Разрешённые символы для task state: кириллица, базовая латиница (ACC/psi/кВт),
// цифры, базовая пунктуация и кавычки. CJK / диакритика / другие блоки → false.
// Дефис помещён в конец char class, чтобы не трактовать его как range separator.
const ALLOWED_RUNE = /[А-Яа-яЁёA-Za-z0-9 ,.–—:()«»"/+%-]/;

function looksRussian(s: string): boolean {
  if (!s) return false;
  for (const ch of s) {
    if (!ALLOWED_RUNE.test(ch)) return false;
  }
  return true;
}

// Post-filter фантомов: термин/ограничение вносится, только если какое-то его
// слово (длиной ≥3) дословно встречается в последней реплике пользователя.
// Дешёвая защита от LLM-шума («мощность = выхлопная мощность» и т.п.).
function termMatchesUser(term: string, userMsg: string): boolean {
  const t = term.toLowerCase().replace(/[«»"“”'`]/g, '').trim();
  if (!t) return false;
  const u = userMsg.toLowerCase();
  const words = t.split(/\s+/);
  return words.some((w) => w.replace(/[.,:;!?]+$/, '').length >= 3 && u.includes(w));
}

function validateExtract(raw: unknown): ExtractedTaskState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const goalRaw =
    typeof obj.goal === 'string' && obj.goal.trim().length > 0 ? obj.goal.trim() : null;
  const goal = goalRaw && looksRussian(goalRaw) ? goalRaw : null;
  const termsSrc = obj.terms && typeof obj.terms === 'object' ? (obj.terms as Record<string, unknown>) : {};
  const terms: Record<string, string> = {};
  for (const [k, v] of Object.entries(termsSrc)) {
    const kk = typeof k === 'string' ? k.trim() : '';
    const vv = typeof v === 'string' ? v.trim() : '';
    if (kk && looksRussian(kk) && (vv === '' || looksRussian(vv))) {
      terms[kk] = vv;
    }
  }
  const constraints = Array.isArray(obj.constraints)
    ? obj.constraints
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
        .filter((c) => looksRussian(c))
    : [];
  const clarifications = Array.isArray(obj.clarifications)
    ? obj.clarifications
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
    : [];
  if (!goal && Object.keys(terms).length === 0 && constraints.length === 0 && clarifications.length === 0) {
    return null;
  }
  return { goal, terms, constraints, clarifications };
}

function applyExtracted(memory: Memory, e: ExtractedTaskState, userMsg: string, skipGoal = false): void {
  // goal НЕ фильтруется по userMsg: цель может быть сформулирована иначе, чем дословно.
  // skipGoal: на guard-ходах («не знаю») LLM-шум может родить фантомный goal из
  // off-topic реплики — не пишем его, чтобы не загрязнять будущие промпты.
  // terms/constraints/clarifications остаются под termMatchesUser-фильтром, для них
  // отдельного gate не нужно.
  if (e.goal && !skipGoal) memory.setTask(e.goal);
  for (const [t, m] of Object.entries(e.terms)) {
    if (termMatchesUser(t, userMsg) || termMatchesUser(m, userMsg)) {
      memory.setWorkingFact(`term:${t}`, m);
    }
  }
  for (const c of e.constraints) {
    if (termMatchesUser(c, userMsg)) {
      memory.setWorkingFact(`constraint:${c}`, c);
    }
  }
  for (const c of e.clarifications) {
    if (termMatchesUser(c, userMsg)) {
      memory.setWorkingFact(`clar:${c}`, c);
    }
  }
}

// Rule-fallback: детерминированно ловит явные маркеры пользователя, когда LLM недоступен
// или вернул невалидный JSON. Возвращает true если что-то применили. День 25b: в
// символьный класс разделителя включены em-dash «—» (U+2014) и en-dash «–» (U+2013),
// чтобы ловить «цель — X», «ограничение — X» (regex фикса дня 25 не покрывал тире).
function applyRules(memory: Memory, userMsg: string): boolean {
  let changed = false;
  const goalMatch = userMsg.match(/(?:мо[яй]\s+цель|цель|итог(?:овая)?\s+цель|итог)\s*[:—–\-]\s*(.+)/i);
  if (goalMatch && goalMatch[1] && looksRussian(goalMatch[1])) {
    memory.setTask(goalMatch[1].trim());
    changed = true;
  }
  const termEq = userMsg.match(/(?:запомни\s+термин|термин|назову|буду\s+звать|смени\s+термин)\s*[:—–\-]\s*(.+?)\s*[=—–\->]\s*(.+)/i);
  if (termEq && termEq[1] && termEq[2] && looksRussian(termEq[1]) && looksRussian(termEq[2])) {
    memory.setWorkingFact(`term:${termEq[1].trim()}`, termEq[2].trim());
    changed = true;
  }
  const rename = userMsg.match(/(?:смени\s+термин|переименуй)[^:=]*?(.+?)\s*[→>=—–\-]\s*(.+)/i);
  if (rename && rename[2] && rename[1] && looksRussian(rename[1]) && looksRussian(rename[2])) {
    memory.setWorkingFact(`term:${rename[2].trim()}`, rename[1].trim());
    changed = true;
  }
  const constraintMatch = userMsg.match(/(?:ограничение|учитывай|у\s+меня\s+только)\s*[:—–\-]\s*(.+)/i);
  if (constraintMatch && constraintMatch[1] && looksRussian(constraintMatch[1])) {
    const c = constraintMatch[1].trim();
    memory.setWorkingFact(`constraint:${c}`, c);
    changed = true;
  }
  return changed;
}

// Детектор директивы (запомни/ограничение/цель): НЕ вопрос + явный imperative-маркер.
// Идёт коротким путём в обход RAG — это не поисковый запрос, а указание от пользователя.
//
// Границы маркеров: токенизация по не-буквенным разделителям (кириллица + латиница)
// и проверка целых токенов/фраз. Подход предыдущей итерации (regex без границ на
// исходной строке) матчит «запомнил/запомнилось» как подстроку «запомни» → FP.
// JS \b — ASCII-only и неприменим к кириллице; поэтому single-маркеры — через Set
// целых токенов, а фразы — через joined-токены с regex-границами (?:^| )...(?: |$).
const DIRECTIVE_SINGLE = new Set([
  'запомни', 'запомните', 'назову', 'ограничение', 'учитывай', 'переименуй',
]);
function looksLikeDirective(s: string): boolean {
  const t = s.trimEnd();
  if (t.endsWith('?')) return false;
  const tokens = t.toLowerCase().split(/[^а-яёa-z]+/).filter(Boolean);
  if (tokens.some((w) => DIRECTIVE_SINGLE.has(w))) return true;
  const joined = tokens.join(' ');
  if (/(?:^| )(буду звать|смени термин|у меня только|мо[яй] (?:цель|задача))(?: |$)/.test(joined)) return true;
  if (/(?:цель|итог)\s*[:—–]\s*\S/i.test(t)) return true;
  return false;
}

/**
 * Авто-обновление task state из последнего обмена. Best-effort: правило → LLM-extract.
 * Любой сбой (LLM бросил, невалидный JSON, неверная схема) молча оставляет состояние
 * прежним — основной ответ пользователя это НИКОГДА не рвёт (AC-9).
 *
 * Экспортируется в day-25-server.ts (STDIO-MCP повторно использует ту же логику).
 */
export async function updateTaskState(
  memory: Memory,
  userMsg: string,
  assistantMsg: string,
  client: LlmClient,
  opts?: { skipGoal?: boolean },
): Promise<void> {
  // applyRules — БЕЗусловно: rule-based goal детерминированный, срабатывает только
  // на явный маркер («цель —», «ограничение:»), на off-topic guard не матчит.
  // skipGoal гейтит только LLM-extracted goal (шум модели на guard-ходах).
  applyRules(memory, userMsg);
  try {
    const raw = await client.chat([
      msg.system(EXTRACT_SYSTEM),
      msg.user(`Пользователь: ${userMsg}\nАссистент: ${assistantMsg}`),
    ]);
    const parsed: unknown = JSON.parse(stripFences(raw));
    const e = validateExtract(parsed);
    if (e) applyExtracted(memory, e, userMsg, opts?.skipGoal === true);
  } catch {
    // no-op: extraction неудачен — состояние прежнее, ответ уже отдан.
  }
}

// --- Сериализация task state для БД (НЕ то же, что renderTaskState для промпта). ---

export function serializeTaskState(memory: Memory): SerializedTaskState {
  const keys = memory.workingKeys;
  const terms: Record<string, string> = {};
  const constraints: string[] = [];
  const clarifications: string[] = [];
  for (const k of keys) {
    if (k.startsWith('term:')) {
      terms[k.slice('term:'.length)] = memory.getWorkingFact(k) ?? '';
    } else if (k.startsWith('constraint:')) {
      constraints.push(k.slice('constraint:'.length));
    } else if (k.startsWith('clar:')) {
      clarifications.push(k.slice('clar:'.length));
    }
  }
  return { goal: memory.task, terms, constraints, clarifications };
}

export function deserializeTaskStateInto(state: SerializedTaskState, memory: Memory): void {
  memory.clearWorking();
  if (state.goal) memory.setTask(state.goal);
  for (const [t, m] of Object.entries(state.terms)) memory.setWorkingFact(`term:${t}`, m);
  for (const c of state.constraints) memory.setWorkingFact(`constraint:${c}`, c);
  for (const c of state.clarifications) memory.setWorkingFact(`clar:${c}`, c);
}

// Извлечение ключевых слов из вопроса для past-Q&A LIKE-поиска. lower-case, стоп-слова
// выкинуты, длина ≥4. Первые 3 — чтобы не раздувать OR-цепочку в SQL.
const STOP_WORDS = new Set([
  'что', 'как', 'где', 'когда', 'почему', 'зачем', 'какие', 'какой', 'какая', 'сколько',
  'и', 'или', 'а', 'но', 'да', 'нет', 'ну', 'вот', 'это', 'этом', 'этот', 'эта',
  'при', 'для', 'на', 'в', 'во', 'с', 'со', 'от', 'до', 'по', 'из', 'к', 'над', 'под',
  'бы', 'ли', 'же', 'был', 'была', 'есть', 'будет', 'мне', 'мной', 'моя', 'мой',
  ' me ', 'его', 'её', 'их', 'он', 'она', 'они', 'мы', 'вы', 'тебя',
]);

export function extractKeywords(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
    if (out.length >= 3) break;
  }
  return out;
}

// --- REPL ---

function printReplHelp(): void {
  console.log('  /help         эта справка');
  console.log('  /task         показать task state (цель / термины / ограничения)');
  console.log('  /task-clear   сбросить task state (история сохраняется)');
  console.log('  /sources      источники последнего ответа + прошлые Q&A');
  console.log('  /chats        список чатов (id | title | msgs | updated)');
  console.log('  /new <title>  создать чат и сделать активным');
  console.log('  /switch <id>  переключиться на чат (грузит его историю + task state)');
  console.log('  /current      показать активный чат');
  console.log('  /cross-chat on|off  поиск прошлых Q&A по всем чатам (сейчас: см. /current)');
  console.log('  /reset        сброс истории RAM + task state (БД-сообщения не трогать)');
  console.log('  /quit         выход');
}

interface PastQaPair {
  chatId: string;
  q: string;
  a: string;
}

function printSources(sources: ScoredChunk[], quotes: Quote[] | undefined, pastQa: PastQaPair[] = []): void {
  if (sources.length === 0) {
    console.log('(нет источников последнего хода — вероятно, сработал guard «не знаю».)\n');
    return;
  }
  const src = sources
    .map((s) => `${s.chunk.metadata.section}[${s.score.toFixed(2)}]`)
    .join(', ');
  console.log(`\nисточники: ${src}`);
  if (quotes && quotes.length > 0) {
    const qt = quotes.map((qq) => qq.snippet.replace(/\s+/g, ' ')).join(' / ');
    console.log(`цитаты: ${qt}`);
  }
  if (pastQa.length > 0) {
    console.log('Прошлые Q&A:');
    for (const p of pastQa) {
      const cid = p.chatId.slice(0, 8);
      console.log(`  - [${cid}] Q: ${p.q.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  console.log('');
}

function printTaskState(memory: Memory): void {
  const ts = renderTaskState(memory);
  console.log('\n' + (ts.length > 0 ? ts : '(task state пуст — задайте цель/термин/ограничение в диалоге)') + '\n');
}

function printAnswer(answer: string, sources: ScoredChunk[], quotes: Quote[] | undefined, gaveUp: boolean, modelName: string, dt: number, pastQaCount: number): void {
  printSources(sources, quotes);
  console.log(answer);
  const guardTag = gaveUp ? ' | guard: не знаю' : '';
  const pastTag = pastQaCount > 0 ? ` | past-qa: ${pastQaCount} found` : '';
  console.log(`[model: ${modelName} | rag: ${sources.length} chunks | ${dt}ms${guardTag}${pastTag}]\n`);
}

async function run(): Promise<void> {
  loadEnvUpward();
  const store = new RagStore(RAG_DB_PATH);
  try {
    if (store.count(STRATEGY) === 0) {
      console.log('▶ День 25: RAG-чат с памятью задачи');
      console.log('  Индекс пуст. Сначала соберите его: pnpm --filter challenge start -- rag index');
      return;
    }
    const client = makeLocalLlmClient();
    const retriever = new Retriever(store, makeEmbedder(), STRATEGY);
    const memory = new Memory({ filePath: MEMORY_FILE_PATH, shortTermLimit: SHORT_TERM_LIMIT });
    const dialogDb = new DialogDb(DIALOG_DB_PATH);
    // При старте восстанавливаем последний чат (НЕ auto-create) — R6 из плана.
    // Если чат есть — поднимаем RAM-окно (последние N сообщений) + его task state.
    let currentChatId: string | null = dialogDb.listChats(1)[0]?.id ?? null;
    if (currentChatId !== null) {
      const restoreMsgs = dialogDb.listMessages(currentChatId, SHORT_TERM_LIMIT);
      for (const m of restoreMsgs) {
        memory.addMessage({ role: m.role as ChatMessage['role'], content: m.content });
      }
      const restoredState = dialogDb.loadTaskState(currentChatId);
      if (restoredState) deserializeTaskStateInto(restoredState, memory);
    }
    let crossChatRecall = true; // past-Q&A по всем чатам default ON (Т4: «искать в базе зафиксированных»)
    // loadLongTerm/saveLongTerm НЕ вызываем: RAM-на-сессию (решение плана).
    let lastSources: ScoredChunk[] = [];
    let lastQuotes: Quote[] | undefined;
    let lastPastQa: PastQaPair[] = [];

    const ensureChat = (initialTitle: string): string => {
      if (currentChatId === null) {
        currentChatId = crypto.randomUUID();
        dialogDb.createChat(currentChatId, initialTitle);
      }
      return currentChatId;
    };

    console.log('▶ День 25: RAG-чат с памятью задачи');
    console.log('  источник:     мануал EVOLUTE i-SPACE в индексе (read-only)');
    console.log(`  история:      окно ${SHORT_TERM_LIMIT} сообщений (SlidingWindow в Memory)`);
    console.log('  task state:   цель / термины / ограничения — авто-извлечение из диалога');
    console.log('  память чата:  dialog.sqlite (multi-chat: /chats /new /switch /current)');
    console.log('  past-Q&A:     LIKE-поиск по всем чатам (/cross-chat on|off)');
    console.log('  команды:      /help /task /task-clear /sources /reset /chats /new /switch /current /cross-chat /quit');
    console.log('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // При pipe/EOF readline закрывается до того, как turnChain досчитает активный ход.
    // Фиксируем закрытие флагом, чтобы не звать prompt() на закрытом интерфейсе
    // (иначе ERR_USE_AFTER_CLOSE). rl.closed отсутствует в типах @types/node.
    let rlClosed = false;
    rl.on('close', () => {
      rlClosed = true;
    });
    const prompt = (): void => {
      if (!rlClosed) rl.prompt();
    };
    rl.setPrompt('you (rag)> ');
    const handleLine = async (line: string): Promise<void> => {
      const q = line.trim();
      if (!q) {
        prompt();
        return;
      }
      if (q === '/quit' || q === '/exit') {
        rl.close();
        return;
      }
      if (q === '/help') {
        printReplHelp();
        prompt();
        return;
      }
      if (q === '/task') {
        printTaskState(memory);
        prompt();
        return;
      }
      if (q === '/task-clear') {
        memory.clearWorking();
        try {
          if (currentChatId !== null) dialogDb.clearTaskState(currentChatId);
        } catch (e) {
          process.stderr.write(`[day-25] clearTaskState failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
        console.log('task state сброшен (история сохранена).\n');
        prompt();
        return;
      }
      if (q === '/sources') {
        printSources(lastSources, lastQuotes, lastPastQa);
        prompt();
        return;
      }
      if (q === '/chats') {
        const chats = dialogDb.listChats(50);
        if (chats.length === 0) {
          console.log('(нет сохранённых чатов — /new <title> или просто спросите).\n');
        } else {
          console.log('\nСохранённые чаты:');
          for (const c of chats) {
            const marker = c.id === currentChatId ? '* ' : '  ';
            console.log(`${marker}${c.id.slice(0, 8)} | ${c.msg_count} msgs | ${c.title.slice(0, 40)} | ${c.updated_at}`);
          }
          console.log('');
        }
        prompt();
        return;
      }
      if (q === '/new' || q.startsWith('/new ')) {
        const title = q.startsWith('/new ') ? q.slice('/new '.length).trim() : 'untitled';
        const id = crypto.randomUUID();
        dialogDb.createChat(id, title || 'untitled');
        currentChatId = id;
        memory.clearShortTerm();
        memory.clearWorking();
        lastSources = [];
        lastQuotes = undefined;
        lastPastQa = [];
        console.log(`создан чат: ${id} (${title || 'untitled'})\n`);
        prompt();
        return;
      }
      if (q.startsWith('/switch ')) {
        const qid = q.slice('/switch '.length).trim();
        // exact match first; иначе — уникальный префикс (8-символьный id из /chats).
        let id: string | null = dialogDb.getChat(qid) ? qid : null;
        if (id === null) {
          const matches = dialogDb.listChats(1000).filter((c) => c.id.startsWith(qid));
          if (matches.length === 1) id = matches[0].id;
          else if (matches.length > 1) {
            console.log(`несколько чатов с префиксом «${qid}»: ${matches.map((m) => m.id.slice(0, 8)).join(', ')} — уточните\n`);
            prompt();
            return;
          }
        }
        if (id === null) {
          console.log(`чат не найден: ${qid}\n`);
          prompt();
          return;
        }
        const chat = dialogDb.getChat(id);
        if (!chat) {
          console.log(`чат не найден: ${id}\n`);
          prompt();
          return;
        }
        memory.clearShortTerm();
        memory.clearWorking();
        const msgs = dialogDb.listMessages(id, SHORT_TERM_LIMIT);
        for (const m of msgs) {
          memory.addMessage({ role: m.role as ChatMessage['role'], content: m.content });
        }
        const state = dialogDb.loadTaskState(id);
        if (state) deserializeTaskStateInto(state, memory);
        currentChatId = id;
        lastSources = [];
        lastQuotes = undefined;
        lastPastQa = [];
        console.log(`переключились на: ${id} | ${chat.title} | ${msgs.length} в окне\n`);
        prompt();
        return;
      }
      if (q === '/current') {
        if (currentChatId === null) {
          console.log(`активный чат не выбран (сообщение создаст «untitled» автоматически). cross-chat recall: ${crossChatRecall ? 'on' : 'off'}\n`);
        } else {
          const chat = dialogDb.getChat(currentChatId);
          const count = dialogDb.countMessages(currentChatId);
          console.log(`чат: ${currentChatId} | ${chat?.title ?? '?'} | ${count} сообщений | cross-chat recall: ${crossChatRecall ? 'on' : 'off'}\n`);
        }
        prompt();
        return;
      }
      if (q === '/cross-chat' || q === '/cross-chat on' || q === '/cross-chat off') {
        if (q === '/cross-chat on') crossChatRecall = true;
        else if (q === '/cross-chat off') crossChatRecall = false;
        console.log(`cross-chat recall: ${crossChatRecall ? 'on' : 'off'} (поиск прошлых Q&A по всем чатам)\n`);
        prompt();
        return;
      }
      if (q === '/reset') {
        memory.clearShortTerm();
        memory.clearWorking();
        try {
          if (currentChatId !== null) dialogDb.clearTaskState(currentChatId);
        } catch (e) {
          process.stderr.write(`[day-25] clearTaskState failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
        lastSources = [];
        lastQuotes = undefined;
        lastPastQa = [];
        console.log('сброшено: RAM-окно + task state (БД-сообщения сохранены).\n');
        prompt();
        return;
      }

      // --- Директива (запомни/ограничение/цель) — не вопрос, RAG не нужен. ---
      if (looksLikeDirective(q)) {
        const cid = ensureChat(q.slice(0, 60));
        const wasFirst = dialogDb.countMessages(cid) === 0;
        // applyRules не вызываем отдельно: updateTaskState применит его внутри.
        // skipGoal НЕ передаём — директива «цель —» валидный источник goal.
        const sp = startSpinner('запоминаю');
        try {
          await updateTaskState(memory, q, '', client);
        } catch {
          // no-op: extraction неудачен — ack всё равно отдаём (правила могли сработать).
        } finally {
          sp.stop();
        }
        try {
          dialogDb.upsertTaskState(cid, serializeTaskState(memory));
        } catch (e) {
          process.stderr.write(`[day-25] directive upsert failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
        const ts = renderTaskState(memory);
        const ack = ts.length > 0
          ? `Запомнил, учту в дальнейших ответах.\n${ts}`
          : 'Запомнил.';
        console.log(ack + '\n');
        memory.addMessage(msg.user(q));
        memory.addMessage(msg.assistant(ack));
        try {
          dialogDb.appendMessage(cid, 'user', q);
          dialogDb.appendMessage(cid, 'assistant', ack);
          if (wasFirst) dialogDb.renameChat(cid, q.slice(0, 60));
          dialogDb.touchChat(cid);
        } catch (e) {
          process.stderr.write(`[day-25] directive persist failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
        lastSources = [];
        lastQuotes = undefined;
        lastPastQa = [];
        prompt();
        return;
      }

      // --- RAG-ход с past-Q&A и persist ---

      // 1. Past-Q&A retrieval ДО ответа (best-effort, не рвём основной ход).
      //    excludeChatId = текущий чат (не дублируем shortTerm-окно). При отсутствии
      //    ключевых слов или выключенном cross-chat retrieval пропускается.
      let dialogContext = '';
      let pastPairs: PastQaPair[] = [];
      const excludeChatId = currentChatId ?? '';
      if (crossChatRecall) {
        const keywords = extractKeywords(q);
        if (keywords.length > 0) {
          try {
            const found = dialogDb.searchPastQa(keywords, excludeChatId, 4);
            for (const u of found) {
              const after = dialogDb.listMessageAfter(u.chatId, u.id, 1);
              if (after.length > 0 && after[0].role === 'assistant') {
                pastPairs.push({ chatId: u.chatId, q: u.content, a: after[0].content });
                if (pastPairs.length >= 2) break;
              }
            }
            if (pastPairs.length > 0) {
              dialogContext = pastPairs.map((p) => `Q: ${p.q}\nA: ${p.a}`).join('\n\n');
            }
          } catch (e) {
            process.stderr.write(`[day-25] past-Q&A search failed: ${e instanceof Error ? e.message : String(e)}\n`);
          }
        }
      }

      const taskState = renderTaskState(memory);
      const history = memory.shortTermMessages;
      const t0 = Date.now();
      const spinner = startSpinner('думаю');
      try {
        const rag = await answerWithRag(client, retriever, q, {
          k: 4,
          pool: 20,
          threshold: DEFAULT_RAG_THRESHOLD,
          history,
          taskState,
          dialogContext,
        });
        spinner.stop();
        const dt = Date.now() - t0;
        lastSources = rag.sources;
        lastQuotes = rag.quotes;
        lastPastQa = pastPairs;
        printAnswer(rag.answer, rag.sources, rag.quotes, rag.debug?.gaveUp === true, client.defaultModel, dt, pastPairs.length);
        memory.addMessage(msg.user(q));
        memory.addMessage(msg.assistant(rag.answer));
        // 2. Persist в dialog.sqlite (best-effort, не рвём ответ).
        try {
          const cid = ensureChat(q.slice(0, 60));
          const wasFirst = dialogDb.countMessages(cid) === 0;
          dialogDb.appendMessage(cid, 'user', q);
          dialogDb.appendMessage(cid, 'assistant', rag.answer);
          // task state extraction: работает на user-реплике независимо от того,
          // дал ассистент ответ или guard («не знаю») — директивы пользователя всё равно важны.
          // skipGoal: на guard-ходе LLM-фантомый goal не пишем (applyRules всё равно
          // применит детерминированный goal, если пользователь явно сказал «цель —»).
          await updateTaskState(memory, q, rag.answer, client, { skipGoal: rag.debug?.gaveUp === true });
          dialogDb.upsertTaskState(cid, serializeTaskState(memory));
          if (wasFirst) dialogDb.renameChat(cid, q.slice(0, 60));
          dialogDb.touchChat(cid);
        } catch (e) {
          process.stderr.write(`[day-25] persist failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
      } catch (err) {
        spinner.stop();
        const m = err instanceof Error ? err.message : String(err);
        console.error(`ошибка: ${m}`);
      }
      prompt();
    };
    // Сериализация ходов: readline не await'ит async-колбэк ('line'-события стреляют
    // подряд при paste/pipe), поэтому каждое событие ждёт предыдущий ход через
    // then-chain. Без этого конкурентно стартуют несколько answerWithRag → race на
    // memory/lastSources/spinner. Дефект Validation итерации #1.
    let turnChain: Promise<void> = Promise.resolve();
    rl.on('line', (line) => {
      turnChain = turnChain.then(() => handleLine(line));
    });
    try {
      await new Promise<void>((res) => rl.once('close', res));
      // 'close' приходит от /quit или от EOF входного потока (pipe). Но turnChain
      // может ещё досчитывать активный ход — нельзя закрывать store (finally) раньше.
      await turnChain;
    } finally {
      dialogDb.close();
    }
  } finally {
    store.close();
  }
}

export const demo: Demo = {
  id: 'day-25',
  title: 'RAG-чат с памятью задачи (история + цель/термины/ограничения)',
  run,
};
