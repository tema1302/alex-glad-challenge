// Разовая операция (2026-09-19): догнать новые сообщения чата lookAtFactsChat
// («Факты в чате», chatKey -1001736860345) в .data/tg.sqlite и переиндексировать
// в RAG (strategy=telegram) ПОСЛЕДНИЕ 7000 текстовых сообщений вместо старых
// top-1500-по-реакциям. Запуск: challenge/node_modules/.bin/tsx update-lookatchat.ts
//   --collect-only   только догнать БД (incremental от max_msg_id, plain-режим)
//   --index-only     только переиндексировать (БД уже догнана)
//   (без флагов)     collect, затем index
// Проверка identity: getEntity('@lookAtFactsChat') обязан дать -1001736860345 —
// иначе STOP (пишем только в уже известный чат).

import { loadEnvUpward } from './src/core/env.js';
loadEnvUpward();

import { DatabaseSync } from 'node:sqlite';
import { getConnectedRawScanClient, disconnectScanClient } from './src/core/agents/telegramScan.js';
import { resolveChatTopic, collectTopic, buildTopicChunks } from './src/core/tg/topicCollector.js';
import type { TgMessageRow } from './src/core/tg/tgStore.js';
import { TgStore } from './src/core/tg/tgStore.js';
import { RagStore } from './src/core/rag/store.js';
import { makeEmbedder } from './src/core/rag/embedder.js';
import { indexDocuments, formatDuration } from './src/core/rag/pipeline.js';
import { saveChatTitle } from './src/core/rag/chatCatalog.js';
import { dataPath } from './src/core/paths.js';

const CHAT_KEY = '-1001736860345';
const CHAT_REF = '@lookAtFactsChat';
const TOPIC_ID = 0; // не-forum чат: основной поток
const TAIL_LIMIT = 7000;

const collectOnly = process.argv.includes('--collect-only');
const indexOnly = process.argv.includes('--index-only');

async function collect(): Promise<void> {
  const client = await getConnectedRawScanClient();
  if (!client) throw new Error('MTProto недоступен (см. ошибки connect выше).');
  const store = new TgStore(dataPath('tg.sqlite'));
  try {
    const ref = await resolveChatTopic(client, CHAT_REF, String(TOPIC_ID));
    if (ref.chatKey !== CHAT_KEY) {
      throw new Error(`STOP: chatKey mismatch — @lookAtFactsChat резолвится в ${ref.chatKey}, ожидался ${CHAT_KEY}`);
    }
    console.log(`▶ chat: ${ref.chatTitle} | chatKey=${ref.chatKey} | topicId=${ref.topicId}`);
    saveChatTitle(ref.chatKey, ref.chatTitle);

    const t0 = Date.now();
    const r = await collectTopic(store, client, ref, {
      plain: true, // не-forum: основной поток без replyTo (как whole-chat auto-collect)
      onProgress: ({ fetched, newlyInserted }) => {
        if (fetched % 1000 === 0) {
          console.log(`  [collect] fetched=${fetched} new=${newlyInserted}`);
        }
      },
    });
    console.log(
      `✅ collect (${r.mode}): fetched=${r.fetched} new=${r.newlyInserted} updated=${r.updated} ` +
        `| всего в БД: ${r.total} | msg_id ${r.minIdSeen}..${r.maxIdSeen} | ${formatDuration(Date.now() - t0)}`,
    );
  } finally {
    store.close();
    try {
      await disconnectScanClient();
    } catch {
      /* cleanup gramjs update-loop — не ошибка операции */
    }
  }
}

async function index(): Promise<void> {
  // 1. Последние N текстовых сообщений, хронологически ASC (для buildTopicChunks).
  const raw = new DatabaseSync(dataPath('tg.sqlite'), { readOnly: true });
  const rows = raw
    .prepare(
      `SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
       FROM (
         SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ? AND text <> ''
         ORDER BY msg_id DESC
         LIMIT ?
       )
       ORDER BY msg_id ASC`,
    )
    .all(CHAT_KEY, TOPIC_ID, TAIL_LIMIT) as unknown as TgMessageRow[];
  raw.close();

  if (rows.length === 0) throw new Error('В tg.sqlite нет текстовых сообщений чата — сначала collect.');
  const first = rows[0];
  const last = rows[rows.length - 1];
  console.log(
    `▶ хвост: ${rows.length} текстовых сообщений, msg_id ${first.msg_id}..${last.msg_id}, ` +
      `${first.date_iso} .. ${last.date_iso}`,
  );

  const built = buildTopicChunks(rows);
  if (built.length === 0) throw new Error('buildTopicChunks вернул 0 чанков.');
  const range = `${built[0].chunk.metadata.section} → ${built[built.length - 1].chunk.metadata.section}`;
  console.log(`▶ чанков: ${built.length} (${range})`);

  const store = new RagStore(dataPath('rag.sqlite'));
  const embedder = makeEmbedder();
  try {
    // Смоук ДО очистки: эмбеддер жив, dim известен.
    const smoke = await embedder.embed(['смоук-запрос для проверки эмбеддера']);
    const dim = smoke[0]?.length ?? 0;
    if (dim === 0) throw new Error('Эмбеддер вернул пустой вектор.');
    console.log(`▶ embedder dim=${dim}`);

    const before = store.countBySourcePrefix('telegram', CHAT_KEY);
    store.clearBySourcePrefix('telegram', CHAT_KEY);
    console.log(`  очищено старых чанков этого чата: ${before} (остальные telegram-чанки не тронуты).`);

    const chunks = built.map((b) => b.chunk);
    const total = chunks.length;
    const t0 = Date.now();
    let lastBucket = -1;
    await indexDocuments(store, 'telegram', chunks, embedder, 32, (done) => {
      const pct = Math.floor((done / total) * 100);
      const bucket = Math.floor(pct / 5) * 5;
      if (bucket <= lastBucket && done < total) return;
      lastBucket = bucket;
      const rate = done > 0 ? (Date.now() - t0) / done : 0;
      const eta = done < total ? formatDuration(rate * (total - done)) : 'готово';
      console.log(`  [index ${done}/${total} · ${pct}% · ${eta}]`);
    });
    const st = store.stats('telegram');
    console.log(
      `✅ indexed за ${formatDuration(Date.now() - t0)}: в партиции telegram ${st.chunks} чанков, ` +
        `dim=${st.dim ?? '-'}, avgLen=${st.avgLen}`,
    );
    if (st.dim !== dim) throw new Error(`dim mismatch: index=${st.dim}, embedder=${dim}`);
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  if (!indexOnly) await collect();
  if (!collectOnly) await index();
  console.log('🎉 готово.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
