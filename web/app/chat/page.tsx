// /chat — выбор/создание chat-сессии. web P2.
// 'use client': список сессий (GET /api/chat) + форма создания (POST /api/chat → redirect).
// Редизайн C (день 30): Card-форма создания + data-list таблица сессий. Логика без изменений.
// Если сессий нет — предлагает создать первую. Без импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { StrategyName } from '../../lib/shared/forms';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

interface SessionItem {
  id: string;
  strategy: StrategyName;
  system: string;
  memoryEnabled: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

const STRATEGY_OPTIONS: StrategyName[] = ['full', 'sliding', 'sticky', 'branching'];

const labelTagCls = 'block font-mono text-xs uppercase tracking-wider text-dim';
const inputCls =
  'mt-1 rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50';

export default function ChatPickerPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<StrategyName>('full');
  const [system, setSystem] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const r = await fetch('/api/chat');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { sessions: SessionItem[] };
      setSessions(data.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, system: system || undefined, memoryEnabled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { id: string };
      router.push(`/chat/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>chat agent</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Chat-агент</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Диалог с LLM: стратегии контекста, system-промпт, memory-режим. Сессия переживает reload.
        </p>
      </section>

      {/* Создание */}
      <Card label="new session">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className={labelTagCls}>Стратегия</span>
            <select
              className={inputCls}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyName)}
              disabled={creating}
            >
              {STRATEGY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} disabled={creating} />
            memory mode
          </label>
          <Button variant="primary" className="ml-auto" onClick={() => void create()} disabled={creating}>
            {creating ? 'создаю…' : 'Создать и открыть'}
          </Button>
        </div>
        <label className="mt-3 block text-sm">
          <span className={labelTagCls}>System-промпт (опц.)</span>
          <textarea
            className={`${inputCls} w-full resize-y p-2`}
            rows={2}
            placeholder="Например: Ты — ревьюер кода."
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            disabled={creating}
          />
        </label>
      </Card>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">{error}</p>
      )}

      {/* Список */}
      <section>
        <SectionLabel>{sessions ? `сессии · ${sessions.length}` : 'сессии'}</SectionLabel>
        {sessions === null ? (
          <p className="text-sm text-dim">Загрузка…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-dim">Нет сессий. Создайте первую выше.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">id</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">strategy</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">memory</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">msg</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">system</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
                    <td className="px-3 py-2 font-mono text-xs text-dim">
                      <Link href={`/chat/${s.id}`} className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">{s.id}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded border border-line px-2 py-0.5 font-mono text-xs text-ink">{s.strategy}</span>
                    </td>
                    <td className="px-3 py-2">
                      {s.memoryEnabled ? (
                        <span className="rounded bg-warn/15 px-2 py-0.5 font-mono text-[11px] text-warn">memory</span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-dim">{s.messageCount}</td>
                    <td className="max-w-md truncate px-3 py-2 text-xs text-dim">
                      {s.system || '(system по умолчанию)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
