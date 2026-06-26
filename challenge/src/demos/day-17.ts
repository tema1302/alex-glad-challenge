// День 17. Первый инструмент MCP: HTTP-сервер + агент-клиент.
//
// Задание:
//   Подключить агента к УЖЕ РАБОТАЮЩЕМУ standalone MCP-серверу по HTTP.
//   Агент сам выбирает инструмент в цикле tool-calling.
//
// Реализация:
//   core/mcpHttpClient.js — MCP-клиент поверх Streamable HTTP transport.
//   day-17.ts (этот файл) — агентский цикл tool-calling поверх MCP.
//   Сервер запускается отдельно: pnpm --filter challenge start -- mcp-server
//
// Подход — текстовый протокол tool-calling (без нативного tools-API):
// Многие OpenAI-совместимые провайдеры ненадёжно поддерживают параметр tools,
// поэтому агент договаривается с моделью о строгом формате:
//   CALL: <tool_name> <json args>   — запрос на вызов инструмента,
//   RESULT: <текст>                 — результат, который агент возвращает модели.

import { LlmClient, msg } from '../core/index.js';
import { McpHttpClient } from '../core/mcpHttpClient.js';
import type { ChatMessage } from '../core/index.js';
import type { Demo } from './types.js';
import type { McpHttpTool } from '../core/mcpHttpClient.js';

const MCP_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:3001/mcp';
const MAX_ITERATIONS = 4;

const SCENARIO_1 = 'Какие посты у пользователя с ID 2?';
const SCENARIO_2 = "Добавь заметку 'Изучить MCP протокол' и покажи все заметки";

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
function buildSystemPrompt(tools: McpHttpTool[]): string {
  return [
    'Ты — агент с доступом к MCP-инструментам. Вот что доступно:',
    '',
    buildToolListPrompt(tools),
    '',
    'Чтобы вызвать инструмент, ответь СТРОГО одной строкой в формате:',
    'CALL: <tool_name> <json_args>',
    '',
    'Когда получаешь сообщение "RESULT:", используй его содержимое как результат вызова.',
    'Давай финальный ответ пользователю на русском.',
  ].join('\n');
}

/** Пытается разобрать ответ модели как вызов инструмента `CALL: <name> <json>`. */
function parseCall(content: string): ParsedCall | null {
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
async function runAgentLoop(
  client: LlmClient,
  mcp: McpHttpClient,
  tools: McpHttpTool[],
  userQuestion: string,
): Promise<string> {
  const history: ChatMessage[] = [msg.system(buildSystemPrompt(tools)), msg.user(userQuestion)];
  const toolNames = new Set(tools.map((t) => t.name));

  let lastResponse = '';
  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
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

export const demo: Demo = {
  id: 'day-17',
  title: 'Первый инструмент MCP: HTTP-сервер + агент-клиент',
  run: async (): Promise<void> => {
    console.log('=== День 17. Первый инструмент MCP: сервер + агент ===\n');
    console.log(`Подключение к MCP-серверу: ${MCP_URL}`);

    const mcp = new McpHttpClient(MCP_URL);
    const client = new LlmClient();

    try {
      const info = await mcp.connect();
      console.log(`✓ Сервер: ${info.name} v${info.version} (протокол ${info.protocolVersion})`);

      const tools = await mcp.listTools();
      console.log(`✓ Инструментов: ${tools.length}`);
      for (const t of tools) {
        console.log(`  • ${t.name} — ${t.description ?? ''}`);
      }

      console.log(`\n--- Сценарий 1: "${SCENARIO_1}" ---`);
      const answer1 = await runAgentLoop(client, mcp, tools, SCENARIO_1);
      console.log(`  Ответ: ${answer1}`);

      console.log(`\n--- Сценарий 2: "${SCENARIO_2}" ---`);
      const answer2 = await runAgentLoop(client, mcp, tools, SCENARIO_2);
      console.log(`  Ответ: ${answer2}`);

      console.log(`\n=== Итог ===`);
      console.log('• MCP-сервер запускается отдельно: pnpm --filter challenge start -- mcp-server');
      console.log(`• Агент подключается по HTTP к ${MCP_URL}`);
      console.log('• Tool-calling через текстовый протокол CALL/RESULT');
      console.log(`• Инструменты (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
    } catch {
      console.log(
        '\nMCP-сервер не запущен. Запустите: pnpm --filter challenge start -- mcp-server',
      );
      return;
    } finally {
      mcp.disconnect();
    }
  },
};
