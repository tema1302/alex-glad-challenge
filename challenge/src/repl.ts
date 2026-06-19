// Интерактивный чат-REPL с агентом.
// Переиспользует LlmClient и стратегии контекста из core/.
//
// Запуск:
//   pnpm --filter challenge start
//   pnpm --filter challenge start -- chat --strategy sliding --system "Ты ревьюер"

import { createInterface } from 'node:readline/promises';
import pathModule from 'node:path';

import { Agent, Branching, type ContextStrategy, FullHistory, LlmClient, Memory, msg, SlidingWindow, StickyFacts } from './core/index.js';
import { demos, findDemo } from './demos/registry.js';

interface ReplOptions {
  systemPrompt?: string;
  strategyName?: string;
  windowSize?: number;
}

const DEFAULT_SYSTEM = 'Ты — ассистент в CLI. Отвечай кратко и по делу.';
const STRATEGY_NAMES = ['full', 'sliding', 'sticky', 'branching'] as const;
type StrategyName = (typeof STRATEGY_NAMES)[number];

// --- ANSI-цвета (без внешних зависимостей) ---
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

function makeStrategy(name: StrategyName, windowSize: number): ContextStrategy {
  switch (name) {
    case 'sliding': return new SlidingWindow(windowSize);
    case 'sticky': return new StickyFacts(windowSize);
    case 'branching': return new Branching();
    case 'full':
    default: return new FullHistory();
  }
}

function isStrategyName(s: string): s is StrategyName {
  return (STRATEGY_NAMES as ReadonlyArray<string>).includes(s);
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface SessionState {
  agent: Agent;
  client: LlmClient;
  strategy: ContextStrategy;
  system: string;
  windowSize: number;
  usage: Usage;
  memory: Memory;
  memoryEnabled: boolean;
}

export async function startRepl(client: LlmClient, opts: ReplOptions = {}): Promise<void> {
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM;
  const strategyName = opts.strategyName ?? 'full';
  const windowSize = opts.windowSize ?? 10;

  const state: SessionState = {
    agent: new Agent(client, system),
    client,
    strategy: makeStrategy(isStrategyName(strategyName) ? strategyName : 'full', windowSize),
    system,
    windowSize,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    memory: new Memory({ filePath: pathModule.join(process.cwd(), '.data', 'memory.json'), shortTermLimit: windowSize }),
    memoryEnabled: false,
  };

  // Загружаем long-term с диска при старте.
  const loaded = state.memory.loadLongTerm();
  if (loaded > 0) {
    state.memoryEnabled = true;
  }

  printBanner(state);
  printCompactHelp();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: formatPrompt(state),
  });

  rl.prompt();

  let closed = false;

  rl.on('line', async (raw: string) => {
    const line = raw.trim();
    if (line === '') { if (!closed) rl.prompt(); return; }

    if (line === '/quit' || line === '/exit') {
      closed = true;
      rl.close();
      return;
    }

    if (line.startsWith('/')) {
      await handleCommand(line, state, rl);
      if (!closed) {
        rl.setPrompt(formatPrompt(state));
        rl.prompt();
      }
      return;
    }

    // Обычное сообщение.
    process.stdout.write(c.dim + '... ' + c.reset);
    try {
      let context: import('./core/index.js').ChatMessage[];
      if (state.memoryEnabled) {
        // Memory mode: short-term из memory, working + long-term инжектятся.
        state.memory.addMessage(msg.user(line));
        context = state.memory.context(state.system);
      } else {
        // Strategy mode (по умолчанию).
        state.strategy.addMessage(msg.user(line));
        context = state.strategy.context();
      }

      const { content, usage: u } = await client.chatWithUsage(context, {
        temperature: 0.7,
      });
      accumulateUsage(state.usage, u);
      if (state.memoryEnabled) {
        state.memory.addMessage(msg.assistant(content));
      } else {
        state.strategy.addMessage(msg.assistant(content));
      }
      process.stdout.write('\r' + ' '.repeat(4) + '\r');
      console.log(c.green + c.bold + 'assistant' + c.reset + ': ' + content);
      console.log(c.gray + `  ↑ ${u.prompt_tokens}/${u.completion_tokens}/${u.total_tokens} tok · Σ ${state.usage.total_tokens}` + c.reset);
      console.log('');
    } catch (err) {
      process.stdout.write('\r' + ' '.repeat(4) + '\r');
      console.log(c.red + 'error' + c.reset + ': ' + (err as Error).message + '\n');
    }
    if (!closed) {
      rl.setPrompt(formatPrompt(state));
      rl.prompt();
    }
  });

  rl.on('close', () => { closed = true; });

  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      console.log('\n' + c.gray + 'session closed.' + c.reset);
      resolve();
    });
  });
}

function accumulateUsage(acc: Usage, add: Usage): void {
  acc.prompt_tokens += add.prompt_tokens;
  acc.completion_tokens += add.completion_tokens;
  acc.total_tokens += add.total_tokens;
}

function formatPrompt(state: SessionState): string {
  const stratTag = c.magenta + (state.memoryEnabled ? 'mem' : state.strategy.name) + c.reset;
  const tokTag = c.gray + `${state.usage.total_tokens} tok` + c.reset;
  const branchInfo = (!state.memoryEnabled && state.strategy instanceof Branching)
    ? ' ' + c.blue + `#${state.strategy.activeBranchId}` + c.reset
    : '';
  const memTag = state.memoryEnabled && state.memory.longTermKeys.length > 0
    ? ' ' + c.yellow + `★${state.memory.longTermKeys.length}` + c.reset
    : '';
  return `${stratTag}${branchInfo}${memTag} ${tokTag}> `;
}

function printBanner(state: SessionState): void {
  const line = c.gray + '─'.repeat(56) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + c.cyan + '  LLM Challenge REPL' + c.reset + c.gray + '  ·  monolith chat agent' + c.reset);
  console.log(line);
  console.log(c.gray + '  model   ' + c.reset + state.client.defaultModel);
  console.log(c.gray + '  context ' + c.reset + state.strategy.name);
  console.log(c.gray + '  system  ' + c.reset + trunc(state.system, 50));
  console.log(line);
  console.log('');
}

function printCompactHelp(): void {
  console.log(c.gray + '  Команды начинаются с /. Просто пишите текст — отправится в LLM.' + c.reset);
  console.log(c.gray + '  /help — полный список, /quit — выход.\n' + c.reset);
}

async function handleCommand(raw: string, state: SessionState, _rl: unknown): Promise<void> {
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'help':
    case 'h': {
      printFullHelp(state);
      return;
    }
    case 'status':
    case 'st': {
      printStatus(state);
      return;
    }
    case 'list': {
      printDemosList();
      return;
    }
    case 'day': {
      if (!arg) { console.log(c.gray + 'Использование: /day <id>, например /day day-06\n' + c.reset); return; }
      const demo = findDemo(arg);
      if (!demo) { console.log(c.red + `День "${arg}" не найден. /list покажет все.` + c.reset + '\n'); return; }
      console.log(c.cyan + demo.id + c.reset + '  ' + demo.title + '\n');
      return;
    }
    case 'strategy': {
      if (!arg) {
        console.log(c.gray + `Текущая стратегия: ${state.strategy.name}. Доступно: full, sliding, sticky, branching\n` + c.reset);
        return;
      }
      if (!isStrategyName(arg)) {
        console.log(c.red + `Неизвестная стратегия "${arg}". Доступно: full, sliding, sticky, branching` + c.reset + '\n');
        return;
      }
      state.strategy = makeStrategy(arg, state.windowSize);
      console.log(c.magenta + 'strategy → ' + arg + c.reset + c.gray + '  (история сброшена)\n' + c.reset);
      return;
    }
    case 'system': {
      if (!arg) {
        console.log(c.gray + 'Текущий system: ' + state.system + '\n');
        console.log(c.gray + 'Сменить: /system <новый system-промпт>\n' + c.reset);
        return;
      }
      state.system = arg;
      state.agent.reset();
      state.strategy = makeStrategy(state.strategy.name === 'branching' ? 'branching' : 'full', state.windowSize);
      state.strategy.clear();
      state.strategy.addMessage(msg.system(arg));
      console.log(c.blue + 'system → ' + c.reset + trunc(arg, 60) + c.gray + '  (история сброшена)\n' + c.reset);
      return;
    }
    case 'branch': {
      if (!(state.strategy instanceof Branching)) {
        console.log(c.yellow + 'Команда доступна только в /strategy branching' + c.reset + '\n');
        return;
      }
      const id = state.strategy.checkpoint(arg || `branch-${Date.now()}`);
      console.log(c.blue + 'branch +' + c.reset + ` id=${id} "${arg || 'auto'}"\n`);
      return;
    }
    case 'switch': {
      if (!(state.strategy instanceof Branching)) {
        console.log(c.yellow + 'Команда доступна только в /strategy branching' + c.reset + '\n');
        return;
      }
      const id = Number(arg);
      if (!Number.isFinite(id)) {
        console.log(c.gray + 'Использование: /switch <id>\n' + c.reset);
        return;
      }
      try {
        state.strategy.switchTo(id);
        console.log(c.blue + 'switch → ' + c.reset + `ветка ${id}\n`);
      } catch (e) {
        console.log(c.red + (e as Error).message + c.reset + '\n');
      }
      return;
    }
    case 'branches': {
      if (!(state.strategy instanceof Branching)) {
        console.log(c.yellow + 'Команда доступна только в /strategy branching' + c.reset + '\n');
        return;
      }
      const list = state.strategy.listBranches();
      if (list.length === 0) {
        console.log(c.gray + 'Нет веток (только main).\n' + c.reset);
        return;
      }
      console.log(c.bold + 'Ветки:' + c.reset);
      for (const info of list) {
        const marker = info.id === state.strategy.activeBranchId ? c.green + ' *' + c.reset : '  ';
        console.log(`${marker} ${c.gray}#${info.id}${c.reset}  ${info.label}  ${c.gray}(${info.messageCount} сообщений)${c.reset}`);
      }
      console.log('');
      return;
    }
    case 'reset': {
      state.strategy.clear();
      state.agent.reset();
      state.strategy.addMessage(msg.system(state.system));
      state.memory.clearShortTerm();
      state.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      console.log(c.yellow + 'reset' + c.reset + c.gray + '  история, ветки, usage (system + long-term сохранены)\n' + c.reset);
      return;
    }
    case 'remember': {
      if (!arg) {
        console.log(c.gray + 'Использование: /remember <ключ>: <значение>\n  Пример: /remember имя: Артём\n' + c.reset);
        return;
      }
      const sep = arg.indexOf(':');
      if (sep === -1) {
        console.log(c.red + 'Формат: /remember <ключ>: <значение>' + c.reset + '\n');
        return;
      }
      const key = arg.slice(0, sep).trim();
      const value = arg.slice(sep + 1).trim();
      state.memory.remember(key, value);
      state.memoryEnabled = true;
      console.log(c.yellow + '★ long-term' + c.reset + ` + "${key}: ${value}"`);
      console.log(c.gray + '  (всего в long-term: ' + state.memory.longTermKeys.length + ')\n' + c.reset);
      return;
    }
    case 'forget': {
      if (!arg) {
        console.log(c.gray + 'Использование: /forget <ключ>\n  Например: /forget имя\n' + c.reset);
        return;
      }
      if (state.memory.forget(arg)) {
        console.log(c.yellow + '★ long-term' + c.reset + ` - "${arg}"`);
        console.log(c.gray + '  (осталось: ' + state.memory.longTermKeys.length + ')\n' + c.reset);
      } else {
        console.log(c.red + `Ключ "${arg}" не найден в long-term.` + c.reset + '\n');
      }
      return;
    }
    case 'task': {
      if (!arg) {
        if (state.memory.task) {
          console.log(c.gray + 'Текущая задача: ' + c.reset + state.memory.task + '\n');
        } else {
          console.log(c.gray + 'Нет активной задачи. Задать: /task <описание>\n' + c.reset);
        }
        return;
      }
      state.memory.setTask(arg);
      state.memoryEnabled = true;
      console.log(c.blue + 'task' + c.reset + ` → ${arg}\n`);
      return;
    }
    case 'task-add': {
      if (!arg) {
        console.log(c.gray + 'Использование: /task-add <ключ>: <значение>\n' + c.reset);
        return;
      }
      const sep = arg.indexOf(':');
      if (sep === -1) {
        console.log(c.red + 'Формат: /task-add <ключ>: <значение>' + c.reset + '\n');
        return;
      }
      const key = arg.slice(0, sep).trim();
      const value = arg.slice(sep + 1).trim();
      state.memory.setWorkingFact(key, value);
      state.memoryEnabled = true;
      console.log(c.blue + 'task' + c.reset + ` + "${key}: ${value}"\n`);
      return;
    }
    case 'task-clear': {
      state.memory.clearWorking();
      console.log(c.blue + 'task' + c.reset + c.gray + ' cleared (задача + факты)\n' + c.reset);
      return;
    }
    case 'memory': {
      printMemory(state);
      return;
    }
    case 'memory-save': {
      state.memory.saveLongTerm();
      console.log(c.green + 'long-term сохранён на диск.' + c.reset + '\n');
      return;
    }
    case 'memory-on': {
      state.memoryEnabled = true;
      console.log(c.green + 'Memory mode ON' + c.reset + c.gray + '  (context строится из 3 слоёв памяти)\n' + c.reset);
      return;
    }
    case 'memory-off': {
      state.memoryEnabled = false;
      console.log(c.gray + 'Memory mode OFF' + c.reset + c.gray + '  (context строится из strategy)\n' + c.reset);
      return;
    }
    case 'usage': {
      const u = state.usage;
      const bar = '█'.repeat(Math.min(20, Math.round(u.total_tokens / 500))) +
                  '░'.repeat(Math.max(0, 20 - Math.round(u.total_tokens / 500)));
      console.log(c.bold + 'Использование токенов:' + c.reset);
      console.log(c.gray + '  prompt     ' + c.reset + u.prompt_tokens);
      console.log(c.gray + '  completion ' + c.reset + u.completion_tokens);
      console.log(c.gray + '  total      ' + c.reset + u.total_tokens);
      console.log(c.gray + '  ' + bar + c.reset + '\n');
      return;
    }
    case 'quit':
    case 'exit':
      return;
    default:
      console.log(c.red + `Неизвестная команда /${cmd}` + c.reset + c.gray + '  /help — список.\n' + c.reset);
  }
}

function printFullHelp(state: SessionState): void {
  const header = (text: string) => console.log(c.bold + c.cyan + text + c.reset);
  const row = (cmd: string, desc: string) => console.log('  ' + c.green + cmd.padEnd(28) + c.reset + c.gray + desc + c.reset);

  console.log('');
  header('Состояние сессии');
  row('/status', 'текущая модель, стратегия, system, usage');
  row('/usage', 'накопленные токены с прогресс-баром');
  console.log('');
  header('Контекст');
  row('/strategy [name]', 'full | sliding | sticky | branching');
  row('/system <text>', 'сменить system-промпт');
  row('/reset', 'очистить историю и usage (system + long-term сохраняются)');
  console.log('');
  header('Память (день 11: 3 слоя)');
  row('/remember <key>: <val>', 'сохранить в long-term (переживает перезапуск)');
  row('/forget <key>', 'удалить из long-term');
  row('/task <description>', 'задать текущую задачу (working memory)');
  row('/task-add <key>: <val>', 'добавить факт в working memory');
  row('/task-clear', 'очистить working memory');
  row('/memory', 'показать все 3 слоя памяти');
  row('/memory-save', 'записать long-term на диск');
  row('/memory-on', 'включить memory mode (context из 3 слоёв)');
  row('/memory-off', 'выключить (обычная strategy)');
  console.log('');
  header('Ветки диалога  (только в /strategy branching)');
  row('/branch [label]', 'чекпойнт + новая ветка');
  row('/switch <id>', 'переключиться на ветку');
  row('/branches', 'список веток');
  console.log('');
  header('Блог-агенты');
  row('/news [opts]', 'pipeline RSS→агенты→пост. Опции: --hours N --top K --for i --publish');
  row('/db-stats', 'статистика БД: новости, посты, образцы стиля');
  console.log('');
  header('Дни');
  row('/list', 'список всех дней');
  row('/day <id>', 'инфо о дне (например /day day-06)');
  console.log('');
  header('Системные');
  row('/help, /h', 'эта справка');
  row('/quit, /exit', 'выход (или Ctrl+D)');
  console.log('');
  const mode = state.memoryEnabled ? c.green + 'memory' + c.reset : c.magenta + state.strategy.name + c.reset;
  console.log(c.gray + 'Режим контекста: ' + mode + '\n');
}

function printMemory(state: SessionState): void {
  const line = c.gray + '─'.repeat(50) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + '  Memory Layers (день 11)' + c.reset);
  console.log(line);

  // Long-term.
  console.log(c.yellow + '  LONG-TERM' + c.reset + c.gray + '  (.data/memory.json, переживает перезапуск)' + c.reset);
  const ltKeys = state.memory.longTermKeys;
  if (ltKeys.length === 0) {
    console.log(c.gray + '    (пусто)' + c.reset);
  } else {
    for (const k of ltKeys) {
      console.log(c.gray + '    ' + c.reset + k + ': ' + state.memory.recall(k));
    }
  }

  // Working.
  console.log(c.blue + '\n  WORKING' + c.reset + c.gray + '  (RAM, данные текущей задачи)' + c.reset);
  if (state.memory.task) {
    console.log(c.gray + '    задача: ' + c.reset + state.memory.task);
  }
  const wKeys = state.memory.workingKeys;
  if (wKeys.length === 0 && !state.memory.task) {
    console.log(c.gray + '    (пусто)' + c.reset);
  } else {
    for (const k of wKeys) {
      console.log(c.gray + '    ' + c.reset + k + ': ' + state.memory.getWorkingFact(k));
    }
  }

  // Short-term.
  console.log(c.gray + '\n  SHORT-TERM' + c.reset + c.gray + '  (RAM, последние сообщения)' + c.reset);
  const snap = state.memory.snapshot();
  console.log(c.gray + '    сообщений: ' + snap.shortTermCount + c.reset);

  // Mode.
  console.log(c.gray + '\n  режим: ' + c.reset + (state.memoryEnabled ? c.green + 'memory ON' + c.reset : c.gray + 'memory OFF (strategy mode)' + c.reset));
  console.log(line + '\n');
}

function printStatus(state: SessionState): void {
  const line = c.gray + '─'.repeat(40) + c.reset;
  console.log('');
  console.log(line);
  console.log(c.bold + '  Status' + c.reset);
  console.log(line);
  console.log(c.gray + '  model    ' + c.reset + state.client.defaultModel);
  const mode = state.memoryEnabled ? c.green + 'memory' + c.reset : state.strategy.name;
  console.log(c.gray + '  context  ' + c.reset + mode);
  if (state.memoryEnabled) {
    console.log(c.gray + '  long-term' + c.reset + ' ' + state.memory.longTermKeys.length + ' entries');
    console.log(c.gray + '  working  ' + c.reset + ' ' + state.memory.workingKeys.length + ' facts');
  } else if (state.strategy instanceof Branching) {
    console.log(c.gray + '  branch   ' + c.reset + '#' + state.strategy.activeBranchId);
  }
  console.log(c.gray + '  system   ' + c.reset + trunc(state.system, 50));
  console.log(c.gray + '  tokens   ' + c.reset + `Σ ${state.usage.total_tokens} (↑${state.usage.prompt_tokens}/↓${state.usage.completion_tokens})`);
  console.log(line + '\n');
}

function printDemosList(): void {
  console.log(c.bold + 'Дни:' + c.reset);
  for (const d of demos) {
    console.log('  ' + c.cyan + d.id.padEnd(10) + c.reset + d.title);
  }
  console.log('');
}
