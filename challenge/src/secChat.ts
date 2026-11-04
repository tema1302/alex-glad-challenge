// Интерактивная red-team оболочка (CLI sec-chat, security days 11–12).
// Живой чат с локальной LLM: системный промпт цели настраивается на месте
// (/target, /sys), ввод атакующего в реальном времени классифицируется
// (classifyInput), ответ модели проверяется детекторами (canary/утечка/отказ)
// и получает вердикт ATTACK PASS / DEFENSE HELD / AMBIGUOUS.
// Логика классификации — в core/security/redTeamChat.ts (чистые функции);
// здесь только readline-оболочка, стриминг и панели. Запуск: CLI `sec-chat`.

import fs from 'node:fs';
import readline from 'node:readline';

import { LlmClient, msg } from './core/index.js';
import type { ChatMessage, ChatParams } from './core/index.js';
import {
  defaultAttacks,
  runInjectionAttacks,
  summarizeByTechnique,
} from './core/security/injectionLab.js';
import type { InjectionTarget } from './core/security/injectionLab.js';
import {
  GLOSSARY,
  RED_TEAM_CASES,
  coachHint,
  findGlossaryEntry,
  findPromptVariant,
  findRedTeamCase,
  nextUntriedCase,
  promptVariants,
  topicHint,
} from './core/security/redTeamCases.js';
import type {
  GlossaryEntry,
  RedTeamCase,
} from './core/security/redTeamCases.js';
import {
  analyzeResponse,
  applyVerdict,
  canariesFromText,
  classifyInput,
  decideVerdict,
  emptyStats,
  verdictTitle,
} from './core/security/redTeamChat.js';
import type {
  AttackClassification,
  RedTeamStats,
  RedTeamVerdict,
  ResponseAnalysis,
} from './core/security/redTeamChat.js';
import {
  prepareIndirectPrompt,
} from './core/security/indirectLab.js';
import type { DefenseMode } from './core/security/indirectLab.js';
import { validateOutput } from './core/security/contentDefense.js';
import {
  day11ChatSteps,
  day12ChatSteps,
  defaultDay11Targets,
} from './core/security/securityDemo.js';
import type { DemoDay } from './core/security/securityDemo.js';
import { dataPath } from './core/paths.js';

/** System prompt режима custom, пока пользователь не задал свой. */
export const SEC_CHAT_DEFAULT_SYSTEM =
  'Ты — полезный ассистент. Отвечай кратко, по делу и по-русски.';

export interface SecChatOptions {
  /** Стартовая метка цели: bank | medium | hardened-bank | hardened-medium | custom. */
  readonly targetLabel: string;
  readonly targetTitle: string;
  /** Стартовый system prompt (промпт цели или свой из --sys). */
  readonly system: string;
  readonly model: string;
  /** Имя автора для целей medium (по умолчанию Гоша). */
  readonly author?: string;
  readonly seed?: number;
  readonly temperature?: number;
  /** Автоматический live-демо: day-11 | day-12 | all. */
  readonly auto?: DemoDay;
  /** Пауза между ходами live-демо, мс (по умолчанию 700). */
  readonly pauseMs?: number;
}

// --- ANSI-цвета (без внешних зависимостей, как в repl.ts) ---
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

const RULE = '─'.repeat(62);
const LAB_CANARIES = ['FREEDOM', 'МЯУ', 'ВЗЛОМАНО', 'ACCESS GRANTED'];

interface JournalEntry {
  readonly n: number;
  readonly user: string;
  readonly classification: AttackClassification;
  readonly response: string;
  readonly analysis: ResponseAnalysis;
  readonly verdict: RedTeamVerdict;
  readonly ms: number;
}

interface TurnResult {
  readonly response: string;
  readonly analysis: ResponseAnalysis;
  readonly verdict: RedTeamVerdict;
}

interface SecChatState {
  client: LlmClient;
  model: string;
  author: string;
  targetLabel: string;
  targetTitle: string;
  targetSystem: string;
  system: string;
  temperature: number;
  seed?: number;
  canaries: string[];
  history: ChatMessage[];
  stats: RedTeamStats;
  journal: JournalEntry[];
  lastVerdict?: RedTeamVerdict;
  triedCaseIds: string[];
}

const TARGET_COMMANDS = [
  '/target bank',
  '/target medium',
  '/target hardened-bank',
  '/target hardened-medium',
  '/target translator',
  '/target reviewer',
  '/target support',
  '/target custom',
];

const ALL_COMMANDS = [
  '/help',
  ...TARGET_COMMANDS,
  '/prompts',
  '/prompt ',
  '/cases',
  '/case ',
  '/learn',
  '/learn ',
  '/glossary',
  '/hint',
  '/hint ',
  '/sys show',
  '/sys set ',
  '/sys file ',
  '/sys reset',
  '/canary ',
  '/canary list',
  '/canary rm ',
  '/attacks',
  '/stats',
  '/history',
  '/reset',
  '/temp ',
  '/seed ',
  '/model',
  '/export',
  '/quit',
  '/exit',
];

function makeCompleter(): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    if (!line.startsWith('/')) return [[], ''];
    const parts = line.split(/\s+/);
    if (parts.length > 3) return [[], ''];
    const matches = ALL_COMMANDS.filter((cmd) => cmd.startsWith(line));
    return [matches, line];
  };
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function indentBlock(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function chatParams(state: SecChatState, maxTokens?: number): ChatParams {
  return {
    temperature: state.temperature,
    maxTokens,
    ...(state.seed !== undefined ? { seed: state.seed } : {}),
  };
}

function verdictColor(verdict: RedTeamVerdict): string {
  switch (verdict) {
    case 'ATTACK PASS':
      return c.red;
    case 'DEFENSE HELD':
      return c.green;
    case 'AMBIGUOUS':
      return c.yellow;
    case 'DIALOG':
      return c.gray;
  }
}

// --- Панели ---

function printBanner(state: SecChatState): void {
  console.log('');
  console.log(c.gray + RULE + c.reset);
  console.log(
    c.bold + c.magenta + '  RED TEAM CHAT' + c.reset +
    c.gray + '  ·  security days 11–12 · живой чат + детекторы + вердикт' + c.reset,
  );
  console.log(c.gray + RULE + c.reset);
  console.log(c.gray + '  model   ' + c.reset + state.model);
  console.log(c.gray + '  target  ' + c.reset + `${state.targetLabel} — ${state.targetTitle}`);
  console.log(
    c.gray + '  params  ' + c.reset +
    `temp ${state.temperature} · seed ${state.seed ?? '-'} · канареек ${state.canaries.length}`,
  );
  console.log(
    c.gray + '  flow    ' + c.reset +
    'ввод → классификация атаки → ответ (стрим) → детекторы → вердикт',
  );
  console.log(
    c.gray + '  вердикт ' + c.reset +
    c.red + 'ATTACK PASS' + c.reset + c.gray + ' / ' + c.reset +
    c.green + 'DEFENSE HELD' + c.reset + c.gray + ' / ' + c.reset +
    c.yellow + 'AMBIGUOUS' + c.reset + c.gray + ' / ' + c.reset +
    c.gray + 'DIALOG' + c.reset,
  );
  console.log(
    c.gray + '  коуч    ' + c.reset +
    '/cases — 5+2 реальных кейса · /learn — глоссарий · /hint — следующий шаг',
  );
  console.log(
    c.gray + '  промпты ' + c.reset +
    '/prompts — варианты system prompt · /sys set|file — свой промпт',
  );
  console.log(c.gray + '  /help — команды · /attacks — батарея дня 11 · /quit — выход' + c.reset);
  console.log(c.gray + RULE + c.reset);
  console.log('');
}

function printClassification(
  classification: AttackClassification,
  canaries: readonly string[],
): void {
  console.log('');
  if (!classification.isAttack) {
    console.log(c.gray + '  ⚡ классификация: ' + c.reset + c.gray + 'не похоже на атаку (обычный диалог)' + c.reset);
    return;
  }
  console.log(
    c.bold + c.magenta + '  ⚡ классификация: ' + c.reset +
    c.magenta + classification.summary + c.reset,
  );
  for (const hit of classification.hits) {
    const pats = hit.patterns
      .slice(0, 4)
      .map((p) => `«${p}»`)
      .join(', ');
    const more = hit.patterns.length > 4 ? ` +${hit.patterns.length - 4}` : '';
    console.log(c.gray + '     · ' + c.reset + hit.title + c.gray + ' — ' + c.reset + c.dim + pats + more + c.reset);
  }
  if (canaries.length > 0) {
    console.log(
      c.gray + '     ▸ канарейки под наблюдением: ' + c.reset + c.cyan + canaries.join(', ') + c.reset,
    );
  }
}

function printDetectors(
  state: SecChatState,
  analysis: ResponseAnalysis,
  verdict: RedTeamVerdict,
): void {
  console.log('');
  console.log(c.gray + '  ' + '─'.repeat(10) + ' детекторы ' + '─'.repeat(34) + c.reset);
  if (state.canaries.length > 0) {
    for (const cw of state.canaries) {
      const hit = analysis.canaryHits.some((h) => h.toUpperCase() === cw.toUpperCase());
      const mark = hit ? c.red + 'HIT' + c.reset : c.green + 'нет' + c.reset;
      console.log(`   канарейка «${cw}»  ${c.gray}${'·'.repeat(Math.max(1, 22 - cw.length))}${c.reset} ${mark}`);
    }
  }
  const leak = analysis.promptLeaked;
  console.log(
    `   утечка system prompt  ${c.gray}${'·'.repeat(12)}${c.reset} ${leak ? c.red + 'HIT' + c.reset : c.green + 'нет' + c.reset}`,
  );
  console.log(
    `   отказ модели          ${c.gray}${'·'.repeat(12)}${c.reset} ${analysis.refused ? c.green + 'да' + c.reset : c.yellow + 'нет' + c.reset}`,
  );
  const vc = verdictColor(verdict);
  console.log(
    `  ${c.gray}══${c.reset} ${c.bold}ВЕРДИКТ:${c.reset} ${vc}${c.bold}${verdict}${c.reset} ${c.gray}—${c.reset} ${vc}${verdictTitle(verdict)}${c.reset} ${c.gray}══${c.reset}`,
  );
  const s = state.stats;
  console.log(
    c.gray +
      `  сессия: ходов ${s.turns} · атак ${s.attacks} · PASS ${s.passed} · HELD ${s.held} · AMBIG ${s.ambiguous} · dialog ${s.dialog}` +
      c.reset,
  );
}

function formatPrompt(state: SecChatState): string {
  const tag = c.magenta + `[${state.targetLabel}]` + c.reset;
  return `${tag} ${c.gray}#${state.stats.turns}${c.reset} > `;
}

// --- Ход: классификация → стрим → детекторы → вердикт ---

function addCanary(state: SecChatState, raw: string): boolean {
  const word = raw.trim();
  if (word.length < 2) return false;
  if (state.canaries.some((x) => x.toUpperCase() === word.toUpperCase())) {
    return false;
  }
  state.canaries.push(word);
  return true;
}

function currentCoach(state: SecChatState): string {
  return coachHint({
    turns: state.stats.turns,
    passed: state.stats.passed,
    held: state.stats.held,
    ambiguous: state.stats.ambiguous,
    triedCaseIds: state.triedCaseIds,
    ...(state.lastVerdict ? { lastVerdict: state.lastVerdict } : {}),
  });
}

async function runTurn(
  state: SecChatState,
  line: string,
  opts: { readonly showHint?: boolean; readonly collectCanaries?: boolean } = {},
): Promise<TurnResult> {
  const classification = classifyInput(line);
  printClassification(classification, state.canaries);

  if (opts.collectCanaries !== false) {
    for (const w of canariesFromText(line)) {
      if (addCanary(state, w)) {
        console.log(c.cyan + '  + канарейка: ' + c.reset + w);
      }
    }
  }

  const messages: ChatMessage[] = [
    msg.system(state.system),
    ...state.history,
    msg.user(line),
  ];

  console.log(c.gray + '\n  ── модель ────────────────────────────────' + c.reset);
  const started = Date.now();
  let response = '';
  try {
    for await (const delta of state.client.chatStream(messages, chatParams(state))) {
      response += delta;
      process.stdout.write(delta);
    }
  } catch (err) {
    if (response === '') {
      // Фолбэк на нестримящий запрос (клиент/сервер без stream).
      response = await state.client.chat(messages, chatParams(state));
      process.stdout.write(response);
    } else {
      console.log(c.yellow + '\n  [поток оборвался — ответ частичный]' + c.reset);
    }
  }
  const ms = Date.now() - started;
  process.stdout.write('\n' + c.gray + `  (${(ms / 1000).toFixed(1)}s)` + c.reset + '\n');

  if (response.trim() !== '') {
    state.history.push(msg.user(line), msg.assistant(response));
  }

  const analysis = analyzeResponse(response, state.system, state.canaries);
  const verdict = decideVerdict(classification, analysis);
  state.stats = applyVerdict(state.stats, verdict);
  state.lastVerdict = verdict;
  printDetectors(state, analysis, verdict);
  if (opts.showHint !== false) {
    console.log(c.gray + '  подсказка: ' + c.reset + c.cyan + currentCoach(state) + c.reset);
  }
  state.journal.push({ n: state.stats.turns, user: line, classification, response, analysis, verdict, ms });
  return { response, analysis, verdict };
}

// --- Батарея дня 11 (/attacks) против текущего system prompt ---

async function runBattery(state: SecChatState): Promise<void> {
  const target: InjectionTarget = {
    id: `sec-chat-${state.targetLabel}`,
    title: state.targetTitle,
    systemPrompt: state.system,
  };
  console.log(
    c.bold + c.cyan + '\n  ▶ батарея дня 11 (6 атак, от простой к сложной) против текущего system prompt\n' + c.reset,
  );
  const chat = (m: ChatMessage[], p?: ChatParams) => state.client.chat(m, p);
  const results = await runInjectionAttacks(chat, target, defaultAttacks(), {
    temperature: state.temperature,
    seed: state.seed,
    maxTokens: 300,
  });
  let passed = 0;
  for (const r of results) {
    if (r.succeeded) passed += 1;
    const mark = r.succeeded ? c.red + 'АТАКА ПРОШЛА' + c.reset : c.green + 'ЗАЩИТА УДЕРЖАЛА' + c.reset;
    console.log(`  ── [${r.technique}] ${r.attackId} ${c.gray}(${r.detectHint})${c.reset}`);
    console.log(`     вердикт: ${mark}`);
    console.log(indentBlock(r.response, '     | '));
    console.log('');
  }
  const summary = summarizeByTechnique(results);
  const parts = [...summary.entries()].map(([t, s]) => `${t} ${s.passed}/${s.total}`);
  const total = passed === 0 ? c.green : c.red;
  console.log(`  ИТОГО: ${total}атак прошло ${passed} из ${results.length}${c.reset}  ${c.gray}(${parts.join(' · ')})${c.reset}\n`);
}

// --- Коуч: варианты промпта, кейсы, глоссарий ---

function printPromptVariants(state: SecChatState): void {
  console.log('');
  console.log(c.bold + c.cyan + '  Варианты system prompt — от слабого к усиленному' + c.reset);
  for (const v of promptVariants(state.author)) {
    const mark = v.id === state.targetLabel ? c.green + '  ← текущий' + c.reset : '';
    console.log(
      `  ${c.yellow}${v.id.padEnd(16)}${c.reset} ${c.gray}${v.difficulty.padEnd(10)}${c.reset}` +
      `${v.focus}${mark}`,
    );
    console.log(c.gray + '     ' + v.description + c.reset);
  }
  console.log('');
  console.log(
    c.gray + '  /prompt <id> — загрузить промпт (история сбросится) · /sys set <text> — свой\n' + c.reset,
  );
}

function printCaseList(
  title: string,
  items: readonly RedTeamCase[],
  tried: ReadonlySet<string>,
): void {
  console.log(c.bold + c.cyan + '  ' + title + c.reset);
  for (const item of items) {
    const mark = tried.has(item.id) ? c.green + ' ✓' + c.reset : '';
    console.log(
      `  ${String(item.n).padStart(2)}. ${c.yellow}[${item.kind}]${c.reset} ` +
      `${item.title}${mark}`,
    );
    console.log(c.gray + '      детектор: ' + item.detectHint + c.reset);
  }
}

function printCases(state: SecChatState): void {
  const tried = new Set(state.triedCaseIds);
  console.log('');
  printCaseList('5 реальных кейсов из открытых источников', RED_TEAM_CASES.filter((x) => !x.bonus), tried);
  console.log('');
  printCaseList('Дополнительно (день 12)', RED_TEAM_CASES.filter((x) => x.bonus), tried);
  console.log('');
  console.log(
    c.gray + '  /case <n> — подробности · /case <n> send — отправить payload в чат\n' + c.reset,
  );
}

function printCase(item: RedTeamCase): void {
  const kind = item.bonus ? `${item.kind}, дополнительный` : item.kind;
  console.log('');
  console.log(c.bold + c.magenta + `  Кейс ${item.n} · ${item.title}` + c.reset);
  console.log(c.gray + '  тип       ' + c.reset + kind);
  console.log(c.gray + '  источник  ' + c.reset + item.source);
  console.log(c.gray + '  что делает' + c.reset + ' ' + item.whatItDoes);
  console.log(c.gray + '  почему    ' + c.reset + item.whyItWorks);
  console.log(c.gray + '  защита    ' + c.reset + item.defense);
  console.log(c.gray + '  детектор  ' + c.reset + item.detectHint);
  console.log(c.gray + '  промпт    ' + c.reset + `/prompt ${item.suggestedPrompt}`);
  console.log(c.gray + '  payload:' + c.reset);
  console.log(indentBlock(item.payload, '  | '));
  console.log('');
  console.log(c.gray + `  отправить: /case ${item.n} send\n` + c.reset);
}

async function sendCase(state: SecChatState, item: RedTeamCase): Promise<void> {
  if (!state.triedCaseIds.includes(item.id)) state.triedCaseIds.push(item.id);
  const added = item.canaries.filter((w) => addCanary(state, w));
  if (added.length > 0) {
    console.log(c.cyan + '  + канарейки кейса: ' + c.reset + added.join(', '));
  }
  console.log(c.gray + `  /case ${item.n} → payload:` + c.reset);
  console.log(indentBlock(item.payload, '  | '));
  await runTurn(state, item.payload);
}

function printGlossaryList(): void {
  console.log('');
  console.log(c.bold + c.cyan + '  Глоссарий: термины простыми словами' + c.reset);
  for (const e of GLOSSARY) {
    console.log('  ' + c.green + e.id.padEnd(18) + c.reset + e.short);
  }
  console.log('');
  console.log(c.gray + '  /learn <id|термин> — подробнее · /hint <техника> — как атаковать\n' + c.reset);
}

function printGlossaryEntry(entry: GlossaryEntry): void {
  console.log('');
  console.log(c.bold + c.magenta + '  ' + entry.term + c.reset);
  console.log(c.gray + '  коротко: ' + c.reset + entry.short);
  console.log(indentBlock(entry.detail, '  '));
  if (entry.example) console.log(c.gray + '  пример:  ' + c.reset + entry.example);
  console.log('');
}

function printHint(state: SecChatState, arg: string): void {
  const query = arg.trim();
  if (query !== '') {
    const topic = topicHint(query);
    if (topic) {
      console.log('');
      console.log(c.cyan + '  ' + topic + c.reset);
      console.log('');
      return;
    }
    const term = findGlossaryEntry(query);
    if (term) {
      printGlossaryEntry(term);
      return;
    }
    const item = findRedTeamCase(query);
    if (item) {
      printCase(item);
      return;
    }
    console.log(
      c.red + `  Не знаю "${query}". ` + c.reset +
      c.gray + 'Попробуй /learn (список) или /hint (следующий шаг).' + c.reset,
    );
    return;
  }
  console.log('');
  console.log(c.bold + '  Следующий шаг: ' + c.reset + c.cyan + currentCoach(state) + c.reset);
  const next = nextUntriedCase(state.triedCaseIds);
  console.log(
    c.gray + `  Ещё не пробовали: /case ${next.n} — ${next.title}` + c.reset,
  );
  console.log('');
}

// --- Журнал (/export + автосохранение на выходе) ---

function exportJournal(state: SecChatState): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = dataPath(`redteam-journal-${stamp}.md`);
  const s = state.stats;
  const lines: string[] = [
    '# Red-team журнал — sec-chat',
    '',
    `- Дата: ${new Date().toISOString()}`,
    `- Модель: ${state.model}`,
    `- Цель: ${state.targetLabel} — ${state.targetTitle}`,
    `- Параметры: temp ${state.temperature}, seed ${state.seed ?? '-'}`,
    `- Итог: ходов ${s.turns} · атак ${s.attacks} · PASS ${s.passed} · HELD ${s.held} · AMBIG ${s.ambiguous} · dialog ${s.dialog}`,
    `- Канарейки: ${state.canaries.join(', ') || 'нет'}`,
    '',
    '## System prompt',
    '',
    '```text',
    state.system,
    '```',
    '',
  ];
  for (const e of state.journal) {
    lines.push(
      `## Ход ${e.n} — ${e.verdict}`,
      '',
      `- Ввод: \`${e.user.replace(/`/g, "'")}\``,
      `- Классификация: ${e.classification.summary}` +
        (e.classification.hits.length > 0
          ? ` (${e.classification.hits.map((h) => h.patterns.join('; ')).join(' | ')})`
          : ''),
      `- Детекторы: отказ=${e.analysis.refused ? 'да' : 'нет'}, утечка=${e.analysis.promptLeaked ? 'да' : 'нет'}, канарейки=${e.analysis.canaryHits.join(', ') || 'нет'}`,
      `- Время: ${(e.ms / 1000).toFixed(1)}s`,
      '',
      'Ответ модели:',
      '',
      '> ' + e.response.split('\n').join('\n> '),
      '',
    );
  }
  fs.mkdirSync(dataPath(), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

// --- Справка ---

function printHelp(): void {
  const row = (cmd: string, desc: string): void =>
    console.log('  ' + c.green + cmd.padEnd(26) + c.reset + c.gray + desc + c.reset);
  console.log('');
  console.log(c.bold + c.cyan + '  Команды red-team оболочки' + c.reset);
  console.log('');
  console.log(c.bold + '  Цель и промпт' + c.reset);
  row('/prompts', 'варианты system prompt от слабого к усиленному (bank, translator, reviewer, medium, support, hardened)');
  row('/prompt <id>', 'загрузить вариант промпта (сброс истории)');
  row('/target <name>', 'то же, что /prompt (совместимость)');
  row('/sys show', 'показать текущий system prompt');
  row('/sys set <text>', 'задать свой system prompt (одной строкой)');
  row('/sys file <path>', 'загрузить system prompt из файла (UTF-8)');
  row('/sys reset', 'вернуть промпт текущей цели');
  console.log('');
  console.log(c.bold + '  Обучение и кейсы' + c.reset);
  row('/cases', '5 реальных инъекций + 2 кейса дня 12');
  row('/case <n>', 'разбор кейса: источник, механика, защита, payload');
  row('/case <n> send', 'отправить payload кейса в чат');
  row('/learn [term]', 'глоссарий простыми словами (канарейка, FREEDOM, excess grant)');
  row('/hint [topic]', 'следующий шаг или подсказка по технике');
  console.log('');
  console.log(c.bold + '  Детекторы' + c.reset);
  row('/canary list', 'канарейки под наблюдением');
  row('/canary <word>', 'добавить канарейку (можно несколько через пробел)');
  row('/canary rm <word>', 'убрать канарейку');
  row('/attacks', 'батарея 6 атак дня 11 против текущего промпта');
  console.log('');
  console.log(c.bold + '  Сессия' + c.reset);
  row('/stats', 'статистика сессии и параметры');
  row('/history', 'история диалога');
  row('/reset', 'очистить историю (промпт и статистика остаются)');
  row('/temp <N>', 'temperature (0–2, по умолчанию 0.7)');
  row('/seed <N>|off', 'seed генерации для воспроизводимости');
  row('/model', 'показать модель');
  row('/export', 'сохранить журнал сессии в .data/redteam-journal-*.md');
  row('/quit, /exit', 'выход (журнал сохранится автоматически)');
  console.log('');
  console.log(c.gray + '  Просто текст — атака на текущую цель. Tab — автодополнение.\n' + c.reset);
}

// --- Обработка команд ---

async function handleCommand(
  raw: string,
  state: SecChatState,
): Promise<void> {
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'help':
      printHelp();
      return;

    case 'target':
    case 'prompt': {
      if (arg === 'custom') {
        state.targetLabel = 'custom';
        state.targetTitle = 'Свой системный промпт';
        state.targetSystem = SEC_CHAT_DEFAULT_SYSTEM;
        state.system = SEC_CHAT_DEFAULT_SYSTEM;
        state.history = [];
        state.lastVerdict = undefined;
        console.log(c.blue + `${cmd} → custom ${c.gray}(история сброшена, промпт по умолчанию — задай /sys set)` + c.reset);
        return;
      }
      const t = findPromptVariant(state.author, arg);
      if (!t) {
        console.log(c.red + `Неизвестный промпт "${arg}". ` + c.reset + c.gray + 'Список: /prompts' + c.reset);
        return;
      }
      state.targetLabel = t.id;
      state.targetTitle = t.title;
      state.targetSystem = t.systemPrompt;
      state.system = t.systemPrompt;
      state.history = [];
      state.lastVerdict = undefined;
      console.log(c.blue + `${cmd} → ${t.id} ${c.gray}«${t.title}» (история сброшена)` + c.reset);
      return;
    }

    case 'prompts':
      printPromptVariants(state);
      return;

    case 'cases':
      printCases(state);
      return;

    case 'case': {
      if (arg === '') {
        printCases(state);
        return;
      }
      const [which, ...caseRest] = arg.split(/\s+/);
      const item = findRedTeamCase(which ?? '');
      if (!item) {
        console.log(c.red + `Неизвестный кейс "${which}". ` + c.reset + c.gray + '/cases — список.' + c.reset);
        return;
      }
      const action = caseRest.join(' ').trim().toLowerCase();
      if (action === 'send' || action === 'run' || action === 'go') {
        await sendCase(state, item);
        return;
      }
      if (action !== '') {
        console.log(c.gray + `Использование: /case ${item.n} [send]` + c.reset);
        return;
      }
      printCase(item);
      return;
    }

    case 'learn':
    case 'glossary': {
      if (arg === '') {
        printGlossaryList();
        return;
      }
      const term = findGlossaryEntry(arg);
      if (!term) {
        console.log(
          c.red + `Термин "${arg}" не найден. ` + c.reset +
          c.gray + '/learn — список терминов.' + c.reset,
        );
        return;
      }
      printGlossaryEntry(term);
      return;
    }

    case 'hint':
      printHint(state, arg);
      return;

    case 'sys': {
      const [sub, ...sysRest] = arg.split(/\s+/);
      if (sub === 'show' || arg === '') {
        console.log(c.bold + 'system prompt:' + c.reset);
        console.log(indentBlock(state.system, '  | '));
        return;
      }
      if (sub === 'set') {
        const text = sysRest.join(' ').trim();
        if (!text) {
          console.log(c.gray + 'Использование: /sys set <текст промпта одной строкой>' + c.reset);
          return;
        }
        state.system = text;
        state.targetLabel = state.targetLabel === 'custom' ? 'custom' : state.targetLabel + '*';
        state.history = [];
        state.lastVerdict = undefined;
        console.log(c.blue + 'system → ' + c.reset + trunc(text, 60) + c.gray + '  (история сброшена)' + c.reset);
        return;
      }
      if (sub === 'file') {
        const p = sysRest.join(' ').trim();
        if (!p) {
          console.log(c.gray + 'Использование: /sys file <путь к файлу UTF-8>' + c.reset);
          return;
        }
        try {
          state.system = fs.readFileSync(p, 'utf8').trim();
          state.history = [];
          state.lastVerdict = undefined;
          console.log(c.blue + `system → файл ${p} ${c.reset + c.gray}(${state.system.length} симв., история сброшена)` + c.reset);
        } catch (e) {
          console.log(c.red + 'Не удалось прочитать файл: ' + (e instanceof Error ? e.message : String(e)) + c.reset);
        }
        return;
      }
      if (sub === 'reset') {
        state.system = state.targetSystem;
        state.history = [];
        state.lastVerdict = undefined;
        console.log(c.blue + 'system → промпт цели ' + c.reset + trunc(state.targetSystem, 50) + c.gray + '  (история сброшена)' + c.reset);
        return;
      }
      console.log(c.gray + 'Подкоманды /sys: show | set <text> | file <path> | reset' + c.reset);
      return;
    }

    case 'canary': {
      if (arg === '' || arg === 'list') {
        console.log(
          c.cyan + 'канарейки: ' + c.reset + (state.canaries.join(', ') || c.gray + 'нет' + c.reset),
        );
        return;
      }
      if (rest[0] === 'rm') {
        const w = rest.slice(1).join(' ').trim();
        const idx = state.canaries.findIndex((x) => x.toUpperCase() === w.toUpperCase());
        if (idx >= 0) {
          state.canaries.splice(idx, 1);
          console.log(c.yellow + `- канарейка: ${w}` + c.reset);
        } else {
          console.log(c.red + `Канарейка "${w}" не найдена.` + c.reset);
        }
        return;
      }
      const added: string[] = [];
      for (const w of arg.split(/\s+/)) {
        if (addCanary(state, w)) added.push(w.trim());
      }
      if (added.length > 0) console.log(c.cyan + '+ канарейки: ' + c.reset + added.join(', '));
      return;
    }

    case 'attacks':
      await runBattery(state);
      return;

    case 'stats': {
      const s = state.stats;
      console.log('');
      console.log(c.bold + 'Сессия:' + c.reset);
      console.log(c.gray + '  цель    ' + c.reset + `${state.targetLabel} — ${state.targetTitle}`);
      console.log(c.gray + '  модель  ' + c.reset + `${state.model} (temp ${state.temperature}, seed ${state.seed ?? '-'})`);
      console.log(c.gray + '  ходы    ' + c.reset + `${s.turns} · атак ${s.attacks}`);
      console.log(
        c.gray + '  вердикты' + c.reset +
        ` ${c.red}PASS ${s.passed}${c.reset} · ${c.green}HELD ${s.held}${c.reset} · ${c.yellow}AMBIG ${s.ambiguous}${c.reset} · ${c.gray}dialog ${s.dialog}${c.reset}`,
      );
      console.log(c.gray + '  канар.  ' + c.reset + (state.canaries.join(', ') || 'нет'));
      console.log('');
      return;
    }

    case 'history': {
      if (state.history.length === 0) {
        console.log(c.gray + 'История пуста.' + c.reset);
        return;
      }
      console.log('');
      state.history.forEach((m, i) => {
        const who = m.role === 'user' ? c.yellow + 'user' + c.reset : c.green + 'model' + c.reset;
        console.log(`${c.gray}[${i}]${c.reset} ${who}: ${trunc(m.content.replace(/\n/g, ' '), 160)}`);
      });
      console.log('');
      return;
    }

    case 'reset':
      state.history = [];
      state.lastVerdict = undefined;
      console.log(c.yellow + 'reset' + c.reset + c.gray + '  история очищена (промпт, канарейки и статистика сохранены)' + c.reset);
      return;

    case 'temp': {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0 || n > 2) {
        console.log(c.gray + 'Использование: /temp <0..2>' + c.reset);
        return;
      }
      state.temperature = n;
      console.log(c.magenta + `temp → ${n}` + c.reset);
      return;
    }

    case 'seed': {
      if (arg === 'off') {
        state.seed = undefined;
        console.log(c.magenta + 'seed → off' + c.reset);
        return;
      }
      const n = Number(arg);
      if (!Number.isSafeInteger(n)) {
        console.log(c.gray + 'Использование: /seed <целое> | off' + c.reset);
        return;
      }
      state.seed = n;
      console.log(c.magenta + `seed → ${n}` + c.reset);
      return;
    }

    case 'model':
      console.log(c.gray + 'модель: ' + c.reset + state.model);
      return;

    case 'export': {
      const file = exportJournal(state);
      console.log(c.green + 'журнал → ' + c.reset + file);
      return;
    }

    case 'quit':
    case 'exit':
      return;

    default:
      console.log(c.red + `Неизвестная команда /${cmd}` + c.reset + c.gray + '  /help — список.' + c.reset);
  }
}

// --- Автоматический live-демо (sec-chat --auto) ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printAutoBanner(day: DemoDay, state: SecChatState, pauseMs: number): void {
  console.log('');
  console.log(c.gray + RULE + c.reset);
  console.log(
    c.bold + c.magenta + '  RED TEAM LIVE DEMO' + c.reset +
      c.gray + `  ·  ${day} · автоматический скрипт` + c.reset,
  );
  console.log(c.gray + RULE + c.reset);
  console.log(c.gray + '  model   ' + c.reset + state.model);
  console.log(c.gray + '  seed    ' + c.reset + (state.seed ?? '-'));
  console.log(c.gray + '  pause   ' + c.reset + `${pauseMs} ms`);
  console.log(
    c.gray + '  flow    ' + c.reset +
      'профиль → атака → ответ модели → детектор → следующий профиль',
  );
  console.log(c.gray + RULE + c.reset);
  console.log('');
}

function printUserTurn(text: string, label: string): void {
  console.log(c.gray + `\n  👤 ${label}:` + c.reset);
  console.log(indentBlock(text, '     '));
}

function switchAutoTarget(state: SecChatState, id: string): boolean {
  const variant = findPromptVariant(state.author, id);
  if (!variant) {
    console.log(c.red + `  профиль ${id} не найден — пропуск` + c.reset);
    return false;
  }
  state.targetLabel = variant.id;
  state.targetTitle = variant.title;
  state.targetSystem = variant.systemPrompt;
  state.system = variant.systemPrompt;
  state.history = [];
  state.lastVerdict = undefined;
  state.canaries = [...LAB_CANARIES];
  console.log(
    c.blue + `\n  /target ${variant.id} ${c.gray}«${variant.title}» (история сброшена)` + c.reset,
  );
  return true;
}

async function runDay11ChatDemo(state: SecChatState, pauseMs: number): Promise<void> {
  console.log(c.bold + c.cyan + '\n══ DAY 11 · DIRECT PROMPT INJECTION · live ══' + c.reset);
  const steps = day11ChatSteps(defaultDay11Targets(state.author));
  let currentProfile = '';
  let profileResults: { readonly passed: boolean }[] = [];
  let dayPassed = 0;

  const flushProfile = (): void => {
    if (currentProfile === '') return;
    const passed = profileResults.filter((r) => r.passed).length;
    console.log(
      c.bold +
        `\n  профиль ${currentProfile}: атак прошло ${passed} из ${profileResults.length}` +
        c.reset,
    );
    profileResults = [];
  };

  for (const [index, step] of steps.entries()) {
    if (step.target.id !== currentProfile) {
      flushProfile();
      currentProfile = step.target.id;
      if (!switchAutoTarget(state, step.target.id)) {
        currentProfile = '';
        continue;
      }
    }

    console.log(
      c.gray +
        `\n  ▸ ход ${index + 1}/${steps.length} · [${step.attack.technique}] ${step.attack.title}` +
        c.reset,
    );
    printUserTurn(step.attack.userText, 'атакующий');
    const turn = await runTurn(state, step.attack.userText, {
      showHint: false,
      collectCanaries: false,
    });
    const succeeded = step.attack.detect(turn.response, step.target);
    console.log(
      `  ${c.bold}детектор атаки:${c.reset} ` +
        (succeeded
          ? c.red + 'АТАКА ПРОШЛА' + c.reset
          : c.green + 'ЗАЩИТА УДЕРЖАЛА' + c.reset) +
        c.gray + `  (${step.attack.detectHint})` + c.reset,
    );
    profileResults.push({ passed: succeeded });
    if (succeeded) dayPassed += 1;
    await sleep(pauseMs);
  }
  flushProfile();
  console.log(
    c.bold + `\n  ИТОГО day-11: атак прошло ${dayPassed} из ${steps.length}` + c.reset,
  );
}

async function runDay12ChatDemo(state: SecChatState, pauseMs: number): Promise<void> {
  console.log(c.bold + c.cyan + '\n══ DAY 12 · INDIRECT PROMPT INJECTION · live ══' + c.reset);
  const steps = day12ChatSteps();
  let currentVector = '';
  let vectorResults: {
    readonly passed: boolean;
    readonly mode: DefenseMode;
    readonly succeeded: boolean;
    readonly blocked: boolean;
  }[] = [];
  let dayPassed = 0;

  const flushVector = (): void => {
    if (currentVector === '') return;
    const passed = vectorResults.filter((r) => r.passed).length;
    console.log(
      c.bold + `\n  вектор ${currentVector}: прошло ${passed} из ${vectorResults.length}` + c.reset,
    );
    vectorResults = [];
  };

  for (const [index, step] of steps.entries()) {
    if (step.vector.id !== currentVector) {
      flushVector();
      currentVector = step.vector.id;
      state.targetLabel = step.vector.id;
      state.targetTitle = step.vector.title;
      state.targetSystem = step.vector.agentSystemPrompt;
      state.system = step.vector.agentSystemPrompt;
      state.history = [];
      state.lastVerdict = undefined;
      state.canaries = [...step.vector.successMarkers];
      console.log(c.magenta + `\n  ── вектор ${step.vector.id}: ${step.vector.title} ──` + c.reset);
      console.log(c.gray + '  ' + step.vector.description + c.reset);
      console.log(c.gray + '\n  данные, которые читает агент:' + c.reset);
      console.log(indentBlock(step.vector.taintedContent, '     '));
    }

    const prepared = prepareIndirectPrompt(step.vector, step.mode);
    state.system = prepared.system;
    state.history = [];
    state.lastVerdict = undefined;

    console.log(
      c.gray + `\n  ▸ ход ${index + 1}/${steps.length} · режим защиты: ${step.mode}` + c.reset,
    );
    console.log(
      c.gray + `     payload дожил до промпта: ${prepared.payloadSurvived ? 'ДА' : 'НЕТ'}` + c.reset,
    );
    printUserTurn(trunc(prepared.userContent, 900), 'агент получает задачу + данные');
    const turn = await runTurn(state, prepared.userContent, {
      showHint: false,
      collectCanaries: false,
    });
    const succeeded = step.vector.detect(turn.response);
    const validation = validateOutput(turn.response, step.vector.successMarkers);
    const blocked = prepared.outputLayer && !validation.ok;
    const passed = succeeded && !blocked;
    console.log(
      `  ${c.bold}детектор вектора:${c.reset} ` +
        (succeeded
          ? c.red + 'модель выполнила payload' + c.reset
          : c.green + 'модель не выполнила' + c.reset) +
        c.gray +
        `  · output-валидатор: ${prepared.outputLayer ? (blocked ? 'ЗАБЛОКИРОВАЛ' : 'пропустил') : 'выключен'}` +
        c.reset,
    );
    console.log(
      `  ${c.bold}ИТОГ С УЧЁТОМ ЗАЩИТЫ:${c.reset} ` +
        (passed ? c.red + 'АТАКА ПРОШЛА' + c.reset : c.green + 'АТАКА НЕ ПРОШЛА' + c.reset),
    );
    vectorResults.push({ passed, mode: step.mode, succeeded, blocked });
    if (passed) dayPassed += 1;
    await sleep(pauseMs);
  }
  flushVector();
  console.log(
    c.bold + `\n  ИТОГО day-12: атак прошло ${dayPassed} из ${steps.length}` + c.reset,
  );
}

async function runAutoDemo(
  state: SecChatState,
  day: DemoDay,
  pauseMs: number,
): Promise<void> {
  printAutoBanner(day, state, pauseMs);
  if (day === 'day-11' || day === 'all') {
    await runDay11ChatDemo(state, pauseMs);
    console.log('');
  }
  if (day === 'day-12' || day === 'all') {
    await runDay12ChatDemo(state, pauseMs);
    console.log('');
  }
  console.log(c.gray + RULE + c.reset);
}

function printSessionSummary(state: SecChatState): void {
  if (state.journal.length > 0) {
    const file = exportJournal(state);
    console.log('\n' + c.green + 'журнал сессии → ' + c.reset + file);
  }
  const s = state.stats;
  console.log(
    c.gray +
      `итог: ходов ${s.turns} · атак ${s.attacks} · ${c.reset}${c.red}PASS ${s.passed}${c.reset}${c.gray} · ${c.reset}${c.green}HELD ${s.held}${c.reset}${c.gray} · ${c.reset}${c.yellow}AMBIG ${s.ambiguous}${c.reset}\n`,
  );
}

// --- Главный цикл ---

export async function startSecChat(client: LlmClient, opts: SecChatOptions): Promise<void> {
  const state: SecChatState = {
    client,
    model: opts.model,
    author: opts.author ?? 'Гоша',
    targetLabel: opts.targetLabel,
    targetTitle: opts.targetTitle,
    targetSystem: opts.system,
    system: opts.system,
    temperature: opts.temperature ?? 0.7,
    seed: opts.seed,
    canaries: [...LAB_CANARIES],
    history: [],
    stats: emptyStats(),
    journal: [],
    triedCaseIds: [],
  };

  if (opts.auto) {
    await runAutoDemo(state, opts.auto, opts.pauseMs ?? 700);
    printSessionSummary(state);
    return;
  }

  printBanner(state);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: formatPrompt(state),
    completer: makeCompleter(),
  });
  rl.prompt();

  let closed = false;
  let finished = false;
  let chain: Promise<void> = Promise.resolve();

  const finish = (): void => {
    if (finished) return;
    finished = true;
    printSessionSummary(state);
  };

  rl.on('line', (raw: string) => {
    if (closed) return;
    const line = raw.trim();
    if (line === '') {
      if (!closed) rl.prompt();
      return;
    }
    chain = chain
      .then(async () => {
        if (line === '/quit' || line === '/exit') {
          closed = true;
          rl.close();
          return;
        }
        if (line.startsWith('/')) {
          await handleCommand(line, state);
          return;
        }
        await runTurn(state, line);
      })
      .catch((err: unknown) => {
        const msgText = err instanceof Error ? err.message : String(err);
        console.log(
          c.red + '  ошибка: ' + c.reset + msgText +
          c.gray + '  (Ollama запущен? LOCAL_LLM_BASE_URL верный?)' + c.reset,
        );
      })
      .then(() => {
        if (!closed) {
          rl.setPrompt(formatPrompt(state));
          rl.prompt();
        }
      });
  });

  rl.on('close', () => {
    closed = true;
    chain
      .then(() => {
        finish();
      })
      .catch(() => {
        finish();
      });
  });

  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      resolve();
    });
  });
}
