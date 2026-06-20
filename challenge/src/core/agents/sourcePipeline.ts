// Pipeline этапа 1: параллельный сбор + оркестратор.
// 3 агента работают одновременно (Promise.all),
// каждый видит только свой источник.
// Оркестратор ждёт всех, выбирает финальный топ-3.

import type { BlogDb } from '../db.js';
import type { LlmClient } from '../index.js';
import type { SourceAgent } from './sourceAgent.js';
import { RssSourceAgent } from './rssSource.js';
import { ForumScannerAgent } from './forumScanner.js';
import { TelegramScannerAgent } from './telegramScanner.js';
import { Orchestrator, type OrchestratorResult } from './orchestrator.js';

export async function runSourceAgents(
  db: BlogDb,
  client: LlmClient,
  opts: {
    maxAgeHours?: number;
    userQuery?: string;
    topK?: number;
    enableTelegram?: boolean;
    enableForum?: boolean;
    sessionDir?: string;
  } = {},
): Promise<OrchestratorResult> {
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const topK = opts.topK ?? 3;
  const userQuery = opts.userQuery ?? 'самые горячие футбольные новости';

  // Создаём агентов.
  const agents: SourceAgent[] = [
    new RssSourceAgent(db, maxAgeHours, 10),
  ];

  if (opts.enableForum !== false) {
    agents.push(new ForumScannerAgent(10));
  }

  if (opts.enableTelegram !== false) {
    const tgAgent = new TelegramScannerAgent(opts.sessionDir ?? '.data');
    agents.push(tgAgent);
  }

  console.log(`[stage1] Запуск ${agents.length} агентов параллельно...`);

  // Параллельный запуск всех агентов.
  const results = await Promise.all(
    agents.map(async (agent) => {
      console.log(`[stage1] ${agent.name}: старт...`);
      const result = await agent.fetch();
      console.log(`[stage1] ${agent.name}: ${result.topics.length} тем${result.error ? ` (ошибка: ${result.error})` : ''}`);
      return result;
    }),
  );

  // Отключаем Telegram-клиент если был.
  for (const agent of agents) {
    if (agent instanceof TelegramScannerAgent) {
      await agent.disconnect();
    }
  }

  // Оркестратор: LLM выбирает финальный топ.
  console.log(`[stage1] Оркестратор: выбор топ-${topK}...`);
  const orchestrator = new Orchestrator(client);
  const orchResult = await orchestrator.decide(results, userQuery, topK);

  console.log(`[stage1] Оркестратор: выбрано ${orchResult.ranked.length} тем`);
  for (const r of orchResult.ranked) {
    console.log(`  [${r.orchestratorScore}] (${r.source}) ${r.title}`);
    console.log(`    ${r.orchestratorReason}`);
  }

  return orchResult;
}
