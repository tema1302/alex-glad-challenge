// Оркестратор нескольких MCP-серверов (день 20: Orchestration MCP).
//
// Обобщает односерверный mcpAgentLoop: агент видит один объединённый список
// инструментов со всех серверов и сам выбирает, что звать; оркестратор по
// имени инструмента находит сервер-владелец и маршрутизирует вызов на его
// клиент. Так кросс-серверный флоу (шаг N на сервере A, шаг N+1 на сервере B)
// получается естественным образом — модель решает порядок, роутер решает адрес.
//
// Протокол вызова — текстовый (CALL/RESULT), как в mcpAgentLoop: надёжнее
// нативного tools-API на OpenAI-совместимых провайдерах.

import { msg } from './types.js';
import type { ChatMessage } from './types.js';
import type { LlmClient } from './client.js';
import type { McpHttpTool } from './mcpHttpClient.js';
import { parseCall } from './mcpAgentLoop.js';

/** Минимальный интерфейс клиента для оркестратора — HTTP и stdio ему подчиняются.
 *  Оба реализуют callTool(name, args) → текст первого content-блока. */
export interface McpClientLike {
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

/** Один зарегистрированный сервер: имя + живой клиент + его инструменты. */
export interface OrchestratorServer {
  name: string;
  client: McpClientLike;
  tools: McpHttpTool[];
  /** Если задано — агенту видны только эти имена инструментов сервера (dry-run scope). */
  allowTools?: string[];
}

/** Инструмент, разрешённый до сервера, который его исполняет. */
interface RoutedTool {
  server: OrchestratorServer;
  tool: McpHttpTool;
}

/** Краткая сводка параметров инструмента из его inputSchema. */
function summarizeParams(schema?: Record<string, unknown>): string {
  if (!schema) return '{}';
  const props = (schema as { properties?: Record<string, { type?: string }> }).properties;
  if (!props) return '{}';
  const entries = Object.entries(props).map(([k, v]) => `${k}: ${v.type ?? 'any'}`);
  return `{${entries.join(', ')}}`;
}

function buildToolListPrompt(routed: RoutedTool[]): string {
  return routed
    .map(
      (r) =>
        `- ${r.tool.name} (сервер: ${r.server.name}): ${r.tool.description ?? 'без описания'}. Параметры: ${summarizeParams(r.tool.inputSchema)}`,
    )
    .join('\n');
}

function buildSystemPrompt(routed: RoutedTool[], extraSystem?: string): string {
  const serverNames = [...new Set(routed.map((r) => r.server.name))].join(', ');
  const lines = [
    'Ты — агент-оркестратор с доступом к инструментам нескольких MCP-серверов.',
    `Серверы: ${serverNames}.`,
    'Общий список инструментов (сервер указан в скобках) — выбирай любой:',
    '',
    buildToolListPrompt(routed),
    '',
    'Чтобы вызвать инструмент, ответь СТРОГО одной строкой в формате:',
    'CALL: <tool_name> <json_args>',
    '',
    'Результат вызова приходит сообщением "RESULT:" — используй его как данные для следующего шага.',
    'Делай столько вызовов подряд, сколько нужно для решения задачи.',
    'Когда данных достаточно — дай финальный ответ пользователю на русском.',
  ];
  if (extraSystem) lines.push('', extraSystem);
  return lines.join('\n');
}

export interface OrchestratorOptions {
  /** Лимит итераций цикла (по умолчанию 8 — длинный кросс-серверный флоу). */
  maxIterations?: number;
  /** Дополнительный блок инструкций в system-промпт. */
  extraSystem?: string;
}

export interface OrchestratorTraceEntry {
  server: string;
  tool: string;
}

export interface OrchestratorResult {
  /** Финальный текстовый ответ модели. */
  answer: string;
  /** Порядок вызовов: какой сервер и какой инструмент — по очереди. */
  trace: OrchestratorTraceEntry[];
}

/**
 * Кросс-серверный агентский цикл. Модель выбирает инструменты из объединённого
 * списка; каждый CALL маршрутизируется на сервер-владелец. Возвращает ответ и
 * trace маршрутизации.
 */
export async function runOrchestrator(
  client: LlmClient,
  servers: OrchestratorServer[],
  userRequest: string,
  options: OrchestratorOptions = {},
): Promise<OrchestratorResult> {
  const maxIterations = options.maxIterations ?? 8;
  const routed: RoutedTool[] = servers.flatMap((s) => {
    const allow = s.allowTools ? new Set(s.allowTools) : null;
    return s.tools
      .filter((t) => !allow || allow.has(t.name))
      .map((t) => ({ server: s, tool: t }));
  });
  const byName = new Map<string, RoutedTool>();
  for (const r of routed) byName.set(r.tool.name, r);

  const history: ChatMessage[] = [
    msg.system(buildSystemPrompt(routed, options.extraSystem)),
    msg.user(userRequest),
  ];

  const trace: OrchestratorTraceEntry[] = [];
  let lastResponse = '';

  for (let iter = 1; iter <= maxIterations; iter++) {
    const { content } = await client.chatWithUsage(history, { temperature: 0 });
    lastResponse = content.trim();

    const call = parseCall(content);
    if (!call) {
      console.log(`[итерация ${iter}] LLM → финальный ответ`);
      return { answer: lastResponse, trace };
    }

    const hit = byName.get(call.name);
    if (!hit) {
      console.log(`[итерация ${iter}] LLM → CALL ${call.name} — нет такого инструмента`);
      history.push(msg.assistant(lastResponse));
      history.push(
        msg.user(
          `RESULT: Ошибка: инструмент "${call.name}" не существует. Доступны: ${[...byName.keys()].join(', ')}.`,
        ),
      );
      continue;
    }

    let resultText: string;
    try {
      resultText = await hit.server.client.callTool(call.name, call.args);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.log(`[итерация ${iter}] CALL ${call.name} → ошибка: ${m}`);
      history.push(msg.assistant(lastResponse));
      history.push(
        msg.user(
          `RESULT: Ошибка вызова ${call.name}: ${m}. Попробуй другие аргументы (например абсолютный путь внутри vault).`,
        ),
      );
      continue;
    }
    const summary = (resultText.split('\n')[0] ?? '').trim();
    console.log(
      `[итерация ${iter}] CALL ${call.name} → сервер "${hit.server.name}" → ${summary || '(пусто)'}`,
    );
    trace.push({ server: hit.server.name, tool: call.name });

    history.push(msg.assistant(lastResponse));
    history.push(msg.user(`RESULT: ${resultText}`));
  }

  console.log(`[оркестратор] достигнут лимита итераций (${maxIterations}), запрашиваю финальный ответ`);
  // Лимит исчерпан: заставляем модель дать финальный ответ на основе собранных
  // данных, иначе "ответом" остался бы сырой CALL последней итерации.
  history.push(
    msg.user(
      'Лимит вызовов инструментов исчерпан. Больше НЕ вызывай инструменты — сразу дай финальный ответ пользователю на русском на основе уже собранных данных (после "RESULT:").',
    ),
  );
  const finalResp = await client.chatWithUsage(history, { temperature: 0 });
  return { answer: finalResp.content.trim(), trace };
}
