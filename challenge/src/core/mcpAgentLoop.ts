// Универсальный цикл MCP tool-calling поверх текстового протокола CALL/RESULT.
// Вынесен из day-17 в core/, чтобы переиспользовать в day-19 (композиция тулзов):
// модель сама выбирает инструмент и вызывает несколько штук подряд для решения
// задачи пользователя, а данные протекают между вызовами через её же контекст
// (RESULT предыдущего → аргументы следующего).
//
// Подход — текстовый протокол (без нативного tools-API): многие OpenAI-совместимые
// провайдеры ненадёжно поддерживают параметр tools, поэтому агент договаривается
// с моделью о строгом формате:
//   CALL: <tool_name> <json args>   — запрос на вызов инструмента,
//   RESULT: <текст>                 — результат, который агент возвращает модели.

import { msg } from './types.js';
import type { ChatMessage } from './types.js';
import type { LlmClient } from './client.js';
import { McpHttpClient } from './mcpHttpClient.js';
import type { McpHttpTool } from './mcpHttpClient.js';

export interface AgentLoopOptions {
  /** Лимит итераций цикла (по умолчанию 4). Для длинных цепочек — увеличить. */
  maxIterations?: number;
  /** Дополнительный блок инструкций в system-промпт (например, «вызывай несколько тулзов подряд»). */
  extraSystem?: string;
}

interface ParsedCall {
  name: string;
  args: Record<string, unknown>;
}

/** Краткая сводка параметров инструмента из его inputSchema. */
function summarizeParams(schema?: Record<string, unknown>): string {
  if (!schema) return '{}';
  const props = (schema as { properties?: Record<string, { type?: string }> }).properties;
  if (!props) return '{}';
  const entries = Object.entries(props).map(([k, v]) => `${k}: ${v.type ?? 'any'}`);
  return `{${entries.join(', ')}}`;
}

/** Форматирует список инструментов для системного промпта. */
function buildToolListPrompt(tools: McpHttpTool[]): string {
  return tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description ?? 'без описания'}. Параметры: ${summarizeParams(t.inputSchema)}`,
    )
    .join('\n');
}

/** Собирает системный промпт из списка инструментов. */
function buildSystemPrompt(tools: McpHttpTool[], extraSystem?: string): string {
  const lines = [
    'Ты — агент с доступом к MCP-инструментам. Вот что доступно:',
    '',
    buildToolListPrompt(tools),
    '',
    'Чтобы вызвать инструмент, ответь СТРОГО одной строкой в формате:',
    'CALL: <tool_name> <json_args>',
    '',
    'Когда получаешь сообщение "RESULT:", используй его содержимое как результат вызова.',
    'Давай финальный ответ пользователю на русском.',
  ];
  if (extraSystem) {
    lines.push('', extraSystem);
  }
  return lines.join('\n');
}

/** Пытается разобрать ответ модели как вызов инструмента `CALL: <name> <json>`. */
export function parseCall(content: string): ParsedCall | null {
  const trimmed = content.trim();
  const match = trimmed.match(/^CALL:\s*(\w+)\s*(\{[\s\S]*\})\s*$/);
  if (!match) return null;
  try {
    const args = JSON.parse(match[2]) as Record<string, unknown>;
    return { name: match[1], args };
  } catch {
    return null;
  }
}

/** Первая строка результата MCP-вызова для краткого вывода. */
function summarizeResult(text: string): string {
  return text.split('\n')[0]?.trim() ?? text.trim();
}

/** Цикл tool-calling: модель вызывает инструменты, пока не даст финальный ответ. */
export async function runAgentLoop(
  client: LlmClient,
  mcp: McpHttpClient,
  tools: McpHttpTool[],
  userQuestion: string,
  options: AgentLoopOptions = {},
): Promise<string> {
  const maxIterations = options.maxIterations ?? 4;
  const history: ChatMessage[] = [
    msg.system(buildSystemPrompt(tools, options.extraSystem)),
    msg.user(userQuestion),
  ];
  const toolNames = new Set(tools.map((t) => t.name));

  let lastResponse = '';
  for (let iter = 1; iter <= maxIterations; iter++) {
    const { content } = await client.chatWithUsage(history, { temperature: 0 });
    lastResponse = content.trim();

    const call = parseCall(content);
    if (!call) {
      console.log(`[итерация ${iter}] LLM → финальный ответ`);
      return lastResponse;
    }

    console.log(`[итерация ${iter}] LLM → CALL: ${call.name} ${JSON.stringify(call.args)}`);

    if (!toolNames.has(call.name)) {
      history.push(msg.assistant(lastResponse));
      history.push(
        msg.user(
          `RESULT: Ошибка: инструмент "${call.name}" не существует. Доступны: ${[...toolNames].join(', ')}.`,
        ),
      );
      continue;
    }

    const resultText = await mcp.callTool(call.name, call.args);
    console.log(`  → MCP-вызов... ${summarizeResult(resultText)}`);

    history.push(msg.assistant(lastResponse));
    history.push(msg.user(`RESULT: ${resultText}`));
  }

  return lastResponse;
}

/** Системная подсказка по умолчанию: гнать цепочку тулзов, протаскивая данные. */
export const DEFAULT_AGENT_SYSTEM = [
  'Решай задачу по шагам, вызывая инструменты по очереди.',
  'Результат предыдущего инструмента (после "RESULT:") используй как данные для следующего.',
  'Когда результата достаточно — ответь пользователю итогом.',
].join(' ');

/**
 * Подключиться к MCP-серверу и прогнать агентский цикл над запросом пользователя.
 * Точка входа для CLI/REPL: юзер ввёл запрос → агент сам вызывает нужные тулы.
 */
export async function runAgentRequest(
  client: LlmClient,
  serverUrl: string,
  request: string,
  options: AgentLoopOptions = {},
): Promise<string> {
  const mcp = new McpHttpClient(serverUrl);
  try {
    await mcp.connect();
    const tools = await mcp.listTools();
    return await runAgentLoop(client, mcp, tools, request, {
      maxIterations: 6,
      extraSystem: DEFAULT_AGENT_SYSTEM,
      ...options,
    });
  } finally {
    mcp.disconnect();
  }
}
