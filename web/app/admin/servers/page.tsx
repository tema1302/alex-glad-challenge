// /admin/servers — карточки статусов сервисов (день 28, web P5).
// 'use client': GET /api/admin/servers → индикаторы configured (БЕЗ spawn, БЕЗ значений ключей).
'use client';

import { useCallback, useEffect, useState } from 'react';

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

function Badge({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${on ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>
      {on ? (label ?? 'настроен') : (label ? `${label}: выкл` : 'не настроен')}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="mt-2 space-y-1 text-sm">{children}</div>
    </div>
  );
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
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Сервисы</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Статусы конфигурации. Только индикаторы (spawn серверов из UI не предусмотрен).
        </p>
      </section>

      <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white" onClick={load}>
        обновить
      </button>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-neutral-400">Загрузка…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card title="MCP-сервер">
            <Badge on={data.mcp.configured} />
            {data.mcp.host && <div className="font-mono text-xs text-neutral-400">{data.mcp.host}</div>}
            <div className="text-xs text-neutral-400">auth: {data.mcp.authConfigured ? 'настроен' : 'нет'}</div>
          </Card>

          <Card title="Cloud LLM">
            <Badge on={data.cloud.configured} />
            {data.cloud.configured && (
              <div className="text-xs text-neutral-400">{data.cloud.provider} · {data.cloud.model}</div>
            )}
          </Card>

          <Card title="Local LLM (Ollama)">
            <Badge on={data.local.configured} />
            {data.local.configured && <div className="text-xs text-neutral-400">{data.local.model}</div>}
          </Card>

          <Card title="Embeddings">
            <Badge on={data.embed.configured} />
            {data.embed.configured && <div className="text-xs text-neutral-400">{data.embed.model}</div>}
          </Card>

          <Card title="MTProto (userbot)">
            <Badge on={data.mtproto.configured} />
            <div className="text-xs text-neutral-400">TG-скан/сбор топиков</div>
          </Card>

          <Card title="Bot API (публикация)">
            <Badge on={data.botApi.configured} />
            <div className="text-xs text-neutral-400">Отправка в канал</div>
          </Card>

          <Card title="Активная модель">
            <div className="text-sm text-neutral-700 dark:text-neutral-300">
              {data.activeModel ?? '—'}
            </div>
            {data.activeProvider && <div className="text-xs text-neutral-400">{data.activeProvider}</div>}
          </Card>
        </div>
      )}
    </div>
  );
}
