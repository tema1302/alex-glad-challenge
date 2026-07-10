// /telegram/publish — отправка текста в TG-канал (день 28, web P3b).
// 'use client': textarea → confirm-чекбокс → POST /api/telegram/publish. Реальный внешний
// эффект, поэтому кнопка требует подтверждения. 0 core/ (только web/lib/shared/*).
'use client';

import { useState } from 'react';

interface PublishResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export default function TelegramPublishPage() {
  const [text, setText] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (!text.trim() || loading || !confirmChecked) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/telegram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = (await r.json()) as PublishResult;
      if (!r.ok || !data.ok) {
        setError(data.error ?? `HTTP ${r.status}`);
      } else {
        setResult(data);
        setText('');
        setConfirmChecked(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">TG publish — отправка в канал</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Отправка текста в TG-канал через Bot API. Реальный внешний эффект — сообщение уйдёт
          подписчикам канала. Требуется настроенный токен бота и ID канала (на сервере в .env).
        </p>
      </section>

      <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p className="font-medium text-amber-800 dark:text-amber-400">⚠️ Внешний эффект</p>
        <p className="mt-1 text-amber-700 dark:text-amber-300">
          Кнопка отправит сообщение в канал без возможности отмены. HTML-разметка разрешена
          (parse_mode: HTML). Подтвердите, прежде чем нажимать.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-sm">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Текст сообщения</span>
          <textarea
            className="mt-1 h-40 w-full resize-y rounded border border-neutral-300 bg-neutral-50 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            placeholder="Текст поста (HTML разрешён)…"
          />
        </label>
        <p className="mt-1 text-xs text-neutral-400">{text.length}/4000</p>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            disabled={loading}
          />
          <span>Подтверждаю отправку в TG-канал.</span>
        </label>

        <button
          className="mt-4 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void run()}
          disabled={loading || !text.trim() || !confirmChecked}
        >
          {loading ? '…' : 'Отправить'}
        </button>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            ✓ Отправлено. message_id={result.messageId ?? '-'}
          </p>
        </section>
      )}
    </div>
  );
}
