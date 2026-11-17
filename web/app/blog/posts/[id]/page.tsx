// /blog/posts/[id] — детально (ТЗ §7.3/§8.5): toolbar (Сохранить / Опубликовать в
// Telegram / Удалить), статус публикации из outbox (badge + message_id + время),
// textarea со счётчиком 4096. Реальные внешние действия — через ConfirmDialog
// с указанием target (замена window.confirm, D1). 'use client': useParams для id.
// НИКАКИХ импортов core/.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { SectionHead } from '../../../components/ui/SectionHead';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { BackButton } from '../../../components/ui/BackButton';
import { useSpaHistory } from '../../../components/ui/useSpaHistory';
import { Field } from '../../../components/ui/Field';
import { Textarea } from '../../../components/ui/Textarea';
import { Badge, statusBadge } from '../../../components/ui/Badge';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { IconSend, IconTrash } from '../../../components/ui/icons';
import { tgVisibleText } from '../../../../lib/shared/tg-html';
import {
  clearInAppMark,
  clearListSnapshot,
  hasInAppHistory,
} from '../../../../lib/shared/spaHistory';

interface PostData {
  id: number;
  news_id: number | null;
  content: string;
  verdict: string | null;
  created_at: string;
}

interface BlogInfo {
  id: number;
  slug: string;
  name: string;
  tgChatId: string | null;
}

interface TgStatus {
  status: 'ok' | 'error';
  messageId: number | null;
  createdAt: string;
  error: string | null;
}

export default function BlogPostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';

  // S2 «Back&scroll»: отметка SPA-истории + флаг возврата (детальная гасит его).
  useSpaHistory(pathname);

  const [post, setPost] = useState<PostData | null>(null);
  const [blog, setBlog] = useState<BlogInfo | null>(null);
  const [tg, setTg] = useState<TgStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [channelLabel, setChannelLabel] = useState<string | null>(null);

  // Актуальный «dirty» для асинхронных колбэков: замыкание load() могло бы
  // захватить устаревший post=null (StrictMode double-effect) и затереть правку.
  const dirtyRef = useRef(false);

  // S2 «Back&scroll»: fallback для прямого захода/deep link — контекст ?blog=
  // из загруженного поста (slug известен после load; кнопка и del рендерятся
  // с актуальным адресом на момент клика). Slug экранируем — симметрия с
  // fetch-путём фильтра списка.
  const fallbackHref = blog
    ? `/blog/posts?blog=${encodeURIComponent(blog.slug)}`
    : '/blog/posts';

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch(`/api/blog/posts/${id}`, { method: 'GET' });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { post: PostData; blog: BlogInfo | null; tg: TgStatus | null };
      setPost(data.post);
      setBlog(data.blog ?? null);
      setTg(data.tg);
      // Повторная/поздняя загрузка (StrictMode, refresh после publish) не должна
      // затирать несохранённые правки черновика.
      if (!dirtyRef.current) setDraft(data.post.content);
    } catch (e) {
      // Сетевой сбой — НЕ «пост не найден»: честная ошибка с retry (404-маска
      // отправляла владельца удалять/пересоздавать существующий пост).
      setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить пост');
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // deps [id]: перезагрузка поста не должна пере-запускаться на каждую перерисовку
  // (иначе несохранённый черновик затирается — e2e это поймал).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Маска канала для confirm-диалога — из settings-API (server → public-мета).
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((j: { botChannelLabel?: string | null }) => setChannelLabel(j.botChannelLabel ?? null))
      .catch(() => setChannelLabel(null));
  }, []);

  // Актуальный dirty для колбэков ниже (save/publish читают его в deps) и для
  // асинхронных load()-замыканий: поздняя загрузка не должна затирать правки.
  const dirty = post !== null && draft !== post.content;
  dirtyRef.current = dirty;

  // PATCH черновика без guard'ов — общий путь кнопки «Сохранить» и публикации:
  // publish при несохранённых правках сначала сохраняет текст, чтобы в канал
  // ушло ровно то, что показано в превью диалога.
  const saveInternal = useCallback(async () => {
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
    toast('ok', 'Пост сохранён');
  }, [draft, id, toast]);

  const save = useCallback(async () => {
    if (!post || saving || !dirty) return;
    setSaving(true);
    try {
      await saveInternal();
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }, [post, saving, dirty, saveInternal, toast]);

  const publish = useCallback(async () => {
    // Publish-целостность: POST /publish уходит с СОХРАНЁННОЙ версией поста,
    // а превью диалога показывает текущий draft. При dirty сначала сохраняем —
    // подтверждение и отправка совпадают слово в слово.
    if (dirty) {
      try {
        await saveInternal();
      } catch (e) {
        toast('err', e instanceof Error ? e.message : 'Не удалось сохранить черновик перед публикацией');
        throw e;
      }
    }
    try {
      const resp = await fetch(`/api/blog/posts/${id}/publish`, { method: 'POST' });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        messageId?: number;
      };
      if (!resp.ok || !j.ok) throw new Error(j.error ?? `HTTP ${resp.status}`);
      toast('ok', `Опубликовано в Telegram (message_id=${j.messageId ?? '?'})`);
      // Список показывает TG-статус: снапшот устарел (draft → published).
      clearListSnapshot('/blog/posts');
      void load();
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Ошибка публикации');
      throw e;
    }
  }, [dirty, saveInternal, id, toast, load]);

  const del = useCallback(async () => {
    try {
      const resp = await fetch(`/api/blog/posts/${id}`, { method: 'DELETE' });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      toast('ok', `Пост #${id} удалён`);
      // Снапшот списка больше не валиден (пост удалён) — возврат должен рефетчить.
      clearListSnapshot('/blog/posts');
      // Тот же семантический helper, что BackButton: in-app возврат без нового
      // entry, прямой заход — честный push с контекстом блога.
      if (hasInAppHistory()) {
        router.back();
      } else {
        clearInAppMark();
        router.push(fallbackHref);
      }
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось удалить');
      throw e;
    }
  }, [id, router, toast, fallbackHref]);

  const overLimit = draft.length > 4096;

  // Канал подтверждения: карточка блога → маска из settings-API → ни того, ни
  // другого нет — честный dim-бейдж вместо имени env-переменной.
  const publishChannel = blog?.tgChatId ?? channelLabel;

  return (
    <div className="space-y-6">
      <SectionHead
        code={`posts · #${id}`}
        title={post ? `Пост #${post.id}` : loading ? 'Загрузка…' : loadError ? 'Ошибка загрузки' : 'Не найден'}
        description={
          post ? (
            <span className="font-mono text-xs">
              {blog ? `${blog.name} · ` : ''}news_id: {post.news_id ?? '—'} · {post.created_at}
            </span>
          ) : undefined
        }
        actions={
          <BackButton fallbackHref={fallbackHref} />
        }
      />

      {loading && !post ? (
        <div className="space-y-3">
          <Skeleton variant="line" />
          <Skeleton />
        </div>
      ) : post ? (
        <>
          {/* Статус публикации (join outbox, ТЗ §7.3) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-dim">telegram:</span>
            {tg ? (
              <>
                {statusBadge(tg.status === 'ok' ? 'published' : 'error')}
                {tg.messageId !== null && (
                  <span className="font-mono text-xs tabular-nums text-dim">msg {tg.messageId}</span>
                )}
                <span className="font-mono text-xs tabular-nums text-dim">{tg.createdAt}</span>
                {tg.status === 'ok' ? <Badge tone="dim">повторная отправка создаст новую запись</Badge> : null}
              </>
            ) : (
              statusBadge('draft')
            )}
            {tg?.error && <span className="text-xs text-err">{tg.error}</span>}
          </div>

          <Card label="контент">
            <Field
              id="post-content"
              label="Текст поста"
              hint="Публикация в TG — до 4096 символов; сохранение в блоге допускает до 8000."
              error={overLimit ? 'Для публикации в Telegram текст длиннее 4096 символов' : undefined}
            >
              <Textarea
                value={draft}
                onValueChange={setDraft}
                max={4096}
                warnAt={3800}
                rows={12}
                inputRef={undefined}
                disabled={saving}
              />
            </Field>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={save} disabled={saving || !dirty}>
                Сохранить
              </Button>
              <Button
                variant="primary"
                icon={<IconSend />}
                onClick={() => setPublishOpen(true)}
                disabled={!draft.trim() || overLimit}
              >
                Опубликовать в Telegram
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDraft(post.content)}
                disabled={saving || !dirty}
              >
                Отменить правки
              </Button>
              <Button variant="danger" icon={<IconTrash />} className="ml-auto" onClick={() => setDeleteOpen(true)}>
                Удалить
              </Button>
            </div>
          </Card>

          {post.verdict && (
            <Card label="verdict">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-2 font-mono text-xs text-dim">
                {post.verdict}
              </pre>
            </Card>
          )}
        </>
      ) : loadError ? (
        <Card tone="danger" label="ошибка загрузки">
          <p className="text-sm text-err">{loadError}</p>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-dim">Пост не найден.</p>
      )}

      <ConfirmDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={publish}
        title="Опубликовать в Telegram?"
        confirmLabel="Опубликовать"
        body={
          <div className="space-y-3">
            <p className="flex items-center gap-2">
              Канал:{' '}
              {publishChannel ? (
                <Badge tone="accent">{publishChannel}</Badge>
              ) : (
                <Badge tone="dim">канал по умолчанию · не настроен</Badge>
              )}
              {blog && <span className="text-xs text-dim">(блог «{blog.name}»)</span>}
            </p>
            <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              Реальная отправка — сообщение уйдёт подписчикам канала.
            </p>
            {dirty ? (
              <p className="text-xs text-warn">
                Есть несохранённые правки: перед отправкой черновик будет сохранён —
                в канал уйдёт отредактированный текст (превью выше).
              </p>
            ) : (
              <p className="text-xs text-dim">Уйдёт последняя сохранённая версия.</p>
            )}
            <pre className="max-h-32 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-line bg-bg p-2 font-mono text-xs leading-relaxed text-dim">
              {tgVisibleText(draft).split('\n').slice(0, 6).join('\n')}
              {tgVisibleText(draft).split('\n').length > 6 ? '\n…' : ''}
            </pre>
          </div>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={del}
        title={`Удалить пост #${id}?`}
        confirmLabel="Удалить безвозвратно"
        tone="danger"
        body={<p>Пост будет удалён вместе с содержимым. Действие безвозвратно.</p>}
      />
    </div>
  );
}
