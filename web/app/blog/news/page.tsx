// /blog/news — блог-pipeline: форма (блог/hours/top/for/llm) → SSE → пост.
// 'use client': читает SSE-стрим из /api/blog/news (start → done/error). Pipeline не имеет
// onProgress, поэтому прогресс = индикатор «работаю» от старта до done. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SseBlogNewsEvent } from '../../../lib/shared/sse';
import { intFieldError, NUMBER_FIELD_LIMITS } from '../../../lib/shared/forms';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { SectionHead } from '../../components/ui/SectionHead';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { IconPlay } from '../../components/ui/icons';

type Llm = 'local' | 'cloud';

interface BlogOption {
  id: number;
  slug: string;
  name: string;
  profile: string | null;
  hasProfile: boolean;
  sourcesCount: number;
}

interface DonePost {
  id: number;
  content: string;
}
interface TopNewsItem {
  id: number;
  title: string;
  score: number;
  why: string;
}

export default function BlogNewsPage() {
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [blogsError, setBlogsError] = useState(false);
  const [blog, setBlog] = useState<string>('');
  // number-draft (S4): строка до отправки — очистка не «отскакивает», ошибка
  // видна сразу; пустое поле не уходит в body (дефолт сервера). Границы — из
  // newsOptsSchema (NUMBER_FIELD_LIMITS).
  const [hours, setHours] = useState('24');
  const [top, setTop] = useState('5');
  const [forIndex, setForIndex] = useState('0');
  const hoursError = intFieldError(hours, { ...NUMBER_FIELD_LIMITS.hours, label: 'Часов' });
  const topError = intFieldError(top, { ...NUMBER_FIELD_LIMITS.top, label: 'Топ' });
  const forIndexError = intFieldError(forIndex, { ...NUMBER_FIELD_LIMITS.forIndex, label: 'Пост про' });
  const paramsInvalid = hoursError !== null || topError !== null || forIndexError !== null;
  const [llm, setLlm] = useState<Llm>('cloud');

  const [running, setRunning] = useState(false);
  const [post, setPost] = useState<DonePost | null>(null);
  const [topNews, setTopNews] = useState<TopNewsItem[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const activeBlog = blogs.find((b) => b.slug === blog) ?? null;
  const profileMissing = activeBlog !== null && !activeBlog.hasProfile;

  // Селектор блогов: сбой загрузки виден и повторяем — молчаливый catch
  // выдавал сетевую ошибку за «блогов нет» и оставлял форму «угадывать».
  const loadBlogs = useCallback(async () => {
    setBlogsError(false);
    try {
      const r = await fetch('/api/blogs');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { blogs?: BlogOption[] };
      const list = j.blogs ?? [];
      setBlogs(list);
      const fromQuery = new URLSearchParams(window.location.search).get('blog') ?? '';
      if (fromQuery && list.some((b) => b.slug === fromQuery)) {
        setBlog((prev) => prev || fromQuery);
      }
    } catch {
      setBlogs([]);
      setBlogsError(true);
    }
  }, []);

  useEffect(() => {
    void loadBlogs();
  }, [loadBlogs]);

  const reset = (): void => {
    setPost(null);
    setTopNews([]);
    setVerdict(null);
    setError(null);
    setNotice(null);
  };

  const run = useCallback(async () => {
    if (running || paramsInvalid) return;
    reset();
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    const handle = (ev: SseBlogNewsEvent): void => {
      switch (ev.type) {
        case 'stage':
          // step === 'start' — индикатор «работаю» уже включён через running.
          break;
        case 'done':
          setPost(ev.post);
          setTopNews(ev.topNews);
          setVerdict(ev.verdict);
          setNotice(ev.notice ?? null);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    };

    try {
      const resp = await fetch('/api/blog/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm,
          ...(hours !== '' ? { hours: Number(hours) } : {}),
          ...(top !== '' ? { top: Number(top) } : {}),
          ...(forIndex !== '' ? { forIndex: Number(forIndex) } : {}),
          ...(blog ? { blog } : {}),
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
          let ev: SseBlogNewsEvent;
          try {
            ev = JSON.parse(dataLine) as SseBlogNewsEvent;
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
  }, [hours, top, forIndex, llm, blog, paramsInvalid, running]);

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  const createFromNews = useCallback(
    async (newsId: number): Promise<void> => {
      if (running || creatingId !== null) return;
      setCreatingId(newsId);
      setError(null);
      setNotice(null);
      try {
        const resp = await fetch('/api/blog/news/from-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newsId, llm, ...(blog ? { blog } : {}) }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean;
          post?: DonePost;
          verdict?: string | null;
          error?: string;
        };
        if (!resp.ok || !data.ok || !data.post) {
          throw new Error(data.error ?? `HTTP ${resp.status}`);
        }
        setPost(data.post);
        setVerdict(data.verdict ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось создать пост');
      } finally {
        setCreatingId(null);
      }
    },
    [running, creatingId, llm, blog],
  );

  return (
    <div className="space-y-6">
      {/* Описание (RSS → агенты → пост) — дубль /blog/pipeline, не дублируем. */}
      <SectionHead code="blog · news" title="Блог-pipeline" />

      <Card label="Параметры запуска">
        {/* <form> (S4): Enter в любом поле = «Запустить»; параметры — Field
            (label↔контрол), пустой блог — явная опция «— без блога —». */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <Field
                id="news-blog"
                label="Блог"
                className="col-span-2"
                hint={blog === '' ? 'пусто — стандартные источники и голос канала' : undefined}
              >
                <select
                  className={`w-full ${INPUT_CLASS}`}
                  value={blog}
                  onChange={(e) => {
                    setBlog(e.target.value);
                    reset();
                  }}
                  disabled={running}
                >
                  <option value="">— без блога —</option>
                  {blogs.map((b) => (
                    <option key={b.slug} value={b.slug}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="news-hours" label="Часов" hint="1–168" error={hoursError ?? undefined}>
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

              <Field id="news-top" label="Топ" hint="1–50" error={topError ?? undefined}>
                <input
                  className={`w-full ${INPUT_CLASS}`}
                  type="number"
                  min={1}
                  max={50}
                  value={top}
                  onChange={(e) => setTop(e.target.value)}
                  disabled={running}
                />
              </Field>

              <Field id="news-for" label="Пост про" hint="от 0" error={forIndexError ?? undefined}>
                <input
                  className={`w-full ${INPUT_CLASS}`}
                  type="number"
                  min={0}
                  value={forIndex}
                  onChange={(e) => setForIndex(e.target.value)}
                  disabled={running}
                />
              </Field>

              <Field id="news-llm" label="LLM" className="col-span-2 sm:col-span-1">
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

            <div className="flex flex-col flex-wrap gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="primary"
                icon={<IconPlay />}
                loading={running}
                type="submit"
                disabled={running || paramsInvalid || profileMissing || creatingId !== null}
                className="w-full sm:w-auto"
              >
                Запустить
              </Button>
              {/* «Стоп» — регресс-стоп: активна во время стрима, без loading. */}
              <Button variant="ghost" onClick={cancel} disabled={!running} className="w-full sm:w-auto">
                Стоп
              </Button>
              {profileMissing ? (
                <p role="note" className="w-full text-xs text-warn">
                  Сначала настройте профиль голоса блога — генерация недоступна.
                </p>
              ) : null}
            </div>
          </div>
        </form>
        {blogsError ? (
          <p className="mt-2 text-xs text-err">
            Не удалось загрузить блоги —{' '}
            <button
              type="button"
              className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
              onClick={() => void loadBlogs()}
            >
              обновить блоги
            </button>
          </p>
        ) : blogs.length === 0 ? (
          <p className="mt-2 text-xs text-dim">
            Настроенных блогов нет — прогон пойдёт без выбранного блога: стандартные
            источники и голос канала. Создайте блог в{' '}
            <Link href="/blog/settings" className="text-accent hover:underline">студии</Link>,
            чтобы писать своим тоном.
          </p>
        ) : null}
        {activeBlog && (
          <p className="mt-2 text-xs text-dim">
            Источников в блоге: {activeBlog.sourcesCount || 'нет'}.{' '}
            {profileMissing
              ? 'Профиль голоса не настроен — генерация недоступна (см. /chat, /profile).'
              : `Голос: профиль «${activeBlog.profile}».`}
          </p>
        )}
        <p className="mt-2 text-xs text-dim">
          Прогон настоящий: читает RSS и генерирует через LLM, может занять до минуты.
          Черновик появится здесь и в „Постах“.
        </p>
        <p className="mt-1 text-xs text-dim">
          Нужен поиск по соцсетям и форумам с примерами запросов (АПЛ, Челси, статистика) —{' '}
          <Link href="/blog/scout" className="text-accent hover:underline">откройте Scout</Link>.
        </p>
      </Card>

      {running && (
        <Card>
          <div className="flex items-center gap-2 font-mono text-xs text-dim">
            <span
              className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
              aria-hidden
            />
            Pipeline работает… (RSS → 3 агента → пост)
          </div>
        </Card>
      )}

      {error && (
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      {notice && !error && (
        <Card tone="warn">
          <p className="text-sm text-warn">{notice}</p>
        </Card>
      )}

      {post && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-dim">
              Пост #{post.id}
            </span>
            <Link href={`/blog/posts/${post.id}`} className="text-xs text-accent hover:underline">
              открыть и править →
            </Link>
          </div>
          {verdict && (
            <p className="text-xs text-dim">вердикт фактчекинга: {verdict}</p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{post.content}</p>
        </Card>
      )}

      {topNews.length > 0 && (
        <Card label={`Топ-новости (${topNews.length})`}>
          <p className="mb-2 text-xs text-dim">
            Нажмите на новость — напишу отдельный пост по ней. Потом его можно открыть и править.
          </p>
          <ul className="space-y-1.5 text-sm">
            {topNews.map((n, i) => {
              const busy = creatingId === n.id;
              const disabled = running || creatingId !== null;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void createFromNews(n.id)}
                    disabled={disabled}
                    aria-label={`Создать пост по новости: ${n.title}`}
                    className="group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors duration-fast hover:border-line-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-dim">[{i}]</span>{' '}
                      <span className="text-xs text-accent">{n.score}</span>{' '}
                      <span className="text-ink">{n.title}</span>
                      <span className="block text-xs text-dim">{n.why}</span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:opacity-100">
                      {busy ? 'пишу…' : 'создать пост →'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!running && !post && !error && topNews.length === 0 && (
        <EmptyState
          title="Пока пусто"
          hint={
            <>
              Настройте параметры и нажмите «Запустить». Пост появится здесь и в{' '}
              <Link href="/blog/posts" className="text-accent hover:underline">/blog/posts</Link>.
            </>
          }
        />
      )}
    </div>
  );
}
