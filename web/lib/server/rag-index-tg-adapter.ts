// RAG index-tg adapter: индексация telegram → rag.sqlite (день 28, web P3b).
// Тонкий порт cli runRagIndexTgCommand (single-topic) и runRagIndexTgWholeChat в SSE.
//
// ⚠️ LANDMINE (memory, В6): single-topic (topicId задан) при reset:true вызывает
// store.clearStrategy('telegram') — чистит ВСЮ telegram-партицию (все чаты/топики).
// UI /rag/index-tg требует красного warning + confirm-чекбокса именно для reset.
// whole-chat (topicId не задан) чистит только чат (clearBySourcePrefix) — безопаснее.
//
// Поведение reset в web (отличие от cli, оговорено в артефакте):
//  - cli single-topic ВСЕГДА чистит партицию (tier1 default + --reset).
//  - web: reset:true → clearStrategy('telegram') (явный деструктив, gated confirm);
//    reset:false → чисто аддитивный INSERT (без clear). Это безопаснее, но повторный
//    прогон без reset даст дубликаты (rag_chunks без UNIQUE) — задокументированный риск.
//
// server-only: MTProto/TG_SESSION через core/ getConnectedRawScanClient (одно место).
// collectTopic + indexDocuments имеют onProgress → live-стадии. Всё под withDb (R4).
import 'server-only';
import {
  getConnectedRawScanClient,
  disconnectScanClient,
  isScanConfigured,
  collectTopic,
  resolveChatTopic,
  resolveChatKey,
  listForumTopicIds,
  buildTopicChunks,
  indexDocuments,
  makeEmbedder,
  saveChatTitle,
  type ChatTopicRef,
} from './challenge';
import { getRagStore, getTgStore, withDb } from './db';
import { safeMessage } from './safe-message';
import type { SseRagIndexTgEvent } from '../shared/sse';

async function safeDisconnectScan(): Promise<void> {
  try {
    await disconnectScanClient();
  } catch {
    /* cleanup-ошибка gramjs update-loop — игнорируем */
  }
}

export interface RagIndexTgOpts {
  reset?: boolean;
  limit?: number;
  top?: number;
}

/**
 * Индексировать telegram-контент в rag.sqlite. mode = single (topicId задан) | whole.
 * Проталкивает SSE-события через send. Ошибки → send('error') + return.
 */
export async function executeRagIndexTg(
  send: (ev: SseRagIndexTgEvent) => void,
  chatRef: string,
  topicId?: number,
  opts: RagIndexTgOpts = {},
): Promise<void> {
  const isSingle = topicId != null && Number.isFinite(topicId);

  if (!isScanConfigured()) {
    send({
      type: 'error',
      message: 'MTProto не настроен: задайте TG_API_ID, TG_API_HASH, TG_SESSION в .env.',
    });
    return;
  }
  const client = await getConnectedRawScanClient();
  if (!client) {
    send({ type: 'error', message: 'Не удалось подключиться к MTProto (см. stderr сервера).' });
    return;
  }

  try {
    if (isSingle) {
      await runSingle(send, client, chatRef, topicId as number, opts);
    } else {
      await runWholeChat(send, client, chatRef, opts);
    }
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : safeMessage(String(e));
    send({ type: 'error', message });
  } finally {
    await safeDisconnectScan();
  }
}

// --- single-topic: collect (если надо) → buildTopicChunks → (reset? clear) → index ---
async function runSingle(
  send: (ev: SseRagIndexTgEvent) => void,
  client: Awaited<ReturnType<typeof getConnectedRawScanClient>> & object,
  chatRef: string,
  topicId: number,
  opts: RagIndexTgOpts,
): Promise<void> {
  const ref = await resolveChatTopic(client, chatRef, String(topicId));
  saveChatTitle(ref.chatKey, ref.chatTitle);
  send({
    type: 'stage',
    step: 'start',
    detail: { mode: 'single', chatKey: ref.chatKey, topicId: ref.topicId },
  });

  await withDb(async () => {
    const tg = getTgStore();
    const rag = getRagStore();
    const before = tg.countInTopic(ref.chatKey, ref.topicId);
    // авто-collect при reset или пустом топике (зеркало cli single-topic L1856-1890).
    if (opts.reset || before === 0) {
      send({ type: 'stage', step: 'collect', detail: { topicId: ref.topicId } });
      await collectTopic(tg, client, ref, {
        reset: opts.reset,
        limit: opts.limit,
        onProgress: ({ fetched, newlyInserted }) =>
          send({
            type: 'stage',
            step: 'progress',
            detail: { fetched, newlyInserted },
          }),
      });
    }

    const rows = tg.listForIndex(ref.chatKey, ref.topicId);
    if (rows.length === 0) {
      throw new Error(
        `Нет текстовых сообщений в топике ${ref.chatKey}/${ref.topicId} (media-only/пустые).`,
      );
    }
    const built = buildTopicChunks(rows);
    if (built.length === 0) {
      throw new Error('buildTopicChunks вернул 0 чанков — нечего индексировать.');
    }

    // top-N (опц.). Без top — индексируем все чанки топика (web-упрощение; cli режет 1500).
    const n = opts.top ?? built.length;
    const tier = built.slice(0, n);
    const chunks = tier.map((t) => t.chunk);

    if (opts.reset) {
      // ⚠️ ДЕСТРУКТИВНО: чистит ВСЮ telegram-партицию (все чаты). Gated confirm в UI.
      const cleared = rag.count('telegram');
      rag.clearStrategy('telegram');
      send({ type: 'stage', step: 'clear', detail: { cleared } });
    }

    await indexDocuments(rag, 'telegram', chunks, makeEmbedder(), 32, (indexed, total) =>
      send({ type: 'stage', step: 'progress', detail: { indexed, total } }),
    );

    const st = rag.stats('telegram');
    send({
      type: 'done',
      mode: 'single',
      chatKey: ref.chatKey,
      indexed: chunks.length,
      total: st.chunks,
      dim: st.dim ?? null,
    });
  });
}

// --- whole-chat: resolveChatKey → list topics → collect empty → top-N across topics → index ---
async function runWholeChat(
  send: (ev: SseRagIndexTgEvent) => void,
  client: Awaited<ReturnType<typeof getConnectedRawScanClient>> & object,
  chatRef: string,
  opts: RagIndexTgOpts,
): Promise<void> {
  const resolved = await resolveChatKey(client, chatRef);
  const { chatKey, chatTitle } = resolved;
  const entity = resolved.entity;
  const isForum = Boolean((entity as { forum?: boolean }).forum);
  saveChatTitle(chatKey, chatTitle);
  send({ type: 'stage', step: 'start', detail: { mode: 'whole', chatKey } });

  await withDb(async () => {
    const tg = getTgStore();
    const rag = getRagStore();

    // 1. topicIds: forum → GetForumTopics (fallback на собранные в tg.sqlite); не-forum → [0].
    let topicIds: number[];
    if (isForum) {
      try {
        topicIds = await listForumTopicIds(client, entity);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        topicIds = tg.listTopicIds(chatKey);
        send({
          type: 'stage',
          step: 'collect',
          detail: { mode: `forum-fallback(${m.slice(0, 60)}): ${topicIds.length} из tg.sqlite` },
        });
      }
      if (topicIds.length === 0) {
        throw new Error(
          `Нет топиков для индексации (чат ${chatKey} пуст или не собран). Сначала: TG collect.`,
        );
      }
    } else {
      topicIds = [0];
    }

    // 2. Чистим только этот чат (не всю партицию) — whole-chat безопаснее single-topic.
    const cleared = rag.countBySourcePrefix('telegram', chatKey);
    rag.clearBySourcePrefix('telegram', chatKey);
    send({ type: 'stage', step: 'clear', detail: { cleared } });

    // 3. Собираем чанки по всем топикам (с авто-collect пустых).
    const allBuilt: ReturnType<typeof buildTopicChunks> = [];
    for (const tid of topicIds) {
      const inTopic = tg.countInTopic(chatKey, tid);
      if (inTopic === 0) {
        const ref: ChatTopicRef = {
          entity,
          chatKey,
          topicId: tid,
          chatTitle,
        };
        send({ type: 'stage', step: 'collect', detail: { topicId: tid } });
        await collectTopic(tg, client, ref, {
          ...(tid === 0 ? { plain: true } : {}),
          limit: opts.limit,
          onProgress: ({ fetched, newlyInserted }) =>
            send({
              type: 'stage',
              step: 'progress',
              detail: { topicId: tid, fetched, newlyInserted },
            }),
        });
      }
      const rows = tg.listForIndex(chatKey, tid);
      const built = buildTopicChunks(rows);
      if (built.length > 0) allBuilt.push(...built);
    }

    if (allBuilt.length === 0) {
      throw new Error('buildTopicChunks вернул 0 чанков по всем топикам — нечего индексировать.');
    }

    // 4. Глобальный рейтинг по реакциям across topics, top-N ограничивает итог.
    allBuilt.sort((a, b) => b.reactionTotal - a.reactionTotal);
    const DEFAULT_TG_TOP = 1500;
    const n = opts.top ?? DEFAULT_TG_TOP;
    const tier = allBuilt.slice(0, n);
    const chunks = tier.map((t) => t.chunk);

    await indexDocuments(rag, 'telegram', chunks, makeEmbedder(), 32, (indexed, total) =>
      send({ type: 'stage', step: 'progress', detail: { indexed, total } }),
    );

    const st = rag.stats('telegram');
    send({
      type: 'done',
      mode: 'whole',
      chatKey,
      indexed: chunks.length,
      total: st.chunks,
      dim: st.dim ?? null,
    });
  });
}
