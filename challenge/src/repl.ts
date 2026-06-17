// Интерактивный чат-REPL с агентом.
// Единая точка входа для диалога с LLM, внутри которого можно переключать
// стратегии контекста, system-промпт, ветки диалога и смотреть статистику.
//
// Использование из CLI:
//   pnpm --filter challenge start -- chat
//   pnpm --filter challenge start -- chat --strategy sliding
//   pnpm --filter challenge start -- chat --system "Ты суровый ревьюер"

import { createInterface } from 'node:readline/promises';

import { Agent, Branching, type ChatMessage, type ContextStrategy, FullHistory, LlmClient, msg, SlidingWindow, StickyFacts } from './core/index.js';
import { demos, findDemo } from './demos/registry.js';

interface ReplOptions {
  systemPrompt: string;
  strategyName: string;
  windowSize: number;
}

const DEFAULT_SYSTEM = 'Ты — ассистент в CLI. Отвечай кратко и по делу.';
const STRATEGY_NAMES = ['full', 'sliding', 'sticky', 'branching'] as const;
type StrategyName = (typeof STRATEGY_NAMES)[number];

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

export async function startRepl(client: LlmClient, opts: Partial<ReplOptions> = {}): Promise<void> {
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM;
  const strategyName = opts.strategyName ?? 'full';
  const windowSize = opts.windowSize ?? 10;

  const agent = new Agent(client, systemPrompt);
  let strategy = makeStrategy(isStrategyName(strategyName) ? strategyName : 'full', windowSize);
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  console.log('=== Interactive LLM REPL ===');
  console.log(`Стратегия: ${strategy.name} | system: ${trunc(systemPrompt, 50)}`);
  console.log('Команды: /help, /list, /day <id>, /strategy <full|sliding|sticky|branching>,');
  console.log('         /system <text>, /branch <label>, /switch <id>, /branches,');
  console.log('         /reset, /usage, /quit\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    let line: string;
    try {
      line = await rl.question('> ');
    } catch {
      break; // Ctrl+D / EOF
    }
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed === '/quit' || trimmed === '/exit') break;

    if (trimmed.startsWith('/')) {
      const handled = await handleCommand(trimmed, {
        agent,
        getStrategy: () => strategy,
        setStrategy: (s) => { strategy = s; },
        makeStrategy,
        isStrategyName,
        windowSize,
        getUsage: () => usage,
        resetUsage: () => { usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }; },
        rl,
      });
      if (handled === 'quit') break;
      continue;
    }

    // Обычное сообщение — через стратегию контекста.
    strategy.addMessage(msg.user(trimmed));
    try {
      const { content, usage: u } = await client.chatWithUsage(strategy.context(), {
        temperature: 0.7,
      });
      usage.prompt_tokens += u.prompt_tokens;
      usage.completion_tokens += u.completion_tokens;
      usage.total_tokens += u.total_tokens;
      strategy.addMessage(msg.assistant(content));
      console.log(content + '\n');
    } catch (err) {
      console.error('Ошибка: ' + (err as Error).message + '\n');
    }
  }

  rl.close();
  console.log('Пока!');
}

interface CommandCtx {
  agent: Agent;
  getStrategy: () => ContextStrategy;
  setStrategy: (s: ContextStrategy) => void;
  makeStrategy: (name: StrategyName, windowSize: number) => ContextStrategy;
  isStrategyName: (s: string) => s is StrategyName;
  windowSize: number;
  getUsage: () => { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  resetUsage: () => void;
  rl: { question: (q: string) => Promise<string> };
}

type CommandResult = 'continue' | 'quit';

async function handleCommand(raw: string, ctx: CommandCtx): Promise<CommandResult> {
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'help':
    case 'h': {
      console.log('/help                   эта справка');
      console.log('/list                   список всех дней');
      console.log('/day <id>               показать инфо о дне (без переключения контекста)');
      console.log('/strategy <name>        full | sliding | sticky | branching (reset истории)');
      console.log('/system <text>          сменить system-промпт (reset истории)');
      console.log('/branch <label>         создать ветку от текущего чекпойнта (branching)');
      console.log('/switch <id>            переключиться на ветку (branching)');
      console.log('/branches               список веток (branching)');
      console.log('/reset                  очистить историю и стратегию');
      console.log('/usage                  накопленные токены');
      console.log('/quit                   выход\n');
      return 'continue';
    }
    case 'list': {
      for (const d of demos) console.log(`  ${d.id}   ${d.title}`);
      console.log('');
      return 'continue';
    }
    case 'day': {
      if (!arg) { console.log('Использование: /day <id>, например /day day-06\n'); return 'continue'; }
      const demo = findDemo(arg);
      if (!demo) { console.log(`День "${arg}" не найден. /list покажет все.\n`); return 'continue'; }
      console.log(`День ${demo.id}: ${demo.title}\n`);
      return 'continue';
    }
    case 'strategy': {
      if (!arg) { console.log(`Текущая: ${ctx.getStrategy().name}. Доступно: full, sliding, sticky, branching\n`); return 'continue'; }
      if (!ctx.isStrategyName(arg)) { console.log(`Неизвестная стратегия "${arg}". Доступно: full, sliding, sticky, branching\n`); return 'continue'; }
      const s = ctx.makeStrategy(arg, ctx.windowSize);
      ctx.setStrategy(s);
      console.log(`Стратегия: ${s.name} (история сброшена)\n`);
      return 'continue';
    }
    case 'system': {
      if (!arg) { console.log('Использование: /system <новый system-промпт>\n'); return 'continue'; }
      ctx.agent.reset();
      ctx.setStrategy(ctx.makeStrategy(ctx.getStrategy().name === 'branching' ? 'branching' : 'full', ctx.windowSize));
      // Меняем system через создание нового агента с тем же клиентом нельзя,
      // потому что Agent уже создан. Меняем через re-init: кладём первое
      // системное сообщение в стратегию. Это упрощённый подход для REPL.
      ctx.getStrategy().clear();
      ctx.getStrategy().addMessage(msg.system(arg));
      console.log(`System: ${trunc(arg, 60)} (история сброшена)\n`);
      return 'continue';
    }
    case 'branch': {
      const b = ctx.getStrategy();
      if (!(b instanceof Branching)) { console.log('Команда доступна только в /strategy branching\n'); return 'continue'; }
      const id = b.checkpoint(arg || `branch-${Date.now()}`);
      console.log(`Создана ветка id=${id} "${arg}"\n`);
      return 'continue';
    }
    case 'switch': {
      const b = ctx.getStrategy();
      if (!(b instanceof Branching)) { console.log('Команда доступна только в /strategy branching\n'); return 'continue'; }
      const id = Number(arg);
      if (!Number.isFinite(id)) { console.log('Использование: /switch <id>\n'); return 'continue'; }
      try { b.switchTo(id); console.log(`Активна ветка ${id}\n`); }
      catch (e) { console.log((e as Error).message + '\n'); }
      return 'continue';
    }
    case 'branches': {
      const b = ctx.getStrategy();
      if (!(b instanceof Branching)) { console.log('Команда доступна только в /strategy branching\n'); return 'continue'; }
      for (const info of b.listBranches()) {
        const marker = info.id === b.activeBranchId ? ' *' : '  ';
        console.log(`${marker} ${info.id}  ${info.label}  (${info.messageCount} сообщений)`);
      }
      console.log('');
      return 'continue';
    }
    case 'reset': {
      ctx.getStrategy().clear();
      ctx.agent.reset();
      ctx.resetUsage();
      console.log('Сброшено: история, стратегия, usage.\n');
      return 'continue';
    }
    case 'usage': {
      const u = ctx.getUsage();
      console.log(`Накоплено: prompt=${u.prompt_tokens} completion=${u.completion_tokens} total=${u.total_tokens}\n`);
      return 'continue';
    }
    case 'quit':
    case 'exit':
      return 'quit';
    default:
      console.log(`Неизвестная команда /${cmd}. /help — список.\n`);
      return 'continue';
  }
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// Неиспользуемый импорт ChatMessage подавляем явно — нужен только для типов команд.
export type { ChatMessage };
