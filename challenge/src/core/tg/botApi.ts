// Клиент Telegram Bot API для «Фактчемпика»: тонкие обёртки над netFetch
// (chokepoint-инвариант — никакого другого fetch). Токен в URL НЕ логируется:
// ошибки идут через label netFetch, BotApiError содержит только description.
// Long polling: timeout сек в payload, timeoutMs строго больше (спек research-infra §3).

import { netFetch } from '../net.js';

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  is_bot?: boolean;
}

export interface TgChat {
  id: number;
  type?: string;
  title?: string;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number; text?: string; from?: TgUser };
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export class BotApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly retryAfterSec: number | null,
  ) {
    super(message);
  }
}

export interface BotApiSendMessageOpts {
  replyTo?: number;
  markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

export interface BotApiEditMessageOpts {
  markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

export class BotApiClient {
  constructor(private readonly botToken: string) {}

  private async call<T>(
    method: string,
    payload?: Record<string, unknown>,
    timeoutMs = 15_000,
    signal?: AbortSignal,
  ): Promise<T> {
    let res: Response;
    try {
      res = await netFetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        timeoutMs,
        label: 'Telegram Bot API',
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error(
        `Telegram Bot API (${method}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new BotApiError(`${method}: некорректный ответ Bot API`, res.status, null);
    }
    if (!data['ok']) {
      const description = String(data['description'] ?? 'неизвестная ошибка Bot API');
      const code = typeof data['error_code'] === 'number' ? data['error_code'] : null;
      let retryAfter: number | null = null;
      const params = data['parameters'] as { retry_after?: unknown } | undefined;
      if (params && typeof params.retry_after === 'number') retryAfter = params.retry_after;
      else {
        const m = /retry after (\d+)/i.exec(description);
        if (m) retryAfter = Number(m[1]);
      }
      throw new BotApiError(`${method}: ${description}`, code, retryAfter);
    }
    return data['result'] as T;
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe', undefined, 10_000);
  }

  deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook', { drop_pending_updates: false }, 10_000);
  }

  getUpdates(
    offset: number,
    timeoutSec: number,
    allowedUpdates: string[],
    signal?: AbortSignal,
  ): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, limit: 100, allowed_updates: allowedUpdates },
      (timeoutSec + 10) * 1000,
      signal,
    );
  }

  /** Обычный текст (без parse_mode — tainted-тексты БД, HTML-экранирование не нужно). */
  async sendMessage(
    chatId: string,
    text: string,
    opts: BotApiSendMessageOpts = {},
  ): Promise<number | null> {
    const result = await this.call<Record<string, unknown>>(
      'sendMessage',
      {
        chat_id: Number(chatId),
        text,
        disable_web_page_preview: true,
        reply_to_message_id: opts.replyTo,
        reply_markup: opts.markup,
      },
      15_000,
    );
    return typeof result['message_id'] === 'number' ? result['message_id'] : null;
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call<boolean>(
      'answerCallbackQuery',
      { callback_query_id: callbackQueryId, text },
      10_000,
    );
  }

  /**
   * Удаление сообщения (анонимизация записей «Изобрази»). false — Bot API
   * отказал («message to delete not found» / 403 not enough rights = бот не
   * админ); сетевые сбои бросаются как обычно.
   */
  async deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    try {
      await this.call<boolean>(
        'deleteMessage',
        { chat_id: Number(chatId), message_id: messageId },
        10_000,
      );
      return true;
    } catch (err) {
      if (err instanceof BotApiError && (err.code === 400 || err.code === 403)) return false;
      throw err;
    }
  }

  /** Правка текста сообщения (счётчик записей на анонсе). false при любой
   *  неудаче — вызовы best effort, не фатальны. */
  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    opts: BotApiEditMessageOpts = {},
  ): Promise<boolean> {
    try {
      await this.call<boolean>(
        'editMessageText',
        {
          chat_id: Number(chatId),
          message_id: messageId,
          text,
          disable_web_page_preview: true,
          reply_markup: opts.markup,
        },
        10_000,
      );
      return true;
    } catch {
      return false;
    }
  }
}
