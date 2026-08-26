// /jira — форма генератора (единственный client-компонент страницы; паттерн agent/page.tsx).
// textarea + radio провайдера + чип «вставить пример» → POST /api/jira/generate → ответ
// целиком в <pre> + CopyButton (реюз /harness). Без markdown-рендера и dangerouslySetInnerHTML.
// Флаги провайдеров приходят с сервера как props (только Boolean/имена провайдеров);
// дефолт — cloud при настроенном ключе (решение плана), переключатель остаётся.
'use client';

import { useCallback, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { CopyButton } from '../harness/CopyButton';
import type { JiraGenerateInput } from '../../lib/shared/forms';

const INPUT =
  'w-full rounded border border-line-strong bg-surface-2 p-2 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

/** Провайдерские флаги с сервера: наружу только Boolean/имена, значения ключей не покидают lib/server. */
export interface JiraProviderFlags {
  cloudConfigured: boolean;
  cloudProvider: string | null;
  localConfigured: boolean;
  localModel: string | null;
}

export function JiraForm({ providers, example }: { providers: JiraProviderFlags; example: string }) {
  const [description, setDescription] = useState('');
  const [llm, setLlm] = useState<'local' | 'cloud'>(
    providers.cloudConfigured ? 'cloud' : 'local',
  );
  const [story, setStory] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const body: JiraGenerateInput = {
        description: description.trim(),
        llm,
      };
      const r = await fetch('/api/jira/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as { ok?: boolean; story?: string; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setStory(data.story ?? '');
      setDescription('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generation failed');
    } finally {
      setSubmitting(false);
    }
  }, [description, llm, submitting]);

  const canSubmit = description.trim().length >= 20 && !submitting;

  return (
    <div className="space-y-5">
      <Card label="описание фичи">
        <textarea
          className={`h-32 resize-y ${INPUT}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={example}
          disabled={submitting}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setDescription(example)}
            disabled={submitting || description.length > 0}
          >
            вставить пример
          </Button>
        </div>

        <fieldset className="mt-3 text-sm">
          <span className="block text-xs uppercase tracking-wide text-dim">LLM</span>
          <div className="mt-1 flex gap-3">
            {(['cloud', 'local'] as const).map((v) => {
              const unavailable = v === 'cloud' ? !providers.cloudConfigured : !providers.localConfigured;
              return (
                <label key={v} className={`flex items-center gap-1.5 ${unavailable ? 'opacity-50' : 'text-ink'}`}>
                  <input
                    type="radio"
                    name="llm"
                    checked={llm === v}
                    onChange={() => setLlm(v)}
                    disabled={submitting || unavailable}
                  />
                  {v === 'cloud'
                    ? `облако${providers.cloudProvider ? ` (${providers.cloudProvider})` : ''}`
                    : `локально${providers.localModel ? ` (${providers.localModel})` : ''}`}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Генерирую… обычно до минуты' : 'Сгенерировать задачу'}
          </Button>
          <span className="font-mono text-xs text-dim">
            {description.trim().length > 0 && description.trim().length < 20
              ? 'ещё немного — минимум 20 символов'
              : 'результат копируется кнопкой «скопировать» после генерации'}
          </span>
        </div>
      </Card>

      {error && (
        <p className="rounded border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      {story !== null && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>готовая задача</SectionLabel>
            <CopyButton text={story} />
          </div>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink">
            {story || '(пустой ответ)'}
          </pre>
        </section>
      )}
    </div>
  );
}

