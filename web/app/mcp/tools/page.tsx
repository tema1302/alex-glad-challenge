// /mcp/tools — список инструментов настроенного MCP-сервера (день 28, web P5).
// 'use client': GET /api/mcp/tools. НИКАКИХ импортов core/ — тип инструмента инлайн.
// Редизайн C (день 30): grid of Cards (структура с description/schema не табличная) + StatusDot.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusDot } from '../../components/ui/StatusDot';

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
    <div className="space-y-8">
      <section>
        <SectionLabel>mcp · tools</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">MCP-инструменты</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Каталог инструментов MCP-сервера (<code className="font-mono text-[12px] text-ink">MCP_SERVER_URL</code>).
          Вызов — на странице <a href="/mcp/call" className="text-accent hover:underline">/mcp/call</a>.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? 'загрузка…' : 'обновить'}
        </Button>
        {configured !== null && (
          <StatusDot status={configured ? 'ok' : 'warn'} label={configured ? 'настроен' : 'не настроен'} />
        )}
      </div>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">{error}</p>
      )}

      <section>
        <SectionLabel>{`tools${tools.length > 0 ? ` · ${tools.length}` : ''}`}</SectionLabel>
        {tools.length === 0 ? (
          <p className="text-sm text-dim">
            {loading ? 'Загрузка…' : configured === false
              ? 'MCP-сервер не настроен. Задайте MCP_SERVER_URL в .env.'
              : 'Нет инструментов (или сервер недоступен).'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {tools.map((t) => (
              <Card key={t.name}>
                <div className="font-mono text-sm text-ink">{t.name}</div>
                {t.description && (
                  <p className="mt-1 text-sm leading-relaxed text-dim">{t.description}</p>
                )}
                {t.inputSchema && Object.keys(t.inputSchema).length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-mono text-xs uppercase tracking-wider text-dim">
                      inputSchema
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-bg p-2 font-mono text-xs text-dim">
                      {JSON.stringify(t.inputSchema, null, 2)}
                    </pre>
                  </details>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
