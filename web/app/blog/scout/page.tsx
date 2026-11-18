// /blog/scout — 3 source-агента (RSS/соцсети-форумы/TG) → оркестратор (день 28, web P4b).
// 'use client': форма (query/hours/topK/Forum/TG/llm) → SSE (start → done/error).
// runSourceAgents без onProgress → прогресс = индикатор «работаю». В done — финальный топ
// оркестратора + сводка по агентам. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SseBlogScoutEvent } from '../../../lib/shared/sse';
import { intFieldError, NUMBER_FIELD_LIMITS } from '../../../lib/shared/forms';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SectionHead } from '../../components/ui/SectionHead';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { IconPlay } from '../../components/ui/icons';

type Llm = 'local' | 'cloud';

interface RankedTopic {
  title: string;
  source: string;
  hypeScore: number;
  hypeReason: string;
  orchestratorScore: number;
  orchestratorReason: string;
  url: string | null;
}
interface AgentSummary {
  agent: string;
  count: number;
  error: string | null;
}

interface BlogOption {
  slug: string;
  name: string;
}

// Кликабельные примеры: подставляют запрос в поле, чтобы не набирать вручную.
const QUERY_EXAMPLES = [
  'Футбольные новости мужского футбола АПЛ и Челси',
  'Продвинутая статистика по Челси',
  'Трансферы АПЛ: Челси, Арсенал, Ливерпуль',
  'xG и форма команд в АПЛ',
] as const;

export default function BlogScoutPage() {
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [blog, setBlog] = useState('');
  const [query, setQuery] = useState('');
  // number-draft (S4): строка до отправки — очистка не «отскакивает», ошибка
  // видна сразу; пустое поле не уходит в body (дефолт сервера). Границы — из
  // scoutOptsSchema (NUMBER_FIELD_LIMITS).
  const [hours, setHours] = useState('24');
  const [topK, setTopK] = useState('3');
  const hoursError = intFieldError(hours, { ...NUMBER_FIELD_LIMITS.hours, label: 'Часов' });
  const topKError = intFieldError(topK, { ...NUMBER_FIELD_LIMITS.topK, label: 'Топ (topK)' });
  const paramsInvalid = hoursError !== null || topKError !== null;
  const [enableForum, setEnableForum] = useState(true);
  const [enableTelegram, setEnableTelegram] = useState(false);
  const [llm, setLlm] = useState<Llm>('cloud');

  const [running, setRunning] = useState(false);
  const [ranked, setRanked] = useState<RankedTopic[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/blogs')
      .then((r) => r.json())
      .then((j: { blogs?: BlogOption[] }) => {
        const list = j.blogs ?? [];
        setBlogs(list);
        const fromQuery = new URLSearchParams(window.location.search).get('blog') ?? '';
        if (fromQuery && list.some((b) => b.slug === fromQuery)) setBlog(fromQuery);
      })
      .catch(() => setBlogs([]));
  }, []);

  const reset = (): void => {
    setRanked([]);
    setAgents([]);
    setError(null);
  };

  const run = useCallback(async () => {
    if (running || paramsInvalid) return;
    reset();
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const handle = (ev: SseBlogScoutEvent): void => {
      switch (ev.type) {
        case 'stage':
          break;
        case 'done':
          setRanked(ev.ranked);
          setAgents(ev.agents);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    };

    try {
      const resp = await fetch('/api/blog/scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(hours !== '' ? { hours: Number(hours) } : {}),
          ...(topK !== '' ? { topK: Number(topK) } : {}),
          ...(blog ? { blog } : {}),
          query: query.trim() || undefined,
          enableForum,
          enableTelegram,
          llm,
        }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        setError(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (!raw.startsWith('data:')) continue;
          const dataLine = raw.slice(5).trim();
          if (!dataLine) continue;
          let ev: SseBlogScoutEvent;
          try {
            ev = JSON.parse(dataLine) as SseBlogScoutEvent;
          } catch {
            continue;
          }
          handle(ev);
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Остановлено');
      } else {
        setError(e instanceof Error ? e.message : 'request failed');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [query, hours, topK, enableForum, enableTelegram, llm, blog, paramsInvalid, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-6">
      <SectionHead
        code="blog · scout"
        title="Scout: темы из RSS и соцсетей"
        description="Этап 1 пайплайна: RSS, Mastodon, Lemmy и Sports.ru собирают темы параллельно, оркестратор выбирает финальный топ под запрос — без написания поста."
      />

      <Card label="Параметры сбора">
        {/* <form> (S4): Enter в «Запросе» = «Запустить»; параметры — Field
            (label↔контрол), «Запрос» остаётся textbox (не searchbox). */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Field id="scout-blog" label="Блог" className="col-span-2">
                <select
                  className={`w-full ${INPUT_CLASS}`}
                  value={blog}
                  onChange={(e) => setBlog(e.target.value)}
                  disabled={running}
                >
                  <option value="">— без блога —</option>
                  {blogs.map((b) => (
                    <option key={b.slug} value={b.slug}>{b.name}</option>
                  ))}
                </select>
              </Field>

              <Field id="scout-hours" label="Часов" hint="1–168" error={hoursError ?? undefined}>
                <input
                  className={`w-full ${INPUT_CLASS}`}
                  type="number"
                  min={1}
                  max={168}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  disabled={running}
                />
              </Field>

              <Field id="scout-topk" label="Топ (topK)" hint="1–10" error={topKError ?? undefined}>
                <input
                  className={`w-full ${INPUT_CLASS}`}
                  type="number"
                  min={1}
                  max={10}
                  value={topK}
                  onChange={(e) => setTopK(e.target.value)}
                  disabled={running}
                />
              </Field>

              <Field id="scout-llm" label="LLM" className="col-span-2 sm:col-span-1">
                <select
                  className={`w-full ${INPUT_CLASS}`}
                  value={llm}
                  onChange={(e) => setLlm(e.target.value as Llm)}
                  disabled={running}
                >
                  <option value="cloud">cloud</option>
                  <option value="local">local (Ollama)</option>
                </select>
              </Field>
            </div>

            <div>
              <Field id="scout-query" label="Запрос">
                <input
                  className={`w-full ${INPUT_CLASS}`}
                  type="text"
                  placeholder="Например: футбольные новости АПЛ и Челси"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={running}
                />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-dim">Примеры:</span>
                {QUERY_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setQuery(example)}
                    disabled={running}
                    className="rounded-full border border-line-strong px-2.5 py-1 text-left text-xs text-dim transition-colors duration-fast hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-4 text-sm text-ink">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enableForum}
                    onChange={(e) => setEnableForum(e.target.checked)}
                    disabled={running}
                  />
                  Соцсети/форумы
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={enableTelegram}
                    onChange={(e) => setEnableTelegram(e.target.checked)}
                    disabled={running}
                  />
                  TG
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="primary"
                  icon={<IconPlay />}
                  loading={running}
                  type="submit"
                  disabled={running || paramsInvalid}
                  className="w-full sm:w-auto"
                >
                  Запустить
                </Button>
                {/* «Стоп» — регресс-стоп: активна во время стрима, без loading. */}
                <Button variant="ghost" onClick={cancel} disabled={!running} className="w-full sm:w-auto">
                  Стоп
                </Button>
              </div>
            </div>
          </div>
        </form>
        <p className="mt-3 text-xs leading-relaxed text-dim">
          Соцсети/форумы: Mastodon + Lemmy + Sports.ru. TG требует настроенной MTProto-сессии и по
          умолчанию выключен; прогон ходит в RSS/соцсети + LLM.
        </p>
      </Card>

      {running && (
        <Card>
          <div className="flex items-center gap-2 font-mono text-xs text-dim">
            <span
              className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
              aria-hidden
            />
            Scout работает… (RSS/соцсети/+TG параллельно → оркестратор)
          </div>
        </Card>
      )}

      {error && (
        <section className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">
          {error}
        </section>
      )}

      {agents.length > 0 && (
        <Card label={`Source-агенты (${agents.length})`}>
          <ul className="space-y-1 text-sm">
            {agents.map((a) => (
              <li key={a.agent} className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent">{a.agent}</span>
                <span className="text-dim">тем: {a.count}</span>
                {a.error && <span className="text-xs text-err">ошибка: {a.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ranked.length > 0 && (
        <Card label={`Топ оркестратора (${ranked.length})`}>
          <ol className="space-y-2 text-sm">
            {ranked.map((t, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-dim">[{i}]</span>
                  <span className="text-xs font-mono text-accent">{t.orchestratorScore}</span>
                  <span className="text-xs text-dim">({t.source})</span>
                  <span className="font-medium text-ink">{t.title}</span>
                  {t.url && (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      источник ↗
                    </a>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-dim">{t.orchestratorReason}</p>
                {t.hypeReason && (
                  <p className="text-xs text-dim">
                    накал [{t.hypeScore}]: {t.hypeReason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {!running && ranked.length === 0 && !error && (
        <p className="text-sm text-dim">
          Настройте источники и нажмите «Запустить». Оркестратор вернёт топ тем — без записи поста.
          Запрос можно не набирать: выберите пример выше.
        </p>
      )}
    </div>
  );
}
