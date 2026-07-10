// /blog/posts — список постов (день 28, web P4a).
// 'use client': GET /api/blog/posts → список (id, snippet, newsId, verdict, created_at).
// Тип PostItem инлайн (сервер отдаёт тот же JSON). НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface PostItem {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;
  created_at: string;
}

function snippet(s: string, n = 140): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function verdictLabel(v: string | null): { text: string; cls: string } | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v) as { verdict?: string };
    const verdict = parsed.verdict;
    if (verdict === 'ok') return { text: 'ok', cls: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' };
    if (verdict === 'revise') return { text: 'revise', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' };
    if (verdict === 'reject') return { text: 'reject', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' };
    return { text: verdict ?? '?', cls: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' };
  } catch {
    return { text: '?', cls: 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' };
  }
}

export default function BlogPostsPage() {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/blog/posts?limit=50', { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { posts: PostItem[] };
      setPosts(data.posts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Посты блога</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Сохранённые посты из{' '}
          <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">blog.sqlite</code>.
          Откройте пост для правки, удаления или публикации в Telegram.
        </p>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Посты ({posts.length})
          </h2>
          <button className="text-xs text-accent hover:underline" onClick={load} disabled={loading}>
            обновить
          </button>
        </div>

        {posts.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            {loading ? 'Загрузка…' : 'Нет постов. Запустите /blog/news.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {posts.map((p) => {
              const v = verdictLabel(p.verdict);
              return (
                <li key={p.id}>
                  <Link
                    href={`/blog/posts/${p.id}`}
                    className="block rounded-lg border border-neutral-200 bg-white p-3 text-sm hover:border-accent dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-neutral-400">#{p.id}</span>
                      {v && (
                        <span className={`rounded px-1.5 py-0.5 text-xs ${v.cls}`}>{v.text}</span>
                      )}
                      <span className="ml-auto text-xs text-neutral-400">{p.created_at}</span>
                    </div>
                    <div className="mt-1 text-neutral-700 dark:text-neutral-300">{snippet(p.content)}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
