// Разовая операция (2026-09-19): догнать новые сообщения forum-топика 397633
// «EVOLUTE i-SPACE чат» (chatKey -1001508192874) с прошлого парса (2026-07-06,
// msg_id 724413) до сегодня, доклеить их в RAG (strategy=telegram, локальный
// Ollama qwen3-embedding, dim 4096), рефрешнуть реакции старых кандидатов (>=3
// на момент прошлого парса) и собрать отчёт «самые залайканные сообщения
// (>=5 реакций)» за весь собранный период.
// Запуск: challenge/node_modules/.bin/tsx update-evolute.ts
//   --collect-only   только догнать БД (incremental от max_msg_id)
//   --index-only     только доклеить чанки новых сообщений (offline, watermark
//                    выводится из уже проиндексированных chunk_id этого чата)
//   --report-only    только отчёт по реакциям (offline)
//   --skip-refresh   не рефрешить реакции старых сообщений
// Identity-guard: getEntity обязан резолвиться в -1001508192874 — иначе STOP
// (пишем только в уже известный чат).

import { loadEnvUpward } from './src/core/env.js';
loadEnvUpward();

import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { getConnectedRawScanClient, disconnectScanClient } from './src/core/agents/telegramScan.js';
import { resolveChatTopic, collectTopic, buildTopicChunks, summarizeReactions } from './src/core/tg/topicCollector.js';
import type { TgMessageRow } from './src/core/tg/tgStore.js';
import { TgStore } from './src/core/tg/tgStore.js';
import { RagStore } from './src/core/rag/store.js';
import { makeEmbedder } from './src/core/rag/embedder.js';
import { indexDocuments, formatDuration } from './src/core/rag/pipeline.js';
import { saveChatTitle } from './src/core/rag/chatCatalog.js';
import { dataPath } from './src/core/paths.js';

const CHAT_KEY = '-1001508192874';
const CHAT_REF = '-1001508192874';
const TOPIC_ID = 397633;
const REFRESH_THRESHOLD = 3; // рефреш реакций старых сообщений с reaction_total >= N
const REPORT_THRESHOLD = 5;  // в отчёт попадают сообщения с reaction_total >= N
const REPORT_FILE = 'evolute-top-messages.md';

const collectOnly = process.argv.includes('--collect-only');
const indexOnly = process.argv.includes('--index-only');
const reportOnly = process.argv.includes('--report-only');
const skipRefresh = process.argv.includes('--skip-refresh');

// Минимальная проекция Api.Message для рефреша реакций (tainted → sanitize не нужен:
// в БД пишутся только счётчики).
interface RawMsgReactions {
  id?: number;
  reactions?: {
    results?: Array<{ count: number; reaction?: { className: string; emoticon?: string } }>;
  } | null;
}

async function collect(): Promise<number> {
  const client = await getConnectedRawScanClient();
  if (!client) throw new Error('MTProto недоступен (см. ошибки connect выше).');
  const store = new TgStore(dataPath('tg.sqlite'));
  try {
    const ref = await resolveChatTopic(client, CHAT_REF, String(TOPIC_ID));
    if (ref.chatKey !== CHAT_KEY || ref.topicId !== TOPIC_ID) {
      throw new Error(`STOP: резолв ${CHAT_REF} дал ${ref.chatKey}/${ref.topicId}, ожидался ${CHAT_KEY}/${TOPIC_ID}`);
    }
    console.log(`▶ chat: ${ref.chatTitle} | chatKey=${ref.chatKey} | topicId=${ref.topicId}`);
    saveChatTitle(ref.chatKey, ref.chatTitle);

    const watermark = store.getCollectState(CHAT_KEY, TOPIC_ID)?.max_msg_id ?? 0;
    const t0 = Date.now();
    const r = await collectTopic(store, client, ref, {
      onProgress: ({ fetched, newlyInserted }) => {
        if (fetched % 500 === 0) console.log(`  [collect] fetched=${fetched} new=${newlyInserted}`);
      },
    });
    console.log(
      `✅ collect (${r.mode}): fetched=${r.fetched} new=${r.newlyInserted} updated=${r.updated} ` +
        `| всего в БД: ${r.total} | msg_id ${r.minIdSeen}..${r.maxIdSeen} | ${formatDuration(Date.now() - t0)}`,
    );
    return watermark;
  } finally {
    store.close();
  }
}

/** Рефреш реакций старых сообщений (msg_id <= watermark): счётчики в tg.sqlite
 *  заморожены на момент прошлого парса, а для отчёта «>=5 реакций» нужны свежие.
 *  Кандидаты — reaction_total >= REFRESH_THRESHOLD (ниже порога за 2.5 месяца
 *  редко дорастают). getMessages по ids батчами по 100. */
async function refreshReactions(watermark: number): Promise<void> {
  const client = await getConnectedRawScanClient();
  if (!client) throw new Error('MTProto недоступен для refresh-фазы.');
  const store = new TgStore(dataPath('tg.sqlite'));
  try {
    const ref = await resolveChatTopic(client, CHAT_REF, String(TOPIC_ID));
    if (ref.chatKey !== CHAT_KEY) throw new Error(`STOP: chatKey mismatch (${ref.chatKey})`);

    const raw = new DatabaseSync(dataPath('tg.sqlite'), { readOnly: true });
    const candidates = raw
      .prepare(
        `SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ? AND msg_id <= ? AND reaction_total >= ?
         ORDER BY msg_id ASC`,
      )
      .all(CHAT_KEY, TOPIC_ID, watermark, REFRESH_THRESHOLD) as unknown as TgMessageRow[];
    raw.close();
    console.log(`▶ refresh: ${candidates.length} кандидатов (reaction_total >= ${REFRESH_THRESHOLD}, msg_id <= ${watermark})`);

    const byId = new Map(candidates.map((r) => [r.msg_id, r]));
    let seen = 0;
    let changed = 0;
    for (let i = 0; i < candidates.length; i += 100) {
      const batchIds = candidates.slice(i, i + 100).map((r) => r.msg_id);
      const it = client.iterMessages(ref.entity, { ids: batchIds });
      const updates: TgMessageRow[] = [];
      for await (const rawMsg of it) {
        const m = rawMsg as unknown as RawMsgReactions;
        const row = m.id == null ? undefined : byId.get(m.id);
        if (!row) continue;
        seen++;
        const { byEmoji, total } = summarizeReactions(m as unknown as Parameters<typeof summarizeReactions>[0]);
        if (total !== row.reaction_total) {
          changed++;
          updates.push({ ...row, reactions_json: JSON.stringify(byEmoji), reaction_total: total });
        }
      }
      if (updates.length > 0) store.upsertMessages(updates);
      if ((i + 100) % 500 === 0 || i + 100 >= candidates.length) {
        console.log(`  [refresh] ${Math.min(i + 100, candidates.length)}/${candidates.length} | изменённых: ${changed}`);
      }
    }
    console.log(`✅ refresh: увидено ${seen}/${candidates.length}, обновлено реакций: ${changed}.`);
  } finally {
    store.close();
  }
}

/** Максимальный msg_id, уже покрытый чанками этого чата в RAG (по chunk_id
 *  tg::<chat>::<topic>::<A>-<B> и одно-сообщенческому tg::<chat>::<topic>::<id>).
 *  Даёт идемпотентный append: повторный прогон не дублирует и не режет дыр. */
function maxIndexedMsgId(store: RagStore): number {
  const db = (store as unknown as { db: DatabaseSync }).db;
  const rows = db
    .prepare("SELECT chunk_id FROM rag_chunks WHERE strategy = 'telegram' AND source LIKE ? ESCAPE '\\'")
    .all(`tg://chat/${CHAT_KEY}/%`) as unknown as { chunk_id: string }[];
  let max = 0;
  for (const r of rows) {
    const tail = r.chunk_id.split('::')[3] ?? '';
    const m = tail.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const last = Number(m[2] ?? m[1]);
    if (Number.isFinite(last) && last > max) max = last;
  }
  return max;
}

async function index(): Promise<void> {
  const rag = new RagStore(dataPath('rag.sqlite'));
  try {
    const fromId = maxIndexedMsgId(rag);
    console.log(`▶ index: watermark по чанкам RAG = msg_id > ${fromId}`);

    const raw = new DatabaseSync(dataPath('tg.sqlite'), { readOnly: true });
    const rows = raw
      .prepare(
        `SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ? AND msg_id > ? AND text <> ''
         ORDER BY msg_id ASC`,
      )
      .all(CHAT_KEY, TOPIC_ID, fromId) as unknown as TgMessageRow[];
    raw.close();

    if (rows.length === 0) {
      console.log('ℹ️  новых текстовых сообщений нет — индексация не нужна.');
      return;
    }
    console.log(
      `▶ новых текстовых сообщений: ${rows.length}, ${rows[0].date_iso} .. ${rows[rows.length - 1].date_iso}`,
    );

    const built = buildTopicChunks(rows);
    if (built.length === 0) throw new Error('buildTopicChunks вернул 0 чанков.');
    // Хронологический порядок вставки: идемпотентный re-run по watermark (см. maxIndexedMsgId).
    built.sort((a, b) => a.chunk.metadata.chunkId.localeCompare(b.chunk.metadata.chunkId, 'en', { numeric: true }));
    const range = `${built[0].chunk.metadata.section} → ${built[built.length - 1].chunk.metadata.section}`;
    console.log(`▶ чанков: ${built.length} (${range})`);

    const embedder = makeEmbedder();
    const smoke = await embedder.embed(['смоук-запрос для проверки эмбеддера']);
    const dim = smoke[0]?.length ?? 0;
    if (dim === 0) throw new Error('Эмбеддер вернул пустой вектор.');
    console.log(`▶ embedder dim=${dim}`);

    const stBefore = rag.stats('telegram');
    if (stBefore.dim != null && stBefore.dim !== dim) {
      throw new Error(`dim mismatch: index=${stBefore.dim}, embedder=${dim} — нужен reindex всей партиции.`);
    }

    const chunks = built.map((b) => b.chunk);
    const total = chunks.length;
    const t0 = Date.now();
    let lastBucket = -1;
    await indexDocuments(rag, 'telegram', chunks, embedder, 32, (done) => {
      const pct = Math.floor((done / total) * 100);
      const bucket = Math.floor(pct / 5) * 5;
      if (bucket <= lastBucket && done < total) return;
      lastBucket = bucket;
      const rate = done > 0 ? (Date.now() - t0) / done : 0;
      const eta = done < total ? formatDuration(rate * (total - done)) : 'готово';
      console.log(`  [index ${done}/${total} · ${pct}% · ${eta}]`);
    });
    const st = rag.stats('telegram');
    console.log(
      `✅ indexed за ${formatDuration(Date.now() - t0)}: в партиции telegram ${st.chunks} чанков ` +
        `(было ${stBefore.chunks}), dim=${st.dim ?? '-'}`,
    );
  } finally {
    rag.close();
  }
}

/** Отчёт «самые залайканные» (reaction_total >= REPORT_THRESHOLD) за весь
 *  собранный период. Полный список → markdown-файл, топ-30 → консоль. */
function report(): void {
  const raw = new DatabaseSync(dataPath('tg.sqlite'), { readOnly: true });
  const head = raw
    .prepare(
      `SELECT COUNT(*) total, SUM(text <> '') texts, MIN(date_iso) first, MAX(date_iso) last
       FROM tg_messages WHERE chat_id = ? AND topic_id = ?`,
    )
    .get(CHAT_KEY, TOPIC_ID) as { total: number; texts: number | null; first: string; last: string };
  const rows = raw
    .prepare(
      `SELECT msg_id, from_name, text, date_iso, reactions_json, reaction_total
       FROM tg_messages
       WHERE chat_id = ? AND topic_id = ? AND reaction_total >= ?
       ORDER BY reaction_total DESC, date_iso ASC`,
    )
    .all(CHAT_KEY, TOPIC_ID, REPORT_THRESHOLD) as unknown as TgMessageRow[];
  raw.close();

  console.log(
    `\n=== ТОП сообщений «EVOLUTE i-SPACE чат» с >=${REPORT_THRESHOLD} реакциями (весь период) ===`,
  );
  console.log(`период: ${head.first} .. ${head.last} | сообщений: ${head.total} (текстовых ${head.texts}) | в отчёте: ${rows.length}`);

  const link = (msgId: number) => `https://t.me/c/${CHAT_KEY.replace('-100', '')}/${TOPIC_ID}/${msgId}`;
  const md: string[] = [
    `# EVOLUTE i-SPACE чат — самые залайканные сообщения (>= ${REPORT_THRESHOLD} реакций)`,
    '',
    `Период сбора: ${head.first.slice(0, 10)} .. ${head.last.slice(0, 10)} | сообщений в БД: ${head.total} ` +
      `(текстовых: ${head.texts}) | сообщений в отчёте: **${rows.length}**`,
    '',
    `Срез реакций: ${new Date().toISOString().slice(0, 10)} (старые сообщения — рефреш кандидатов с >= ${REFRESH_THRESHOLD} реакциями).`,
    '',
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const emoji = r.reaction_total > 0 ? ` | реакции=${r.reaction_total} ${r.reactions_json}` : '';
    const snippet = r.text.replace(/\s+/g, ' ').slice(0, 110);
    if (i < 30) {
      console.log(`  ${String(i + 1).padStart(3)}. ♥${String(r.reaction_total).padStart(3)} [${r.msg_id}] ${r.from_name} @ ${r.date_iso.slice(0, 10)}${emoji}`);
      if (snippet) console.log(`      ${snippet}`);
    }
    md.push(
      `## ${i + 1}. ♥${r.reaction_total} — ${r.date_iso.slice(0, 10)} — ${r.from_name || '(без имени)'}`,
      '',
      `${link(r.msg_id)} | msg_id ${r.msg_id} | реакции: \`${r.reactions_json}\``,
      '',
      r.text.trim() ? `> ${r.text.trim().replace(/\n{2,}/g, '\n>\n>').replace(/\n/g, '\n> ')}` : '> (без текста — медиа)',
      '',
    );
  }
  writeFileSync(REPORT_FILE, md.join('\n'), 'utf-8');
  console.log(`✅ полный список (${rows.length}) → challenge/${REPORT_FILE}`);
}

async function main(): Promise<void> {
  if (reportOnly) {
    report();
    return;
  }
  try {
    let watermark = 0;
    if (!indexOnly) {
      watermark = await collect();
      if (!skipRefresh && watermark > 0) await refreshReactions(watermark);
    }
    if (!collectOnly) {
      await index();
      report();
    }
  } finally {
    // gramjs update-loop держит event loop — без disconnect процесс не завершится.
    try {
      await disconnectScanClient();
    } catch {
      /* cleanup-ошибка gramjs после успешной операции — не ошибка запуска */
    }
  }
  console.log('🎉 готово.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
