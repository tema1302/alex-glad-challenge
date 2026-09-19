// Разовая операция (2026-09-19): фильтрация «мусорных лайков» из отчёта
// evolute-top-messages.md (>=5 реакций, чат EVOLUTE i-SPACE). Локальная модель
// (Ollama, LOCAL_LLM_MODEL) классифицирует каждое сообщение: информационное
// (проблемы/эксплуатация/цены/советы) vs хвастовство/поздравления с покупкой.
// Выход:
//   web/data/evolute-top-informative.json — данные для страницы /evolute
//   challenge/evolute-top-informative.md  — отфильтрованный отчёт
// Кэш решений: .data/evolute-classify-cache.json (при смене PROMPT_VERSION
// кэш игнорируется). Запуск: challenge/node_modules/.bin/tsx classify-evolute-top.ts
//   --limit N   смоук на первых N сообщениях
//   --redo      игнорировать кэш и переклассифицировать всё

import { loadEnvUpward } from './src/core/env.js';
loadEnvUpward();

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLocalLlmClient } from './src/core/rag/llm.js';
import { msg } from './src/core/index.js';
import { dataPath } from './src/core/paths.js';

// Выходы привязаны к файлу скрипта (не к CWD): md — рядом, JSON — в web/data/
// (импортится страницей web/app/evolute). Прецедент path.dirname(fileURLToPath)
// — challenge/src/core/agents/seed.ts.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PAGE_JSON_PATH = path.join(SCRIPT_DIR, '..', 'web', 'data', 'evolute-top-informative.json');
const MD_PATH = path.join(SCRIPT_DIR, 'evolute-top-informative.md');

const CHAT_KEY = '-1001508192874';
const TOPIC_ID = 397633;
const PROMPT_VERSION = 3;
const TEXT_CAP_CLASSIFY = 1500;
const TEXT_CAP_PAGE = 700;

const limitFlag = process.argv.indexOf('--limit');
const LIMIT = limitFlag > -1 ? Number(process.argv[limitFlag + 1]) : undefined;
const REDO = process.argv.includes('--redo');

const SYSTEM_PROMPT = `Ты — строгий классификатор сообщений из Telegram-чата владельцев электромобилей Evolute i-Space. Отделяй информационные сообщения от пустой социальщины.

ИНФОРМАЦИОННОЕ (info=true) — полезно владельцу или покупателю:
- проблемы, поломки, ремонт, сервис, гарантия, страхование;
- эксплуатация: зарядка, расход, режимы, зима/лето, аксессуары, доработки;
- цены, скидки, госсубсидии, ставки, дилеры, порядок покупки — с конкретикой;
- опыт с фактами (пробеги, цифры, сроки), сравнения, ответы на тех-вопросы;
- ссылки на полезные материалы (видео-гайды, форумы, инструкции).

МУСОРНОЕ (info=false):
- хвастовство и радость от покупки («принимайте в ряды», «наконец-то забрал», «вот и я дождался»), поздравления;
- фото/видео новой машины без содержания, эмоции без фактов;
- флуд, мета-обсуждение чата, ни к чему не привязанные реплики.

Пограничное правило: если в сообщении есть конкретные факты (цена, пробег, поломка, срок) — оно информационное, даже если написано эмоционально. Сообщение про сам факт получения машины без фактов — мусорное.`;

interface TopRow {
  msg_id: number;
  from_name: string;
  text: string;
  date_iso: string;
  reactions_json: string;
  reaction_total: number;
}

interface CacheFile {
  version: number;
  byId: Record<string, 0 | 1>;
}

function loadCache(): CacheFile {
  const file = dataPath('evolute-classify-cache.json');
  if (!REDO && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as CacheFile;
      if (parsed.version === PROMPT_VERSION && parsed.byId) return parsed;
    } catch {
      /* битый кэш — начинаем с нуля */
    }
  }
  return { version: PROMPT_VERSION, byId: {} };
}

function saveCache(cache: CacheFile): void {
  mkdirSync(dataPath(), { recursive: true });
  writeFileSync(dataPath('evolute-classify-cache.json'), JSON.stringify(cache), 'utf-8');
}

/** info по regex — надёжнее JSON.parse для LLM-вывода (фенсы/префиксы не страшны). */
function parseVerdict(raw: string): 0 | 1 | null {
  const m = raw.match(/"info"\s*:\s*(true|false)/i);
  if (m) return m[1].toLowerCase() === 'true' ? 1 : 0;
  return null;
}

async function classifyRow(client: ReturnType<typeof makeLocalLlmClient>, row: TopRow): Promise<0 | 1> {
  const body = `Сообщение из чата:\n\n${row.text.slice(0, TEXT_CAP_CLASSIFY)}\n\nОтветь строго JSON: {"info": true} или {"info": false}.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? body
      : `${body}\n\nВАЖНО: только JSON-объект, без пояснений.`;
    const answer = await client.chat([msg.system(SYSTEM_PROMPT), msg.user(prompt)]);
    const verdict = parseVerdict(answer);
    if (verdict != null) return verdict;
    console.warn(`  [warn] msg ${row.msg_id}: не распарсил ответ (попытка ${attempt + 1}): ${answer.slice(0, 120)}`);
  }
  // Не смогли классифицировать за 2 попытки → консервативно оставляем (не теряем контент).
  return 1;
}

async function main(): Promise<void> {
  const raw = new DatabaseSync(dataPath('tg.sqlite'), { readOnly: true });
  const rows = raw
    .prepare(
      `SELECT msg_id, from_name, text, date_iso, reactions_json, reaction_total
       FROM tg_messages
       WHERE chat_id = ? AND topic_id = ? AND reaction_total >= 5
       ORDER BY reaction_total DESC, date_iso ASC`,
    )
    .all(CHAT_KEY, TOPIC_ID) as unknown as TopRow[];
  raw.close();
  console.log(`▶ кандидатов (>=5 реакций): ${rows.length}${LIMIT != null ? ` (смоук --limit ${LIMIT})` : ''}`);

  const client = makeLocalLlmClient();
  // Смоук-запрос: модель жива?
  const smoke = await client.chat([msg.user('Ответь строго JSON: {"info": true}.')]);
  if (!parseVerdict(smoke)) throw new Error(`Локальная модель не отвечает в JSON-формате: ${smoke.slice(0, 120)}`);

  const cache = loadCache();
  const seen = Date.now();
  let calls = 0;
  const verdicts = new Map<number, 0 | 1>();
  const rowsToProcess = LIMIT != null ? rows.slice(0, LIMIT) : rows;

  for (const row of rowsToProcess) {
    const cached = cache.byId[String(row.msg_id)];
    if (cached != null) {
      verdicts.set(row.msg_id, cached);
      continue;
    }
    if (row.text.trim() === '') {
      // медиа без подписи — почти всегда фото «вот моя машина» → мусор
      verdicts.set(row.msg_id, 0);
      cache.byId[String(row.msg_id)] = 0;
      continue;
    }
    const verdict = await classifyRow(client, row);
    verdicts.set(row.msg_id, verdict);
    cache.byId[String(row.msg_id)] = verdict;
    calls++;
    if (calls % 25 === 0) {
      saveCache(cache);
      const kept = [...verdicts.values()].filter((v) => v === 1).length;
      console.log(`  [classify ${verdicts.size}/${rowsToProcess.length}] llm-вызовов: ${calls} | информационных: ${kept} | ${Math.round((Date.now() - seen) / 1000)}s`);
    }
  }
  saveCache(cache);

  // Сборка выходов (только информационные, исходный порядок = reactions DESC).
  const url = (id: number) => `https://t.me/c/${CHAT_KEY.replace('-100', '')}/${TOPIC_ID}/${id}`;
  const kept: Array<Record<string, unknown>> = [];
  const droppedIds: number[] = [];
  for (const row of rowsToProcess) {
    if (verdicts.get(row.msg_id) === 1) {
      kept.push({
        msgId: row.msg_id,
        likes: row.reaction_total,
        reactions: JSON.parse(row.reactions_json) as Record<string, number>,
        date: row.date_iso.slice(0, 10),
        author: row.from_name || '(без имени)',
        text: row.text.trim().slice(0, TEXT_CAP_PAGE),
        url: url(row.msg_id),
      });
    } else {
      droppedIds.push(row.msg_id);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    chatTitle: 'Evolute Club | Эволют Чат',
    period: { from: '2025-09-26', to: new Date().toISOString().slice(0, 10) },
    totalCandidates: rowsToProcess.length,
    kept: kept.length,
    dropped: droppedIds.length,
    items: kept,
  };
  writeFileSync(PAGE_JSON_PATH, JSON.stringify(payload, null, 2), 'utf-8');

  const md: string[] = [
    `# EVOLUTE i-SPACE — информационный топ (>=5 реакций, без «мусорных лайков»)`,
    '',
    `Из ${rowsToProcess.length} сообщений с >=5 реакциями отобрано **${kept.length}** информационных ` +
      `(отфильтровано ${droppedIds.length}: хвастовство/поздравления с покупкой, фото без содержания).`,
    `Классификация: локальная модель (${new Date().toISOString().slice(0, 10)}). Полный неотфильтрованный список: evolute-top-messages.md.`,
    '',
  ];
  kept.forEach((item, i) => {
    const r = item as { likes: number; date: string; author: string; url: string; text: string; reactions: Record<string, number> };
    md.push(
      `## ${i + 1}. ♥${r.likes} — ${r.date} — ${r.author}`,
      '',
      `${r.url} | реакции: \`${JSON.stringify(r.reactions)}\``,
      '',
      `> ${r.text.replace(/\n{2,}/g, '\n>\n>').replace(/\n/g, '\n> ')}`,
      '',
    );
  });
  md.push(`## Отфильтровано (${droppedIds.length})`, '');
  for (let i = 0; i < droppedIds.length; i += 20) {
    md.push(droppedIds.slice(i, i + 20).map((id) => url(id)).join(' · '));
  }
  md.push('');
  writeFileSync(MD_PATH, md.join('\n'), 'utf-8');

  console.log(`✅ информационных: ${kept.length} из ${rowsToProcess.length} (отфильтровано ${droppedIds.length})`);
  console.log(`✅ web/data/evolute-top-informative.json + challenge/evolute-top-informative.md | llm-вызовов: ${calls}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
