// /telegram/publish — отправка текста в TG-канал (день 28, web P3b).
// 'use client': textarea → confirm-чекбокс → POST /api/telegram/publish. Реальный внешний
// эффект, поэтому кнопка требует подтверждения. 0 core/ (только web/lib/shared/*).
'use client';

import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

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
        <h1 className="text-xl font-semibold text-ink">TG publish — отправка в канал</h1>
        <p className="mt-1 text-sm text-dim">
          Отправка текста в TG-канал через Bot API. Реальный внешний эффект — сообщение уйдёт
          подписчикам канала. Требуется настроенный токен бота и ID канала (на сервере в .env).
        </p>
      </section>

      <section className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
        <p className="font-medium text-warn">⚠️ Внешний эффект</p>
        <p className="mt-1 text-warn">
          Кнопка отправит сообщение в канал без возможности отмены. HTML-разметка разрешена
          (parse_mode: HTML). Подтвердите, прежде чем нажимать.
        </p>
      </section>

      <Card label="Сообщение">
        <label className="block text-sm">
          <textarea
            className="mt-1 h-40 w-full resize-y rounded border border-line-strong bg-surface-2 p-2 font-mono text-xs text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
            placeholder="Текст поста (HTML разрешён)…"
          />
        </label>
        <p className="mt-1 text-xs text-dim">{text.length}/4000</p>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            disabled={loading}
          />
          <span>Подтверждаю отправку в TG-канал.</span>
        </label>

        <Button
          variant="primary"
          className="mt-4"
          onClick={() => void run()}
          disabled={loading || !text.trim() || !confirmChecked}
        >
          {loading ? '…' : 'Отправить'}
        </Button>
      </Card>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
        </p>
      )}

      {result && (
        <section className="rounded-md border border-ok/40 bg-ok/10 p-4 text-sm">
          <p className="font-medium text-ok">
            ✓ Отправлено. message_id={result.messageId ?? '-'}
          </p>
        </section>
      )}
    </div>
  );
}
