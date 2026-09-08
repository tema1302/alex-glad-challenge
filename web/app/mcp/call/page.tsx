// /mcp/call — вызов инструмента MCP-сервера (день 28, web P5).
// 'use client': форма (tool select, args JSON textarea) → POST /api/mcp/call → результат.
// tool select наполняется из GET /api/mcp/tools. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { INPUT_CLASS } from '../../components/ui/Field';
import { SectionHead } from '../../components/ui/SectionHead';

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
      <SectionHead
        code="mcp · call"
        title="Вызов MCP-инструмента"
        description="Вызов инструмента на MCP-сервере; аргументы передаются JSON-объектом."
      />

      <Card label="Инструмент">
        {tools.length > 0 ? (
          <select
            className={`${INPUT_CLASS} w-full font-mono`}
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            disabled={submitting}
          >
            {tools.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-dim">
            {loadingTools ? 'Загрузка инструментов…' : 'Нет инструментов (сервер не настроен/недоступен).'}
          </p>
        )}

        <div className="mt-3 text-xs font-medium text-dim">Аргументы (JSON-объект)</div>
        <textarea
          className={`mt-1 h-32 w-full font-mono text-xs ${INPUT_CLASS}`}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          disabled={submitting}
          spellCheck={false}
        />

        <div className="mt-3">
          <Button variant="primary" onClick={call} disabled={submitting || !tool}>
            {submitting ? 'Вызов…' : 'Вызвать'}
          </Button>
        </div>
      </Card>

      {error && (
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      {result !== null && (
        <section>
          <SectionLabel>Результат</SectionLabel>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-3 text-sm text-ink">
            {result || '(пустой ответ)'}
          </pre>
        </section>
      )}
    </div>
  );
}
