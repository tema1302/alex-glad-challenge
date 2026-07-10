// /mcp/tools — список инструментов настроенного MCP-сервера (день 28, web P5).
// 'use client': GET /api/mcp/tools. НИКАКИХ импортов core/ — тип инструмента инлайн.
'use client';

import { useCallback, useEffect, useState } from 'react';

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export default function McpToolsPage() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/mcp/tools');
      const data = (await r.json()) as { configured?: boolean; tools?: McpTool[]; error?: string };
      setConfigured(data.configured ?? null);
      setTools(data.tools ?? []);
      if (data.error && !r.ok) setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">MCP-инструменты</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Каталог инструментов MCP-сервера (<code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">MCP_SERVER_URL</code>).
          Вызов — на странице <a href="/mcp/call" className="text-accent hover:underline">/mcp/call</a>.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={load}
          disabled={loading}
        >
          обновить
        </button>
        {configured !== null && (
          <span className={`rounded px-2 py-0.5 text-xs ${configured ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
            {configured ? 'настроен' : 'не настроен'}
          </span>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {tools.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {loading ? 'Загрузка…' : configured === false
            ? 'MCP-сервер не настроен. Задайте MCP_SERVER_URL в .env.'
            : 'Нет инструментов (или сервер недоступен).'}
        </p>
      ) : (
        <ul className="space-y-2">
          {tools.map((t) => (
            <li key={t.name} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="font-mono text-sm text-neutral-800 dark:text-neutral-200">{t.name}</div>
              {t.description && (
                <p className="mt-1 text-sm text-neutral-500">{t.description}</p>
              )}
              {t.inputSchema && Object.keys(t.inputSchema).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs uppercase tracking-wide text-neutral-500">inputSchema</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-950">
                    {JSON.stringify(t.inputSchema, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
