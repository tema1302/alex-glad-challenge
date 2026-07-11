// /blog/posts — список постов (день 28, web P4a).
// 'use client': GET /api/blog/posts → список (id, snippet, newsId, verdict, created_at).
// Редизайн C (день 30): data-list table hairline + SectionLabel. Логика fetch без изменений.
// Тип PostItem инлайн (сервер отдаёт тот же JSON). НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Button } from '../../components/ui/Button';

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
    if (verdict === 'ok') return { text: 'ok', cls: 'bg-ok/15 text-ok' };
    if (verdict === 'revise') return { text: 'revise', cls: 'bg-warn/15 text-warn' };
    if (verdict === 'reject') return { text: 'reject', cls: 'bg-err/15 text-err' };
    return { text: verdict ?? '?', cls: 'bg-surface-2 text-dim' };
  } catch {
    return { text: '?', cls: 'bg-surface-2 text-dim' };
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
    <div className="space-y-8">
      <section>
        <SectionLabel>posts · blog.sqlite</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Посты блога</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Сохранённые посты из{' '}
          <code className="font-mono text-[12px] text-ink">blog.sqlite</code>. Откройте пост для правки,
          удаления или публикации в Telegram.
        </p>
      </section>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-3 text-sm text-err">{error}</p>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>{`посты · ${posts.length}`}</SectionLabel>
          <Button variant="ghost" onClick={load} disabled={loading}>
            {loading ? 'загрузка…' : 'обновить'}
          </Button>
        </div>

        {posts.length === 0 ? (
          <p className="text-sm text-dim">{loading ? 'Загрузка…' : 'Нет постов. Запустите /blog/news.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">#</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">verdict</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">content</th>
                  <th className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-dim">created</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const v = verdictLabel(p.verdict);
                  return (
                    <tr key={p.id} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
                      <td className="px-3 py-2 font-mono text-xs text-dim">
                        <Link href={`/blog/posts/${p.id}`} className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">#{p.id}</Link>
                      </td>
                      <td className="px-3 py-2">
                        {v ? (
                          <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${v.cls}`}>{v.text}</span>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink">{snippet(p.content)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-dim">{p.created_at}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
