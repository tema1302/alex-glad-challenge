// /blog/posts/[id] — детально: контент (editable → PATCH save), delete (confirm),
// publish в Telegram (confirm — реальная отправка в канал). День 28, web P4a.
// Редизайн C (день 30): Card-формы + verdict-pre. Логика fetch/confirm без изменений.
// 'use client': useParams для id. НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { SectionLabel } from '../../../components/ui/SectionLabel';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';

interface PostData {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;
  created_at: string;
}

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50';

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
    <div className="space-y-8">
      <section>
        <SectionLabel>posts · detail</SectionLabel>
        <Link href="/blog/posts" className="text-xs text-accent hover:underline">
          ← к списку постов
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-semibold uppercase tracking-tight text-ink">
          {post ? `Пост #${post.id}` : loading ? 'Загрузка…' : 'Пост не найден'}
        </h1>
        {post && (
          <p className="mt-2 font-mono text-xs text-dim">
            news_id: {post.news_id ?? '—'} · {post.created_at}
            {post.verdict ? ' · verdict в JSON (см. ниже)' : ''}
          </p>
        )}
      </section>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}
      {info && (
        <p className="rounded-md border border-ok/40 bg-ok/10 p-2 text-sm text-ok">{info}</p>
      )}

      {post && (
        <>
          <Card>
            <label className="block font-mono text-xs uppercase tracking-wider text-dim">Контент</label>
            <textarea
              className={`mt-1 w-full resize-y ${INPUT}`}
              rows={10}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={save} disabled={saving || !dirty}>
                Сохранить
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setDraft(post.content)} disabled={saving}>
                  Откатить
                </Button>
              )}
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={publish}
                title="Реальная отправка в Telegram-канал"
              >
                Опубликовать в Telegram
              </Button>
              <Button variant="danger" onClick={del}>
                Удалить
              </Button>
            </div>
          </Card>

          {post.verdict && (
            <Card label="verdict">
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-2 font-mono text-xs text-dim">
                {post.verdict}
              </pre>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
