// TG-collect adapter: single-topic MTProto-сбор в tg.sqlite (день 28, web P3b).
// Тонкий порт cli runTgCollectCommand в request/response: getConnectedRawScanClient →
// resolveChatTopic → collectTopic(onProgress→SSE). TG_SESSION живёт только в core/
// (getConnectedRawScanClient); adapter значения ключей/session не видит и не передаёт.
//
// server-only: все core/-импорты через web/lib/server/challenge.ts chokepoint.
// collectTopic имеет onProgress → live-стадии 'progress' (fetched/newlyInserted/lastId).
// signal: collectTopic не принимает AbortSignal (внутренний async-iterator gramjs);
// при disconnect клиента операция доделается сервером (1-юзер локально — приемлемо,
// как и в P4a news/scout). Зеркало cli: disconnect в finally (cleanup update-loop gramjs).
import 'server-only';
import {
  getConnectedRawScanClient,
  disconnectScanClient,
  isScanConfigured,
  collectTopic,
  resolveChatTopic,
  saveChatTitle,
} from './challenge';
import { getTgStore, withDb } from './db';
import { safeMessage } from './safe-message';
import type { SseTgCollectEvent } from '../shared/sse';

// cleanup gramjs update-loop: ошибка после успешной операции не должна рвать stream.
// Зеркало cli safeDisconnectScan (L1451) — обобщаем, не дублируя core/-экспорт.
async function safeDisconnectScan(): Promise<void> {
  try {
    await disconnectScanClient();
  } catch {
    /* cleanup-ошибка gramjs update-loop — игнорируем */
  }
}

export interface TgCollectOpts {
  limit?: number;
  reset?: boolean;
}

/**
 * Собрать forum-топик в tg.sqlite. Проталкивает SSE-события через send.
 * Возвращает CollectResult-проекцию (для route-лога/теста). Ошибки → send('error') + return.
 */
export async function executeTgCollect(
  send: (ev: SseTgCollectEvent) => void,
  chatRef: string,
  topicId?: number,
  opts: TgCollectOpts = {},
): Promise<void> {
  if (!isScanConfigured()) {
    send({
      type: 'error',
      message: 'MTProto не настроен: задайте TG_API_ID, TG_API_HASH, TG_SESSION в .env.',
    });
    return;
  }

  const client = await getConnectedRawScanClient();
  if (!client) {
    send({
      type: 'error',
      message: 'Не удалось подключиться к MTProto (см. stderr сервера).',
    });
    return;
  }

  try {
    // resolveChatTopic требует topicId (из аргумента / URL t.me/<chat>/<T> / env TG_TOPIC).
    // При его отсутствии бросает понятную ошибку — прокидываем в error-event.
    const ref = await resolveChatTopic(client, chatRef, topicId != null ? String(topicId) : undefined);
    // Кэшируем title для каталога чатов (REPL /list, /rag/chats) — наполняется только при collect.
    saveChatTitle(ref.chatKey, ref.chatTitle);
    send({
      type: 'stage',
      step: 'start',
      detail: { chatKey: ref.chatKey, topicId: ref.topicId, chatTitle: ref.chatTitle },
    });

    const result = await withDb(() =>
      collectTopic(getTgStore(), client, ref, {
        limit: opts.limit,
        reset: opts.reset,
        onProgress: ({ fetched, newlyInserted, lastId }) =>
          send({
            type: 'stage',
            step: 'progress',
            detail: { fetched, newlyInserted, lastId },
          }),
      }),
    );

    send({
      type: 'done',
      mode: result.mode,
      fetched: result.fetched,
      newlyInserted: result.newlyInserted,
      updated: result.updated,
      total: result.total,
      chatKey: result.chatKey,
      topicId: result.topicId,
      chatTitle: result.chatTitle,
    });
  } catch (e) {
    const message = e instanceof Error ? safeMessage(e.message) : safeMessage(String(e));
    send({ type: 'error', message });
  } finally {
    await safeDisconnectScan();
  }
}
