// /admin/servers — карточки статусов сервисов (день 28, web P5).
// 'use client': GET /api/admin/servers → индикаторы configured (БЕЗ spawn, БЕЗ значений ключей).
// Редизайн C (день 30): grid of <Card> + <StatusDot> (Boolean only). Локальные Card/Badge удалены.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusDot } from '../../components/ui/StatusDot';

interface ServerStatuses {
  mcp: { configured: boolean; host: string | null; authConfigured: boolean };
  cloud: { configured: boolean; provider?: string; model?: string };
  local: { configured: boolean; model?: string };
  embed: { configured: boolean; model?: string };
  mtproto: { configured: boolean };
  botApi: { configured: boolean };
  activeModel: string | null;
  activeProvider: string | null;
}

export default function ServersPage() {
  const [data, setData] = useState<ServerStatuses | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/admin/servers');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as ServerStatuses);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>admin · servers</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Сервисы</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Статусы конфигурации. Только индикаторы (spawn серверов из UI не предусмотрен).
        </p>
      </section>

      <Button variant="ghost" onClick={load}>обновить</Button>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">{error}</p>
      )}

      {!data ? (
        <p className="text-sm text-dim">Загрузка…</p>
      ) : (
        <section>
          <SectionLabel>configuration · values hidden</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card label="MCP-сервер">
              <StatusDot status={data.mcp.configured ? 'ok' : 'off'} />
              {data.mcp.host && <div className="font-mono text-xs text-dim">{data.mcp.host}</div>}
              <div className="font-mono text-xs text-dim">auth: {data.mcp.authConfigured ? 'настроен' : 'нет'}</div>
            </Card>

            <Card label="Cloud LLM">
              <StatusDot status={data.cloud.configured ? 'ok' : 'off'} />
              {data.cloud.configured && (
                <div className="font-mono text-xs text-dim">{data.cloud.provider} · {data.cloud.model}</div>
              )}
            </Card>

            <Card label="Local LLM (Ollama)">
              <StatusDot status={data.local.configured ? 'ok' : 'off'} />
              {data.local.configured && <div className="font-mono text-xs text-dim">{data.local.model}</div>}
            </Card>

            <Card label="Embeddings">
              <StatusDot status={data.embed.configured ? 'ok' : 'off'} />
              {data.embed.configured && <div className="font-mono text-xs text-dim">{data.embed.model}</div>}
            </Card>

            <Card label="MTProto (userbot)">
              <StatusDot status={data.mtproto.configured ? 'ok' : 'off'} />
              <div className="font-mono text-xs text-dim">TG-скан/сбор топиков</div>
            </Card>

            <Card label="Bot API (публикация)">
              <StatusDot status={data.botApi.configured ? 'ok' : 'off'} />
              <div className="font-mono text-xs text-dim">Отправка в канал</div>
            </Card>

            <Card label="Активная модель">
              <div className="text-sm text-ink">{data.activeModel ?? '—'}</div>
              {data.activeProvider && <div className="font-mono text-xs text-dim">{data.activeProvider}</div>}
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}
