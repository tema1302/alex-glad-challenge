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

import path from 'node:path';
import readline from 'node:readline';

import { loadEnvUpward } from '../core/env.js';
import type { LlmClient } from '../core/client.js';
import { msg } from '../core/types.js';
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
import type { Demo } from './types.js';

const RAG_DB_PATH = path.join(process.cwd(), '.data', 'rag.sqlite');
const MEMORY_FILE_PATH = path.join(process.cwd(), '.data', 'day25-memory.json');
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
    for (const k of terms) lines.push(`  - ${k.slice('term:'.length)} = ${memory.getWorkingFact(k) ?? ''}`);
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
  'Если новых данных нет — верни {"goal": null, "terms": {}, "constraints": [], "clarifications": []}.';

function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function validateExtract(raw: unknown): ExtractedTaskState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const goal =
    typeof obj.goal === 'string' && obj.goal.trim().length > 0 ? obj.goal.trim() : null;
  const termsSrc = obj.terms && typeof obj.terms === 'object' ? (obj.terms as Record<string, unknown>) : {};
  const terms: Record<string, string> = {};
  for (const [k, v] of Object.entries(termsSrc)) {
    if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
      terms[k.trim()] = v.trim();
    }
  }
  const constraints = Array.isArray(obj.constraints)
    ? obj.constraints
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim())
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

function applyExtracted(memory: Memory, e: ExtractedTaskState): void {
  if (e.goal) memory.setTask(e.goal);
  for (const [t, m] of Object.entries(e.terms)) memory.setWorkingFact(`term:${t}`, m);
  for (const c of e.constraints) memory.setWorkingFact(`constraint:${c}`, c);
  for (const c of e.clarifications) memory.setWorkingFact(`clar:${c}`, c);
}

// Rule-fallback: детерминированно ловит явные маркеры пользователя, когда LLM недоступен
// или вернул невалидный JSON. Возвращает true если что-то применили.
function applyRules(memory: Memory, userMsg: string): boolean {
  let changed = false;
  const goalMatch = userMsg.match(/(?:мо[яй]\s+цель|цель[:\s]|итог(?:овая)?\s+цель)[:\s]+(.+)/i);
  if (goalMatch && goalMatch[1]) {
    memory.setTask(goalMatch[1].trim());
    changed = true;
  }
  const termEq = userMsg.match(/(?:запомни\s+термин|термин)[:\s]+(.+?)\s*[=—–-]\s*(.+)/i);
  if (termEq && termEq[1] && termEq[2]) {
    memory.setWorkingFact(`term:${termEq[1].trim()}`, termEq[2].trim());
    changed = true;
  }
  const rename = userMsg.match(/(?:смени\s+термин|переименуй)[^:=]*?(.+?)\s*[→>]\s*(.+)/i);
  if (rename && rename[2]) {
    memory.setWorkingFact(`term:${rename[2].trim()}`, rename[1]?.trim() ?? '');
    changed = true;
  }
  const constraintMatch = userMsg.match(/(?:ограничение|учитывай)[:\s]+(.+)/i);
  if (constraintMatch && constraintMatch[1]) {
    const c = constraintMatch[1].trim();
    memory.setWorkingFact(`constraint:${c}`, c);
    changed = true;
  }
  return changed;
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
): Promise<void> {
  applyRules(memory, userMsg);
  try {
    const raw = await client.chat([
      msg.system(EXTRACT_SYSTEM),
      msg.user(`Пользователь: ${userMsg}\nАссистент: ${assistantMsg}`),
    ]);
    const parsed: unknown = JSON.parse(stripFences(raw));
    const e = validateExtract(parsed);
    if (e) applyExtracted(memory, e);
  } catch {
    // no-op: extraction неудачен — состояние прежнее, ответ уже отдан.
  }
}

// --- REPL ---

function printReplHelp(): void {
  console.log('  /help         эта справка');
  console.log('  /task         показать task state (цель / термины / ограничения)');
  console.log('  /task-clear   сбросить task state (история сохраняется)');
  console.log('  /sources      источники последнего ответа');
  console.log('  /reset        сброс истории + task state');
  console.log('  /quit         выход');
}

function printSources(sources: ScoredChunk[], quotes: Quote[] | undefined): void {
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
  console.log('');
}

function printTaskState(memory: Memory): void {
  const ts = renderTaskState(memory);
  console.log('\n' + (ts.length > 0 ? ts : '(task state пуст — задайте цель/термин/ограничение в диалоге)') + '\n');
}

function printAnswer(answer: string, sources: ScoredChunk[], quotes: Quote[] | undefined, gaveUp: boolean, modelName: string, dt: number): void {
  printSources(sources, quotes);
  console.log(answer);
  const guardTag = gaveUp ? ' | guard: не знаю' : '';
  console.log(`[model: ${modelName} | rag: ${sources.length} chunks | ${dt}ms${guardTag}]\n`);
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
    // loadLongTerm/saveLongTerm НЕ вызываем: RAM-на-сессию (решение плана).
    let lastSources: ScoredChunk[] = [];
    let lastQuotes: Quote[] | undefined;

    console.log('▶ День 25: RAG-чат с памятью задачи');
    console.log('  источник:     мануал EVOLUTE i-SPACE в индексе (read-only)');
    console.log(`  история:      окно ${SHORT_TERM_LIMIT} сообщений (SlidingWindow в Memory)`);
    console.log('  task state:   цель / термины / ограничения — авто-извлечение из диалога');
    console.log('  команды:      /help /task /task-clear /sources /reset /quit');
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
        console.log('task state сброшен (история сохранена).\n');
        prompt();
        return;
      }
      if (q === '/sources') {
        printSources(lastSources, lastQuotes);
        prompt();
        return;
      }
      if (q === '/reset') {
        memory.clearShortTerm();
        memory.clearWorking();
        lastSources = [];
        lastQuotes = undefined;
        console.log('сброшено: история + task state.\n');
        prompt();
        return;
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
        });
        spinner.stop();
        const dt = Date.now() - t0;
        lastSources = rag.sources;
        lastQuotes = rag.quotes;
        printAnswer(rag.answer, rag.sources, rag.quotes, rag.debug?.gaveUp === true, client.defaultModel, dt);
        memory.addMessage(msg.user(q));
        memory.addMessage(msg.assistant(rag.answer));
        // task state extraction: на guard-ходе ассистент ничего нового не сказал — пропускаем LLM-вызов.
        if (rag.debug?.gaveUp !== true) {
          await updateTaskState(memory, q, rag.answer, client);
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
    await new Promise<void>((res) => rl.once('close', res));
    // 'close' приходит от /quit или от EOF входного потока (pipe). Но turnChain
    // может ещё досчитывать активный ход — нельзя закрывать store (finally) раньше.
    await turnChain;
  } finally {
    store.close();
  }
}

export const demo: Demo = {
  id: 'day-25',
  title: 'RAG-чат с памятью задачи (история + цель/термины/ограничения)',
  run,
};
