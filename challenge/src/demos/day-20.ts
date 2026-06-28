// День 20. Orchestration MCP — «Брифинг дня». Клиент оркестрации.
//
// Тонкий клиент (как day-18.ts): подключается к ДВУМ уже запущенным MCP-серверам
// дня 20 (obsidian-mcp + world-mcp, поднимаются отдельно командой `day-20-server`)
// и гонит кросс-серверный агентский флоу. Никаких in-process серверов и mock-ов.
//
// Маршрутизация: модель видит общий список инструментов со всех серверов и сама
// выбирает порядок; mcpOrchestrator адресует каждый CALL на сервер-владелец.
// Типичная цепочка: get_current_time (world) → read_note/search_notes (obsidian)
// → fetch_url (world, опционально) → create_note (obsidian).
//
// Запуск: сначала поднять серверы (`day-20-server`), затем
//   pnpm --filter challenge start -- day-20
// URL'ы серверов регулируются env: OBSIDIAN_MCP_URL / WORLD_MCP_URL.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LlmClient, McpHttpClient } from '../core/index.js';
import { runOrchestrator } from '../core/mcpOrchestrator.js';
import type { OrchestratorServer } from '../core/mcpOrchestrator.js';
import { DEFAULT_VAULT_DIR, localDateStamp } from './day-20-obsidian-server.js';
import type { Demo } from './types.js';

const OBSIDIAN_URL = process.env.OBSIDIAN_MCP_URL ?? 'http://localhost:3020/mcp';
const WORLD_URL = process.env.WORLD_MCP_URL ?? 'http://localhost:3021/mcp';

const BRIEFING_REQUEST = [
  'Собери утренний брифинг на сегодня для тимлида-отца-фаната.',
  'Сначала узнай сегодняшнюю дату.',
  'Прочитай сегодняшнюю ежедневную заметку (имя файла = дата YYYY-MM-DD) и поищи в vault заметки по словам «команда спринт семья ребёнок футбол».',
  'Футбол и семья уже есть в заметках vault — web-fetch используй ТОЛЬКО если в vault по теме ничего нет.',
  'Затем запиши сводку заметкой с именем «Брифинг <дата>» (подставь реальную дату) в vault: короткие блоки работа / семья / футбол.',
  'В конце кратко скажи, что записал.',
].join(' ');

async function connectServer(name: string, url: string): Promise<OrchestratorServer> {
  const client = new McpHttpClient(url);
  await client.connect();
  const tools = await client.listTools();
  return { name, client, tools };
}

async function showWrittenBriefing(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(DEFAULT_VAULT_DIR);
  } catch {
    return;
  }
  const briefing = entries.find((f) => f.startsWith('Брифинг') && f.endsWith('.md'));
  if (!briefing) return;
  const text = await fs.readFile(path.join(DEFAULT_VAULT_DIR, briefing), 'utf8');
  console.log(`\n=== Содержимое созданной заметки ${briefing} ===`);
  console.log(text.trim());
}

export const demo: Demo = {
  id: 'day-20',
  title: 'Orchestration MCP: Брифинг дня (Obsidian + world)',
  run: async (): Promise<void> => {
    console.log('=== День 20. Orchestration MCP — «Брифинг дня» ===\n');
    console.log(`Подключение к MCP-серверам:\n  • obsidian-mcp → ${OBSIDIAN_URL}\n  • world-mcp   → ${WORLD_URL}`);

    const servers: OrchestratorServer[] = [];
    try {
      servers.push(await connectServer('obsidian-mcp', OBSIDIAN_URL));
      servers.push(await connectServer('world-mcp', WORLD_URL));

      console.log('\nЗарегистрированные серверы и инструменты:');
      for (const s of servers) {
        console.log(`  [${s.name}] ${s.tools.map((t) => t.name).join(', ')}`);
      }

      console.log('\nЗапрос пользователя:');
      console.log(`  ${BRIEFING_REQUEST}`);
      console.log('\nАгентский цикл (CALL → сервер):');

      const client = new LlmClient();
      const { answer, trace } = await runOrchestrator(client, servers, BRIEFING_REQUEST, {
        maxIterations: 8,
        extraSystem:
          'Начни с get_current_time, чтобы узнать дату — она нужна и для имени ежедневной заметки, и для имени файла брифинга.',
      });

      console.log('\nTrace маршрутизации (порядок вызовов по серверам):');
      for (const [i, t] of trace.entries()) {
        console.log(`  ${i + 1}. ${t.tool}  →  [${t.server}]`);
      }
      const crossServer = new Set(trace.map((t) => t.server)).size > 1;
      console.log(`  Кросс-серверный флоу: ${crossServer ? 'да ✓' : 'нет ✗'}`);

      console.log('\nФинальный ответ агента:');
      console.log(`  ${answer}`);

      await showWrittenBriefing();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.log(`\nНе удалось подключиться к серверам: ${m}`);
      console.log('Подними их сначала:  pnpm --filter challenge start -- day-20-server');
      console.log('Или проверь env OBSIDIAN_MCP_URL / WORLD_MCP_URL.');
    } finally {
      for (const s of servers) s.client.disconnect();
    }

    console.log(`\nДата: ${localDateStamp(new Date())}`);
  },
};
