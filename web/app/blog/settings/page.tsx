// /blog/settings — хаб всех блогов: сводка, карточки, создание и архивация.
// 'use client': GET /api/blogs?includeArchived=1, POST /api/blogs,
// PATCH /api/blogs/[slug] {status}. Детальная настройка — /blog/settings/[slug].
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dialog } from '../../components/ui/Dialog';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { SectionHead } from '../../components/ui/SectionHead';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';
import { BlogCheatSheet } from './BlogCheatSheet';

interface BlogCounts {
  posts: number;
  news: number;
  styleSamples: number;
  postsLast7Days: number;
  lastPostAt: string | null;
}

interface BlogSummary {
  id: number;
  slug: string;
  name: string;
  profile: string | null;
  hasProfile: boolean;
  tgChatId: string | null;
  tgChatIdSet: boolean;
  stylePreset: string;
  sources: string[];
  sourcesCount: number;
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  counts: BlogCounts;
  lastPostAt: string | null;
  agentPromptsCount: number;
  readyForNews: boolean;
}

interface BlogsResponse {
  blogs?: BlogSummary[];
  profiles?: string[];
  error?: string;
}

const SLUG_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((ch) => SLUG_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ blog }: { blog: BlogSummary }) {
  if (blog.status === 'archived') return <Badge tone="dim">архив</Badge>;
  if (!blog.readyForNews) return <Badge tone="warn">нужна настройка</Badge>;
  return <Badge tone="ok">готов</Badge>;
}

function Readiness({ blog }: { blog: BlogSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={blog.hasProfile ? 'ok' : 'err'}>
        {blog.hasProfile ? 'профиль' : 'нет профиля'}
      </Badge>
      <Badge tone={blog.sourcesCount > 0 ? 'ok' : 'err'}>
        RSS {blog.sourcesCount}
      </Badge>
      <Badge tone={blog.tgChatIdSet ? 'ok' : 'dim'}>
        {blog.tgChatIdSet ? 'TG свой' : 'TG общий'}
      </Badge>
      <Badge tone={blog.agentPromptsCount > 0 ? 'accent' : 'dim'}>
        промпты {blog.agentPromptsCount}/8
      </Badge>
    </div>
  );
}

export default function BlogHubPage() {
  const { toast } = useToast();
  const [blogs, setBlogs] = useState<BlogSummary[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<BlogSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [profile, setProfile] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [stylePreset, setStylePreset] = useState<'default' | 'antonov'>('default');
  const [sourcesText, setSourcesText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/blogs?includeArchived=1', { cache: 'no-store' });
      const data = (await resp.json().catch(() => ({}))) as BlogsResponse;
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setBlogs(data.blogs ?? []);
      setProfiles(data.profiles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить блоги');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => blogs.filter((b) => includeArchived || b.status === 'active'),
    [blogs, includeArchived],
  );
  const summary = useMemo(() => {
    const active = blogs.filter((b) => b.status === 'active');
    return {
      total: active.length,
      ready: active.filter((b) => b.readyForNews).length,
      attention: active.filter((b) => !b.readyForNews).length,
      customPrompts: active.reduce((sum, b) => sum + b.agentPromptsCount, 0),
      postsWeek: active.reduce((sum, b) => sum + b.counts.postsLast7Days, 0),
    };
  }, [blogs]);

  const openCreate = (): void => {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setProfile('');
    setTgChatId('');
    setStylePreset('default');
    setSourcesText('');
    setFormError(null);
    setCreateOpen(true);
  };

  const create = async (): Promise<void> => {
    if (busy) return;
    const cleanName = name.trim();
    const cleanSlug = slug.trim();
    if (!cleanName) {
      setFormError('Название обязательно');
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug) || cleanSlug.length < 2) {
      setFormError('Slug: латиница, цифры и дефис, минимум 2 символа');
      return;
    }
    const sources = sourcesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (sources.length > 20) {
      setFormError('Источников — не больше 20');
      return;
    }
    if (sources.some((s) => !/^https?:\/\//.test(s))) {
      setFormError('Каждый источник — ссылка http(s)');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const resp = await fetch('/api/blogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          slug: cleanSlug,
          ...(profile ? { profile } : {}),
          ...(tgChatId.trim() ? { tgChatId: tgChatId.trim() } : {}),
          stylePreset,
          ...(sources.length > 0 ? { sources } : {}),
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setCreateOpen(false);
      toast('ok', 'Блог создан — настройте профиль, RSS и промпты');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось создать блог');
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (): Promise<void> => {
    if (!archiveTarget || busy) return;
    const target = archiveTarget;
    setBusy(true);
    try {
      const next = target.status === 'archived' ? 'active' : 'archived';
      const resp = await fetch(`/api/blogs/${encodeURIComponent(target.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      toast('ok', next === 'archived' ? 'Блог в архиве' : 'Блог возвращён');
      setArchiveTarget(null);
      await load();
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось изменить статус');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHead
        code="blog · studio"
        title="Управление блогами"
        description="Все блоги, их готовность и промпты — в одном месте. Создайте блог, настройте голос и RSS, затем правьте промпты агентов."
        actions={
          <>
            <label className="flex min-h-[36px] items-center gap-2 text-xs text-dim">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="accent-accent"
              />
              показывать архив
            </label>
            <Button variant="primary" onClick={openCreate}>
              Новый блог
            </Button>
          </>
        }
      />

      <section aria-label="Сводка по блогам" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'активных', value: summary.total },
          { label: 'готовы к news', value: summary.ready },
          { label: 'требуют настройки', value: summary.attention },
          { label: 'постов за неделю', value: summary.postsWeek },
          { label: 'кастомных промптов', value: summary.customPrompts },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-line bg-surface p-3 shadow-panel">
            <div className="font-mono text-2xl font-semibold tabular-nums text-ink">{item.value}</div>
            <div className="mt-1 text-xs text-dim">{item.label}</div>
          </div>
        ))}
      </section>

      {loading ? (
        <Card label="загрузка">
          <p className="text-sm text-dim">Загружаю блоги…</p>
        </Card>
      ) : error ? (
        <Card label="ошибка" tone="danger">
          <p className="text-sm text-err">{error}</p>
          <Button className="mt-3" onClick={() => void load()}>
            Повторить
          </Button>
        </Card>
      ) : visible.length === 0 ? (
        <Card label="пусто">
          <p className="text-sm text-dim">
            {includeArchived ? 'Блогов пока нет.' : 'Активных блогов нет — создайте первый или покажите архив.'}
          </p>
          <Button variant="primary" className="mt-3" onClick={openCreate}>
            Создать блог
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((blog) => (
            <Card
              key={blog.id}
              label={`${blog.name} · ${blog.slug}`}
              actions={<StatusBadge blog={blog} />}
              className={blog.status === 'archived' ? 'opacity-80' : ''}
            >
              <div className="space-y-3">
                <Readiness blog={blog} />
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: 'посты', value: blog.counts.posts },
                    { label: 'новости', value: blog.counts.news },
                    { label: 'стиль', value: blog.counts.styleSamples },
                    { label: 'за 7д', value: blog.counts.postsLast7Days },
                  ].map((s) => (
                    <div key={s.label} className="rounded-md border border-line bg-surface-2 p-2">
                      <div className="font-mono text-sm font-semibold tabular-nums text-ink">{s.value}</div>
                      <div className="text-[11px] text-dim">{s.label}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-dim">
                  последний пост: {formatDate(blog.lastPostAt)} · профиль голоса:{' '}
                  {blog.profile ?? 'не задан'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/blog/settings/${encodeURIComponent(blog.slug)}`}
                    className="inline-flex min-h-[32px] items-center rounded-md border border-line-strong px-2.5 text-xs text-dim transition-colors hover:border-accent-dim hover:text-ink"
                  >
                    Обзор и промпты
                  </Link>
                  <Link
                    href={`/blog/posts?blog=${encodeURIComponent(blog.slug)}`}
                    className="inline-flex min-h-[32px] items-center rounded-md border border-line-strong px-2.5 text-xs text-dim transition-colors hover:border-accent-dim hover:text-ink"
                  >
                    Посты
                  </Link>
                  <Button size="sm" variant={blog.status === 'archived' ? 'ghost' : 'danger'} onClick={() => setArchiveTarget(blog)}>
                    {blog.status === 'archived' ? 'Вернуть' : 'Архивировать'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        title="Новый блог"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button variant="primary" onClick={() => void create()} loading={busy}>
              Создать
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="new-blog-name" label="Название">
            <input
              className={`${INPUT_CLASS} w-full`}
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              placeholder="Невский храм на Доваторцев"
            />
          </Field>
          <Field id="new-blog-slug" label="Slug (латиница, стабильный)" hint="После создания не меняется.">
            <input
              className={`${INPUT_CLASS} w-full`}
              value={slug}
              maxLength={64}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="nevsky-hram"
            />
          </Field>
          <Field id="new-blog-profile" label="Профиль голоса" hint="Оставьте пустым, чтобы настроить позже.">
            {profiles.length > 0 ? (
              <select className={`${INPUT_CLASS} w-full`} value={profile} onChange={(e) => setProfile(e.target.value)}>
                <option value="">— без профиля —</option>
                {profiles.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <input className={`${INPUT_CLASS} w-full`} value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="default" />
            )}
          </Field>
          <Field id="new-blog-tg" label="Telegram chat_id (необязательно)">
            <input className={`${INPUT_CLASS} w-full`} value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder="-1001234567890" />
          </Field>
          <Field id="new-blog-style" label="Пресет стиля">
            <select className={`${INPUT_CLASS} w-full`} value={stylePreset} onChange={(e) => setStylePreset(e.target.value as 'default' | 'antonov')}>
              <option value="default">По умолчанию (профиль + примеры)</option>
              <option value="antonov">Антонов</option>
            </select>
          </Field>
          <Field id="new-blog-sources" label="RSS-источники" hint="По одной ссылке в строке. Пусто = источники добавите позже.">
            <Textarea value={sourcesText} onValueChange={setSourcesText} max={6000} rows={3} placeholder="https://example.com/rss" />
          </Field>
          {formError ? <p className="text-xs text-err">{formError}</p> : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={toggleArchive}
        title={archiveTarget?.status === 'archived' ? 'Вернуть блог из архива?' : 'Архивировать блог?'}
        tone={archiveTarget?.status === 'archived' ? 'primary' : 'danger'}
        confirmLabel={archiveTarget?.status === 'archived' ? 'Вернуть' : 'Архивировать'}
        body={
          archiveTarget?.status === 'archived' ? (
            <p>Блог снова появится в селекторах и сможет генерировать контент.</p>
          ) : (
            <p>
              Блог «{archiveTarget?.name}» скроется из селекторов, автоматизация и расписание
              перестанут создавать посты. Данные сохранятся — вернуть можно в любой момент.
            </p>
          )
        }
      />

      <BlogCheatSheet />
    </div>
  );
}
