// /blog/posts/[id] — детально: контент (editable → PATCH save), delete (confirm),
// publish в Telegram (confirm — реальная отправка в канал). День 28, web P4a.
// 'use client': useParams для id. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface PostData {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;
  created_at: string;
}

export default function BlogPostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';

  const [post, setPost] = useState<PostData | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/blog/posts/${id}`, { method: 'GET' });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { post: PostData };
      setPost(data.post);
      setDraft(data.post.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!post || saving) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const resp = await fetch(`/api/blog/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { post: PostData };
      setPost(data.post);
      setDraft(data.post.content);
      setInfo('Сохранено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [post, saving, draft, id]);

  const del = useCallback(async () => {
    if (!post) return;
    if (!window.confirm(`Удалить пост #${post.id}?`)) return;
    setError(null);
    setInfo(null);
    try {
      const resp = await fetch(`/api/blog/posts/${id}`, { method: 'DELETE' });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      router.push('/blog/posts');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    }
  }, [post, id, router]);

  const publish = useCallback(async () => {
    if (!post) return;
    if (!window.confirm('Опубликовать пост в Telegram-канал? Это реальная отправка.')) return;
    setError(null);
    setInfo(null);
    try {
      const resp = await fetch(`/api/blog/posts/${id}/publish`, { method: 'POST' });
      const j = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string; messageId?: number };
      if (!resp.ok || !j.ok) {
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      setInfo(`Опубликовано в Telegram (message_id=${j.messageId ?? '?'})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'publish failed');
    }
  }, [post, id]);

  const dirty = post !== null && draft !== post.content;

  return (
    <div className="space-y-6">
      <section>
        <Link href="/blog/posts" className="text-xs text-accent hover:underline">
          ← к списку постов
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {post ? `Пост #${post.id}` : loading ? 'Загрузка…' : 'Пост не найден'}
        </h1>
        {post && (
          <p className="mt-1 text-xs text-neutral-400">
            news_id: {post.news_id ?? '—'} · создан: {post.created_at}
            {post.verdict && ` · verdict в JSON (см. ниже)`}
          </p>
        )}
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {info}
        </p>
      )}

      {post && (
        <>
          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <label className="block text-xs uppercase tracking-wide text-neutral-500">Контент</label>
            <textarea
              className="mt-1 w-full resize-y rounded border border-neutral-300 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              rows={10}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                onClick={save}
                disabled={saving || !dirty}
              >
                Сохранить
              </button>
              {dirty && (
                <button
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                  onClick={() => setDraft(post.content)}
                  disabled={saving}
                >
                  Откатить
                </button>
              )}
              <button
                className="ml-auto rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
                onClick={publish}
                title="Реальная отправка в Telegram-канал"
              >
                Опубликовать в Telegram
              </button>
              <button
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 dark:border-red-900 dark:text-red-400"
                onClick={del}
              >
                Удалить
              </button>
            </div>
          </section>

          {post.verdict && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Фактчекинг (verdict JSON)
              </h2>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-950">
                {post.verdict}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}
