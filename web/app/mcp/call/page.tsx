// /mcp/call — вызов инструмента MCP-сервера (день 28, web P5).
// 'use client': форма (tool select, args JSON textarea) → POST /api/mcp/call → результат.
// tool select наполняется из GET /api/mcp/tools. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';

interface McpTool {
  name: string;
  description?: string;
}

export default function McpCallPage() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [tool, setTool] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [result, setResult] = useState<string | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const r = await fetch('/api/mcp/tools');
      const data = (await r.json()) as { tools?: McpTool[]; configured?: boolean; error?: string };
      setTools(data.tools ?? []);
      if ((data.tools ?? []).length > 0 && !tool) setTool(data.tools![0].name);
      if (data.configured === false) setError(data.error ?? 'MCP-сервер не настроен');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load tools failed');
    } finally {
      setLoadingTools(false);
    }
  }, [tool]);

  useEffect(() => { void loadTools(); }, [loadTools]);

  const call = useCallback(async () => {
    if (!tool || submitting) return;
    let args: Record<string, unknown> | undefined;
    const trimmed = argsText.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('args должен быть JSON-объектом');
        }
        args = parsed as Record<string, unknown>;
      } catch (e) {
        setError(e instanceof Error ? `args: ${e.message}` : 'args: невалидный JSON');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, args }),
      });
      const data = (await r.json()) as { ok?: boolean; result?: string; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResult(data.result ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'call failed');
    } finally {
      setSubmitting(false);
    }
  }, [tool, argsText, submitting]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Вызов MCP-инструмента</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Generic-вызов инструмента на MCP-сервере. Аргументы — JSON-объект, идут как данные.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">Инструмент</label>
        {tools.length > 0 ? (
          <select
            className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 p-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            disabled={submitting}
          >
            {tools.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        ) : (
          <p className="mt-1 text-sm text-neutral-400">
            {loadingTools ? 'Загрузка инструментов…' : 'Нет инструментов (сервер не настроен/недоступен).'}
          </p>
        )}

        <label className="mt-3 block text-xs uppercase tracking-wide text-neutral-500">
          Аргументы (JSON-объект)
        </label>
        <textarea
          className="mt-1 h-32 w-full rounded border border-neutral-300 bg-neutral-50 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          disabled={submitting}
          spellCheck={false}
        />

        <button
          className="mt-3 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={call}
          disabled={submitting || !tool}
        >
          {submitting ? 'Вызов…' : 'Вызвать'}
        </button>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {result !== null && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Результат</h2>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-neutral-200 bg-white p-3 text-sm whitespace-pre-wrap dark:border-neutral-800 dark:bg-neutral-900">
            {result || '(пустой ответ)'}
          </pre>
        </section>
      )}
    </div>
  );
}
