'use client';

// FullPipelineRun — «Полный конвейер» на /blog/pipeline (feat: блог-pipeline одним
// прогоном). Клиентский чейнінг существующих SSE-endpoint'ов, без новых роутов:
//   фаза 1: POST /api/blog/scout (source-агенты параллельно → оркестратор)
//   фаза 2: POST /api/blog/news (сбор новостей → агент-автор → фактчекер)
//   фаза 3: локальный результат песочницы «ready to publish» (реальная отправка в TG
//           полным прогоном не вызывается никогда — только страница поста).
// Оба роута отдают только start → done/error (onProgress внутри агентов нет), поэтому
// шаги внутри фазы резолвятся одним событием done — подписи стадий из shared/explainer.
// Без импортов core/ и server-only (client component); секреты не нужны.
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  SseBlogNewsDone,
  SseBlogNewsError,
  SseBlogNewsEvent,
  SseBlogScoutDone,
  SseBlogScoutError,
  SseBlogScoutEvent,
} from '../../../lib/shared/sse';
import { PIPELINE_STAGE_EXPLAINER } from '../../../lib/shared/pipeline-explainer';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

/** Фиксированные параметры прогона — пороги как в дефолтах CLI; формы scout/news не дублируем. */
const RUN_DEFAULTS = {
  hours: 24,
  scoutTopK: 3,
  newsTop: 5,
  enableForum: true,
  // MTProto (TG_SESSION) credential-тяжёлый путь — выкл по умолчанию, как в /blog/scout.
  enableTelegram: false,
};

const RUN_INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

type RunPhase = 'idle' | 'scout' | 'news' | 'done';
type Llm = 'local' | 'cloud';

/** Разбор SSE-потока (`data:`-строки; контракт shared/sse). Тот же цикл, что в /blog/scout и /blog/news. */
async function readSseStream<T>(resp: Response, onEvent: (ev: T) => void): Promise<void> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error(`HTTP ${resp.status}: пустой поток`);
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
      let ev: T;
      try {
        ev = JSON.parse(dataLine) as T;
      } catch {
        continue;
      }
      onEvent(ev);
    }
  }
}

/** POST-SSE с JSON-body: не-2xx → throw (текст ответа обрезан; это тело роута, без секретов). */
async function postSse<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (ev: T) => void,
): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  await readSseStream(resp, onEvent);
}

/** Полный конвейер: одна кнопка — разведка (scout SSE) → новостной конвейер (news SSE) → финал. */
export function FullPipelineRun({ sandbox }: { sandbox: boolean }) {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState('');
  const [llm, setLlm] = useState<Llm>('cloud');
  const [scout, setScout] = useState<SseBlogScoutDone | null>(null);
  const [news, setNews] = useState<SseBlogNewsDone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setScout(null);
    setNews(null);
    setError(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // Фаза 1 — scout: source-агенты параллельно → оркестратор (start → done/error).
      setPhase('scout');
      const scoutEvents: SseBlogScoutEvent[] = [];
      await postSse<SseBlogScoutEvent>(
        '/api/blog/scout',
        {
          hours: RUN_DEFAULTS.hours,
          topK: RUN_DEFAULTS.scoutTopK,
          query: query.trim() || undefined,
          enableForum: RUN_DEFAULTS.enableForum,
          enableTelegram: RUN_DEFAULTS.enableTelegram,
          llm,
        },
        ac.signal,
        (ev) => {
          scoutEvents.push(ev);
        },
      );
      const scErr = scoutEvents.find((e): e is SseBlogScoutError => e.type === 'error');
      if (scErr) throw new Error(scErr.message);
      const scDone = scoutEvents.find((e): e is SseBlogScoutDone => e.type === 'done');
      if (!scDone) throw new Error('scout: фаза завершилась без результата');
      setScout(scDone);

      // Фаза 2 — news: сбор+ранжирование → агент-автор → фактчекер.
      // Тема из фазы 1 сюда НЕ передаётся: newsOptsSchema её не принимает (shared/forms),
      // поэтому news сам ранжирует свежие RSS и пишет про самый хайповый пункт (forIndex=0).
      setPhase('news');
      const newsEvents: SseBlogNewsEvent[] = [];
      await postSse<SseBlogNewsEvent>(
        '/api/blog/news',
        {
          hours: RUN_DEFAULTS.hours,
          top: RUN_DEFAULTS.newsTop,
          forIndex: 0,
          llm,
        },
        ac.signal,
        (ev) => {
          newsEvents.push(ev);
        },
      );
      const nErr = newsEvents.find((f): f is SseBlogNewsError => f.type === 'error');
      if (nErr) throw new Error(nErr.message);
      const nDone = newsEvents.find((f): f is SseBlogNewsDone => f.type === 'done');
      if (!nDone) throw new Error('news: фаза завершилась без результата');
      setNews(nDone);

      setPhase('done');
    } catch (e) {
      // Ошибка фазы или остановка пользователем: чейнінг прерывается, следующая фаза не
      // стартует. Результаты завершённых фаз остаются видимыми как факт прогона.
      if (e instanceof DOMException && e.name === 'AbortError') setError('Отменено');
      else setError(e instanceof Error ? e.message : 'конвейер упал');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [query, llm]);

  const stop = (): void => {
    abortRef.current?.abort();
  };

  return (
    <>
      <Card label="Полный конвейер — один прогон">
        <p className="text-sm text-dim">
          Одна кнопка проходит конвейер агент за агентом: разведка источников (RSS · Forum) →
          LLM-оркестратор → сбор новостей → агент-автор → агент-фактчекер → финальный пост.
          Реальная отправка в Telegram не выполняется.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex-1 min-w-[220px] text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">
              Запрос для разведки
            </span>
            <input
              className={`mt-1 w-full ${RUN_INPUT}`}
              type="text"
              placeholder="самые горячие футбольные новости"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={running}
            />
            <span className="mt-1 block text-xs text-dim">
              часов: {RUN_DEFAULTS.hours} · топ разведки: {RUN_DEFAULTS.scoutTopK} · топ новостей:{' '}
              {RUN_DEFAULTS.newsTop}
            </span>
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-dim">LLM</span>
            <select
              className={`mt-1 ${RUN_INPUT}`}
              value={llm}
              onChange={(e) => setLlm(e.target.value as Llm)}
              disabled={running}
            >
              <option value="cloud">cloud</option>
              <option value="local">local (Ollama)</option>
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <Button variant="primary" onClick={run} disabled={running}>
              Запустить весь конвейер
            </Button>
            <Button variant="ghost" onClick={stop} disabled={!running}>
              Стоп
            </Button>
          </div>
        </div>
      </Card>

      {(phase !== 'idle' || error) && (
        <Card label="Прогон по фазам">
          <ol className="space-y-3">
            {/* Фаза 1 — scout */}
            <li className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span
                className={[
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                  running && phase === 'scout'
                    ? 'bg-accent text-accent-ink'
                    : scout
                      ? 'border border-line-strong text-dim'
                      : 'border border-line text-dim opacity-60',
                ].join(' ')}
                aria-hidden
              >
                1
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong className="text-ink">Разведка источников + оркестратор</strong>
                  {running && phase === 'scout' && (
                    <span className="flex items-center gap-1 font-mono text-xs text-dim">
                      <span
                        className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
                        aria-hidden
                      />
                      работает…
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-dim">
                  {PIPELINE_STAGE_EXPLAINER.planning.what}
                </p>
              </div>
              {scout && (
                <ul className="w-full space-y-1 pl-7 text-sm">
                  {scout.agents.map((a) => (
                    <li key={a.agent} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-accent">{a.agent}</span>
                      <span className="text-dim">тем: {a.count}</span>
                      {a.error && <span className="text-xs text-err">ошибка: {a.error}</span>}
                    </li>
                  ))}
                  <li className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-accent">оркестратор</span>
                    <span className="text-dim">топ тем: {scout.ranked.length}</span>
                    {scout.ranked[0] && (
                      <span className="truncate text-xs text-dim">{scout.ranked[0].title}</span>
                    )}
                  </li>
                </ul>
              )}
            </li>

            {/* Фаза 2 — news */}
            <li className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span
                className={[
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                  running && phase === 'news'
                    ? 'bg-accent text-accent-ink'
                    : news
                      ? 'border border-line-strong text-dim'
                      : 'border border-line text-dim opacity-60',
                ].join(' ')}
                aria-hidden
              >
                2
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong className="text-ink">Новостной конвейер (fetch → write → factcheck)</strong>
                  {running && phase === 'news' && (
                    <span className="flex items-center gap-1 font-mono text-xs text-dim">
                      <span
                        className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
                        aria-hidden
                      />
                      работает… (промежуточных событий API не отдаёт)
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-dim">
                  {PIPELINE_STAGE_EXPLAINER.execution.what}{' '}
                  {PIPELINE_STAGE_EXPLAINER.validation.what}
                </p>
              </div>
            </li>

            {/* Фаза 3 — финал */}
            <li className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span
                className={[
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                  phase === 'done'
                    ? 'bg-accent text-accent-ink'
                    : 'border border-line text-dim opacity-60',
                ].join(' ')}
                aria-hidden
              >
                3
              </span>
              <div className="min-w-[200px] flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-ink">Финал / публикация</strong>
                  {phase === 'done' && (
                    <span className="font-mono text-xs text-accent">готово</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-dim">
                  {PIPELINE_STAGE_EXPLAINER.done.outputExample}
                </p>
              </div>
              {news && (
                <ul className="w-full space-y-2 pl-7 text-sm">
                  {news.post ? (
                    <li>
                      <span className="font-mono text-xs uppercase tracking-wider text-dim">
                        Пост #{news.post.id}
                      </span>{' '}
                      <Link
                        href={`/blog/posts/${news.post.id}`}
                        className="text-xs text-accent hover:underline"
                      >
                        открыть →
                      </Link>
                      {news.verdict && (
                        <p className="mt-1 text-xs text-dim">
                          вердикт фактчекинга: {news.verdict}
                        </p>
                      )}
                      <p className="mt-2 whitespace-pre-wrap text-ink">{news.post.content}</p>
                    </li>
                  ) : (
                    <li className="text-xs text-warn">
                      Пост не создан: свежих новостей не нашлось.
                    </li>
                  )}
                  <li className="rounded-md border border-line bg-surface-2 p-2 text-xs text-dim">
                    {sandbox
                      ? 'Состояние «ready to publish»: черновик сохранён в blog.sqlite, отправка в канал здесь не выполняется.'
                      : 'Состояние «ready to publish»: публикация отдельно через страницу поста.'}
                  </li>
                </ul>
              )}
            </li>
          </ol>
          {error && (
            <p className="mt-3 rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
              {error}
            </p>
          )}
        </Card>
      )}
    </>
  );
}