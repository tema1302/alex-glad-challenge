// /agent — single-shot вопрос LLM (день 28, web P5).
// 'use client': форма (prompt + llm radio) → POST /api/agent → ответ. НИКАКИХ импортов core/.
'use client';

import { useCallback, useState } from 'react';

export default function AgentPage() {
  const [prompt, setPrompt] = useState('');
  const [llm, setLlm] = useState<'local' | 'cloud'>('cloud');
  const [answer, setAnswer] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setAnswer(null);
    try {
      const r = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), llm }),
      });
      const data = (await r.json()) as { ok?: boolean; answer?: string; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setAnswer(data.answer ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'agent failed');
    } finally {
      setSubmitting(false);
    }
  }, [prompt, llm, submitting]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Агент (LLM)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Single-shot вопрос к LLM через <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">core/Agent</code>.
          Без истории хода (для диалога — <a href="/chat" className="text-accent hover:underline">/chat</a>).
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">Вопрос</label>
        <textarea
          className="mt-1 h-32 w-full rounded border border-neutral-300 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Спросите что-нибудь…"
          disabled={submitting}
        />

        <fieldset className="mt-3 text-sm">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">LLM</span>
          <div className="mt-1 flex gap-3">
            {(['cloud', 'local'] as const).map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input type="radio" name="llm" checked={llm === v} onChange={() => setLlm(v)} disabled={submitting} />
                {v === 'cloud' ? 'облако (DeepSeek/OpenRouter)' : 'локально (Ollama)'}
              </label>
            ))}
          </div>
        </fieldset>

        <button
          className="mt-3 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={submit}
          disabled={submitting || !prompt.trim()}
        >
          {submitting ? 'Думаю…' : 'Спросить'}
        </button>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {answer !== null && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Ответ</h2>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 font-sans text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
            {answer || '(пустой ответ)'}
          </pre>
        </section>
      )}
    </div>
  );
}
