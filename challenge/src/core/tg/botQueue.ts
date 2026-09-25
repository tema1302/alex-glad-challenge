// Исходящая очередь бота: пагинация 4096 (куски ≤3900), глобальный гэп ≥1.2 с
// между сообщениями чата, 429 → sleep(retry_after+1) и ретрай, прочие ошибки —
// 1 ретрай, затем дроп с колбэком (не молча). Отправитель инжектится — юнит-тесты
// гоняют очередь без сети.

export interface OutboundMessage {
  chatId: string;
  text: string;
  replyTo?: number;
  markup?: InlineKeyboard | undefined;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

/** Ошибка отправки с опциональным retry_after (429) — транспорт знает код. */
export class SendError extends Error {
  constructor(
    message: string,
    readonly retryAfterSec: number | null,
  ) {
    super(message);
  }
}

/** Возвращает message_id отправленного сообщения (дроп/legacy-отправитель → null/undefined). */
export type OutboundSender = (m: OutboundMessage) => Promise<number | null | undefined>;

const DEFAULT_GAP_MS = 1200;
const MAX_CHUNK = 3900;
const MAX_ATTEMPTS = 2;

/**
 * Лимит Telegram 4096 знаков → куски ≤ maxLen: рез по границе строки, длинный
 * абзац — жёстко. Гарантия: непустые куски длиной ≤ maxLen, конкатенация (без
 * учёта добавленных при склейке переводов строк) покрывает исходный текст.
 */
export function splitText(text: string, maxLen = MAX_CHUNK): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export interface OutboxQueueOpts {
  sender: OutboundSender;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (message: string) => void;
}

export class OutboxQueue {
  private readonly sender: OutboundSender;
  private readonly gapMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly onError: (message: string) => void;
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(opts: OutboxQueueOpts) {
    this.sender = opts.sender;
    this.gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
    this.sleepFn = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onError = opts.onError ?? (() => {});
  }

  size(): number {
    return this.pending;
  }

  /** Ставит сообщение (пагинация внутри); промис — message_id ПОСЛЕДНЕГО куска
   *  (дроп любого куска → null) после отправки. */
  enqueue(m: OutboundMessage): Promise<number | null> {
    this.pending++;
    const job = async (): Promise<number | null> => {
      try {
        return await this.sendAll(m);
      } finally {
        this.pending--;
      }
    };
    const run = this.chain.then(job);
    this.chain = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** Дождаться опустошения очереди (graceful shutdown). */
  async drain(): Promise<void> {
    await this.chain;
  }

  private async sendAll(m: OutboundMessage): Promise<number | null> {
    const chunks = splitText(m.text);
    let lastId: number | null = null;
    let dropped = false;
    for (let i = 0; i < chunks.length; i++) {
      const part: OutboundMessage = {
        ...m,
        text: chunks.length > 1 ? `${i + 1}/${chunks.length}\n${chunks[i]}` : chunks[i],
      };
      let delivered = false;
      let ordinary = 0; // обычные ретраи: макс 1 (спек: ретраи ×2)
      let throttled = 0; // 429-ретраев макс 5, чтобы не крутиться вечно
      while (!delivered) {
        try {
          const id = await this.sender(part);
          if (typeof id === 'number') lastId = id;
          delivered = true;
        } catch (err) {
          if (err instanceof SendError && err.retryAfterSec != null) {
            if (++throttled > 5) {
              this.onError('отправка не удалась: повторные 429, кусок дропнут');
              dropped = true;
              break;
            }
            await this.sleepFn((err.retryAfterSec + 1) * 1000);
            continue;
          }
          if (++ordinary < MAX_ATTEMPTS) {
            await this.sleepFn(500);
            continue;
          }
          this.onError(`отправка не удалась, кусок дропнут: ${errText(err)}`);
          dropped = true;
          break;
        }
      }
      // Гэп после КАЖДОГО куска (включая последний): гарантирует ≥1.2 с между
      // сообщениями чата, а не только между кусками одного сообщения.
      await this.sleepFn(this.gapMs);
    }
    return dropped ? null : lastId;
  }
}

/** Кулдаун per-user: 3 команды/мин; при превышении — подсказка не чаще 30 с. */
export class CooldownLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly lastHint = new Map<string, number>();

  constructor(
    private readonly maxPerWindow = 3,
    private readonly windowMs = 60_000,
    private readonly hintEveryMs = 30_000,
  ) {}

  check(userId: string, nowMs: number): { allowed: boolean; hint: boolean } {
    const windowStart = nowMs - this.windowMs;
    const recent = (this.hits.get(userId) ?? []).filter((t) => t > windowStart);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(userId, recent);
      const lastHint = this.lastHint.get(userId) ?? -Infinity;
      const hint = nowMs - lastHint >= this.hintEveryMs;
      if (hint) this.lastHint.set(userId, nowMs);
      return { allowed: false, hint };
    }
    recent.push(nowMs);
    this.hits.set(userId, recent);
    return { allowed: true, hint: false };
  }
}

/** Единый хелпер «ошибка → короткий текст» (используется и ботом). */
export function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}
