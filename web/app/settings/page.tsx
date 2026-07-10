// /settings — настройки (день 28, web P5).
// 'use client': GET /api/settings (display серверной конфигурации БЕЗ ключей) +
// modelPref radio (POST /api/settings → cookie) + тема (next-themes, client-local).
// MCP_URL — read-only badge (смена через UI запрещена, §8 SSRF). НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

interface SettingsView {
  model: string | null;
  provider: string | null;
  mcpUrl: { configured: boolean; host: string | null };
  cloud: { configured: boolean; provider?: string; model?: string };
  localLlm: { configured: boolean; model?: string };
  modelPref: 'local' | 'cloud' | null;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelPref, setModelPref] = useState<'local' | 'cloud' | null>(null);
  const [savingPref, setSavingPref] = useState(false);

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/settings');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as SettingsView;
      setData(d);
      setModelPref(d.modelPref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const savePref = useCallback(async (pref: 'local' | 'cloud') => {
    setSavingPref(true);
    setError(null);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPref: pref }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setModelPref(pref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSavingPref(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Настройки</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Конфигурация сервера (только чтение) и preference. Ключи не отображаются.
        </p>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {data && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Конфигурация</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Активная модель</dt>
              <dd className="font-mono text-neutral-800 dark:text-neutral-200">{data.model ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Провайдер</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">{data.provider ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Cloud LLM</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">
                {data.cloud.configured ? `${data.cloud.provider} · ${data.cloud.model}` : 'не настроен'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Local LLM</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">
                {data.localLlm.configured ? data.localLlm.model : 'не настроен'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-neutral-500">MCP-сервер URL</dt>
              <dd className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${data.mcpUrl.configured ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                  {data.mcpUrl.configured ? 'настроен' : 'не настроен'}
                </span>
                {data.mcpUrl.host && (
                  <span className="font-mono text-xs text-neutral-400" title="read-only (env)">
                    {data.mcpUrl.host} 🔒
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-neutral-400">
            MCP_URL меняется только через .env (read-only в UI — защита от SSRF).
          </p>
        </section>
      )}

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Preference</h2>

        <fieldset className="mt-2 text-sm">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Модель по умолчанию</span>
          <div className="mt-1 flex gap-3">
            {(['cloud', 'local'] as const).map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="modelPref"
                  checked={modelPref === v}
                  onChange={() => void savePref(v)}
                  disabled={savingPref}
                />
                {v === 'cloud' ? 'облако' : 'локально'}
              </label>
            ))}
            {!modelPref && <span className="text-xs text-neutral-400">(не задан)</span>}
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Применяется как начальное значение LLM-селектора на /rag, /chat и /rag/chat
            (явный выбор в форме имеет приоритет).
          </p>
        </fieldset>

        <fieldset className="mt-3 text-sm">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">Тема</span>
          <div className="mt-1 flex gap-3">
            {(['light', 'dark'] as const).map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="theme"
                  checked={mounted && theme === v}
                  onChange={() => setTheme(v)}
                  disabled={!mounted}
                />
                {v === 'light' ? 'светлая' : 'тёмная'}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Тема хранится клиент-сайд (next-themes). Preference модели — в cookie.
          </p>
        </fieldset>
      </section>
    </div>
  );
}
