// /agent — single-shot вопрос LLM (день 28, web P5).
// 'use client': форма (prompt + llm radio) → POST /api/agent → ответ. НИКАКИХ импортов core/.
'use client';

import { useCallback, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';

const INPUT =
  'w-full rounded border border-line-strong bg-surface-2 p-2 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

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
        <h1 className="text-xl font-semibold text-ink">Агент (LLM)</h1>
        <p className="mt-1 text-sm text-dim">
          Single-shot вопрос к LLM через{' '}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs text-ink">core/Agent</code>. Без истории хода
          (для диалога — <a href="/chat" className="text-accent hover:underline">/chat</a>).
        </p>
      </section>

      <Card label="Вопрос">
        <textarea
          className={`h-32 resize-y ${INPUT}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Спросите что-нибудь…"
          disabled={submitting}
        />

        <fieldset className="mt-3 text-sm">
          <span className="block text-xs uppercase tracking-wide text-dim">LLM</span>
          <div className="mt-1 flex gap-3">
            {(['cloud', 'local'] as const).map((v) => (
              <label key={v} className="flex items-center gap-1.5 text-ink">
                <input
                  type="radio"
                  name="llm"
                  checked={llm === v}
                  onChange={() => setLlm(v)}
                  disabled={submitting}
                />
                {v === 'cloud' ? 'облако (DeepSeek/OpenRouter)' : 'локально (Ollama)'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-3">
          <Button variant="primary" onClick={submit} disabled={submitting || !prompt.trim()}>
            {submitting ? 'Думаю…' : 'Спросить'}
          </Button>
        </div>
      </Card>

      {error && <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>}

      {answer !== null && (
        <section>
          <SectionLabel>Ответ</SectionLabel>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-surface p-3 font-sans text-sm text-ink">
            {answer || '(пустой ответ)'}
          </pre>
        </section>
      )}
    </div>
  );
}
