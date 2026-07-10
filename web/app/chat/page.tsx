// /chat — выбор/создание chat-сессии. web P2.
// 'use client': список сессий (GET /api/chat) + форма создания (POST /api/chat → redirect).
// Если сессий нет — предлагает создать первую. Без импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { StrategyName } from '../../lib/shared/forms';

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
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Chat-агент</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Диалог с LLM: стратегии контекста, system-промпт, memory-режим. Сессия переживает reload.
        </p>
      </section>

      {/* Создание */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Новая сессия</h2>
        <div className="mt-2 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Стратегия</span>
            <select
              className="mt-1 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyName)}
              disabled={creating}
            >
              {STRATEGY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} disabled={creating} />
            memory mode
          </label>
          <button
            className="ml-auto rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void create()}
            disabled={creating}
          >
            {creating ? 'создаю…' : 'Создать и открыть'}
          </button>
        </div>
        <label className="mt-3 block text-sm">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">System-промпт (опц.)</span>
          <textarea
            className="mt-1 w-full resize-y rounded border border-neutral-300 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            rows={2}
            placeholder="Например: Ты — ревьюер кода."
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            disabled={creating}
          />
        </label>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Список */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Сессии {sessions ? `(${sessions.length})` : ''}
        </h2>
        {sessions === null ? (
          <p className="mt-2 text-sm text-neutral-400">Загрузка…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">
            Нет сессий. Создайте первую выше.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/chat/${s.id}`}
                  className="block rounded-lg border border-neutral-200 bg-white p-3 text-sm hover:border-accent dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-neutral-400">{s.id}</span>
                    <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">{s.strategy}</span>
                    {s.memoryEnabled && (
                      <span className="rounded-full border border-amber-300 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-700 dark:text-amber-400">memory</span>
                    )}
                    <span className="text-xs text-neutral-400">{s.messageCount} сообщений</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-neutral-500">
                    {s.system || '(system по умолчанию)'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
