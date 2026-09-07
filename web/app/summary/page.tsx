// /summary — сводка ожидающих задач + кнопка «отправить в TG» (день 28, web P5;
// ТЗ §8.6: confirm через ConfirmDialog с target-каналом, результат через toast).
// 'use client': GET /api/summary (текст + publishable). Публикация — реальный
// внешний эффект, серверная логика — publishToTelegram('summary'). НИКАКИХ core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SectionHead } from '../components/ui/SectionHead';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { IconSend } from '../components/ui/icons';

export default function SummaryPage() {
  const { toast } = useToast();
  const [summary, setSummary] = useState<string | null>(null);
  const [publishable, setPublishable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [channelLabel, setChannelLabel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/summary');
      const data = (await r.json()) as { summary?: string; publishable?: boolean };
      setSummary(data.summary ?? '');
      setPublishable(Boolean(data.publishable));
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось загрузить сводку');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j: { botChannelLabel?: string | null }) => setChannelLabel(j.botChannelLabel ?? null))
      .catch(() => setChannelLabel(null));
  }, [load]);

  const publish = useCallback(async () => {
    if (publishing || !publishable) return;
    setPublishing(true);
    try {
      const r = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish: true }),
      });
      const data = (await r.json()) as { ok?: boolean; messageId?: number; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      toast('ok', `Сводка отправлена (message_id=${data.messageId ?? '?'})`);
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Ошибка публикации');
      throw e;
    } finally {
      setPublishing(false);
    }
  }, [publishing, publishable, toast]);

  return (
    <div className="space-y-6">
      <SectionHead
        code="summary · todos"
        title="Сводка задач"
        description="Ожидающие задачи из TodoDb. Сводку можно отправить в Telegram-канал (если настроен Bot API)."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? 'загрузка…' : 'обновить'}
          </Button>
        }
      />

      {!publishable && (
        <p className="text-xs text-dim">TG Bot API не настроен — публикация недоступна</p>
      )}

      <Card
        label="сводка"
        actions={
          publishable ? (
            <Button
              variant="primary"
              size="sm"
              icon={<IconSend />}
              onClick={() => setConfirmOpen(true)}
              disabled={publishing || loading}
            >
              Отправить в TG
            </Button>
          ) : null
        }
      >
        {summary === null ? (
          <div className="space-y-2">
            <Skeleton variant="line" />
            <Skeleton variant="line" />
          </div>
        ) : summary === '' ? (
          <p className="text-sm text-dim">Ожидающих задач нет.</p>
        ) : (
          <p className="whitespace-pre-wrap font-sans text-sm text-ink">{summary}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={publish}
        title="Отправить сводку в канал?"
        confirmLabel="Опубликовать"
        body={
          <div className="space-y-3">
            <p className="flex items-center gap-2">
              Канал: <Badge tone="accent">{channelLabel ?? 'TG_CHAT_ID'}</Badge>
            </p>
            <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              Реальная отправка — сводка ожидающих задач уйдёт подписчикам канала.
            </p>
          </div>
        }
      />
    </div>
  );
}
