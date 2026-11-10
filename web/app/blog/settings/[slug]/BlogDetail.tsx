// /blog/settings/[slug] — карточка блога: Обзор / Промпты / Настройки / Расписание.
// 'use client'. Все данные — через существующие API (blogs, agent-prompts, schedule,
// blog/posts). Промпты сохраняются точечно (PUT), общие поля — частичным PATCH;
// грязное состояние защищено подтверждением при смене вкладки и beforeunload.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Dialog } from '../../../components/ui/Dialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Field, INPUT_CLASS } from '../../../components/ui/Field';
import { SectionHead } from '../../../components/ui/SectionHead';
import { Tabs } from '../../../components/ui/Tabs';
import { Textarea } from '../../../components/ui/Textarea';
import { useToast } from '../../../components/ui/Toast';

interface BlogCounts {
  posts: number;
  news: number;
  styleSamples: number;
  postsLast7Days: number;
  lastPostAt: string | null;
}

interface BlogDetailDto {
  id: number;
  slug: string;
  name: string;
  profile: string | null;
  hasProfile: boolean;
  tgChatId: string | null;
  stylePreset: 'default' | 'antonov';
  systemPrompt: string | null;
  contextPrompt: string | null;
  sources: string[];
  sourcesCount: number;
  status: 'active' | 'archived';
  counts: BlogCounts;
  lastPostAt: string | null;
  agentPromptsCount: number;
  readyForNews: boolean;
  createdAt: string;
}

interface AgentPromptItem {
  agent: string;
  label: string;
  description: string;
  group: 'content' | 'scout' | 'quality' | 'service';
  defaultPrompt: string;
  prompt: string | null;
  effectivePrompt: string;
  source: 'blog' | 'legacy-blog-system' | 'preset' | 'default';
  isOverridden: boolean;
  updatedAt: string | null;
  maxLength: number;
  editableScope: string;
}

interface ScheduleEntry {
  dayOfWeek: number;
  timeLocal: string;
  timezone: string;
  topic: string;
  variants: number;
  enabled: boolean;
}

interface ScheduleRun {
  id: number;
  status: 'running' | 'success' | 'error';
  attempts: number;
  postId: number | null;
  message: string;
  startedAt: string;
}

interface PostItem {
  id: number;
  content: string;
  topic: string | null;
  created_at: string;
}

const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'prompts', label: 'Промпты' },
  { id: 'general', label: 'Настройки' },
  { id: 'schedule', label: 'Расписание' },
];

const GROUP_LABELS: Record<AgentPromptItem['group'], string> = {
  content: 'Контент',
  scout: 'Разведка тем',
  quality: 'Качество',
  service: 'Служебные',
};

const DAY_OPTIONS = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 0, label: 'Воскресенье' },
];

const SOURCE_LABELS: Record<AgentPromptItem['source'], string> = {
  blog: 'кастомный',
  'legacy-blog-system': 'системный промпт',
  preset: 'пресет',
  default: 'по умолчанию',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function errorOf(json: unknown, fallback: string): string {
  if (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string') {
    return json.error;
  }
  return fallback;
}

export function BlogDetail({ slug }: { slug: string }) {
  const { toast } = useToast();
  const [blog, setBlog] = useState<BlogDetailDto | null>(null);
  const [prompts, setPrompts] = useState<AgentPromptItem[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  // general form
  const [name, setName] = useState('');
  const [profile, setProfile] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [stylePreset, setStylePreset] = useState<'default' | 'antonov'>('default');
  const [sourcesText, setSourcesText] = useState('');
  const [contextPrompt, setContextPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // prompts editor
  const [agent, setAgent] = useState('post.writer');
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const applyBlog = useCallback((b: BlogDetailDto) => {
    setBlog(b);
    setName(b.name);
    setProfile(b.profile ?? '');
    setTgChatId(b.tgChatId ?? '');
    setStylePreset(b.stylePreset);
    setSourcesText(b.sources.join('\n'));
    setContextPrompt(b.contextPrompt ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [blogResp, promptsResp, scheduleResp, postsResp] = await Promise.all([
        fetch(`/api/blogs/${encodeURIComponent(slug)}`, { cache: 'no-store' }),
        fetch(`/api/blogs/${encodeURIComponent(slug)}/agent-prompts`, { cache: 'no-store' }),
        fetch(`/api/blogs/${encodeURIComponent(slug)}/schedule`, { cache: 'no-store' }),
        fetch(`/api/blog/posts?limit=5&blog=${encodeURIComponent(slug)}`, { cache: 'no-store' }),
      ]);
      const blogJson = (await blogResp.json().catch(() => ({}))) as { blog?: BlogDetailDto; error?: string };
      if (!blogResp.ok || !blogJson.blog) throw new Error(errorOf(blogJson, 'Не удалось загрузить блог'));
      applyBlog(blogJson.blog);

      const promptsJson = (await promptsResp.json().catch(() => ({}))) as {
        prompts?: AgentPromptItem[];
        error?: string;
      };
      if (promptsResp.ok && promptsJson.prompts) {
        setPrompts(promptsJson.prompts);
        const first = promptsJson.prompts.find((p) => p.agent === agent) ?? promptsJson.prompts[0];
        if (first) {
          setAgent(first.agent);
          setPromptDraft(first.prompt ?? '');
        }
      }

      if (scheduleResp.ok) {
        const data = (await scheduleResp.json().catch(() => ({}))) as {
          schedules?: ScheduleEntry[];
          runs?: ScheduleRun[];
        };
        setSchedule((data.schedules ?? []).map((s) => ({ ...s })));
        setRuns(data.runs ?? []);
        setScheduleDirty(false);
      }

      if (postsResp.ok) {
        const data = (await postsResp.json().catch(() => ({}))) as { posts?: PostItem[] };
        setPosts(data.posts ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить блог');
    } finally {
      setLoading(false);
    }
  }, [slug, agent, applyBlog]);

  useEffect(() => {
    void load();
    // load зависит от agent только для выбора первого агента; повторный fetch
    // при переключении агента не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const dirtyGeneral = useMemo(() => {
    if (!blog) return false;
    return (
      name !== blog.name ||
      profile !== (blog.profile ?? '') ||
      tgChatId !== (blog.tgChatId ?? '') ||
      stylePreset !== blog.stylePreset ||
      sourcesText !== blog.sources.join('\n') ||
      contextPrompt !== (blog.contextPrompt ?? '')
    );
  }, [blog, name, profile, tgChatId, stylePreset, sourcesText, contextPrompt]);

  const currentPrompt = prompts.find((p) => p.agent === agent) ?? null;
  const dirtyPrompt = currentPrompt !== null && promptDraft !== (currentPrompt.prompt ?? '');
  const dirty = dirtyGeneral || dirtyPrompt || scheduleDirty;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const selectAgent = (next: string): void => {
    const item = prompts.find((p) => p.agent === next);
    if (!item) return;
    if (dirtyPrompt) {
      setPendingTab(`prompt:${next}`);
      return;
    }
    setAgent(next);
    setPromptDraft(item.prompt ?? '');
    setPromptError(null);
  };

  const changeTab = (next: string): void => {
    if (next === tab) return;
    if (dirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  };

  const discardAndContinue = (): void => {
    const target = pendingTab;
    setPendingTab(null);
    if (!target) return;
    if (target.startsWith('prompt:')) {
      const next = target.slice('prompt:'.length);
      const item = prompts.find((p) => p.agent === next);
      setAgent(next);
      setPromptDraft(item?.prompt ?? '');
      setPromptError(null);
    } else {
      // Сбрасываем все черновики (общие поля, промпт, расписание) и уходим.
      void load();
      setTab(target);
    }
  };

  const saveGeneral = async (): Promise<void> => {
    if (!blog || saving) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('Название обязательно');
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
    const patch: Record<string, unknown> = {};
    if (cleanName !== blog.name) patch.name = cleanName;
    if (profile !== (blog.profile ?? '')) patch.profile = profile.trim() || null;
    if (tgChatId !== (blog.tgChatId ?? '')) patch.tgChatId = tgChatId.trim();
    if (stylePreset !== blog.stylePreset) patch.stylePreset = stylePreset;
    if (sourcesText !== blog.sources.join('\n')) patch.sources = sources;
    if (contextPrompt !== (blog.contextPrompt ?? '')) patch.contextPrompt = contextPrompt.trim() || null;
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setFormError(null);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(blog.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = (await resp.json().catch(() => ({}))) as { blog?: BlogDetailDto; error?: string };
      if (!resp.ok || !data.blog) throw new Error(errorOf(data, `HTTP ${resp.status}`));
      applyBlog(data.blog);
      toast('ok', 'Настройки сохранены');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const savePrompt = async (): Promise<void> => {
    if (!currentPrompt || promptSaving) return;
    setPromptSaving(true);
    setPromptError(null);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(slug)}/agent-prompts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: currentPrompt.agent,
          prompt: promptDraft.trim() === '' ? null : promptDraft,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        prompt?: AgentPromptItem;
        error?: string;
      };
      if (!resp.ok || !data.prompt) throw new Error(errorOf(data, `HTTP ${resp.status}`));
      const updated = data.prompt;
      const nextPrompts = prompts.map((p) => (p.agent === updated.agent ? updated : p));
      setPrompts(nextPrompts);
      setBlog((prev) =>
        prev ? { ...prev, agentPromptsCount: nextPrompts.filter((p) => p.isOverridden).length } : prev,
      );
      setPromptDraft(updated.prompt ?? '');
      toast('ok', updated.isOverridden ? 'Промпт сохранён' : 'Промпт сброшен');
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : 'Не удалось сохранить промпт');
    } finally {
      setPromptSaving(false);
    }
  };

  const resetPrompt = async (): Promise<void> => {
    if (!currentPrompt) return;
    setPromptSaving(true);
    setPromptError(null);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(slug)}/agent-prompts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: currentPrompt.agent, prompt: null }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        prompt?: AgentPromptItem;
        error?: string;
      };
      if (!resp.ok || !data.prompt) throw new Error(errorOf(data, `HTTP ${resp.status}`));
      const updated = data.prompt;
      const nextPrompts = prompts.map((p) => (p.agent === updated.agent ? updated : p));
      setPrompts(nextPrompts);
      setBlog((prev) =>
        prev ? { ...prev, agentPromptsCount: nextPrompts.filter((p) => p.isOverridden).length } : prev,
      );
      setPromptDraft(updated.prompt ?? '');
      setResetOpen(false);
      toast('ok', 'Возвращён встроенный промпт');
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : 'Не удалось сбросить промпт');
    } finally {
      setPromptSaving(false);
    }
  };

  const updateSlot = (index: number, patch: Partial<ScheduleEntry>): void => {
    setSchedule((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setScheduleDirty(true);
  };

  const addSlot = (): void => {
    setSchedule((prev) => {
      const used = new Set(prev.map((s) => s.dayOfWeek));
      const day = [6, 0, 1, 2, 3, 4, 5].find((d) => !used.has(d)) ?? 6;
      return [...prev, { dayOfWeek: day, timeLocal: '10:00', timezone: 'Europe/Moscow', topic: '', variants: 1, enabled: true }];
    });
    setScheduleDirty(true);
  };

  const saveSchedule = async (): Promise<void> => {
    if (!blog || scheduleSaving) return;
    setScheduleSaving(true);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(blog.slug)}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: schedule }),
      });
      const data = (await resp.json().catch(() => ({}))) as { schedules?: ScheduleEntry[]; error?: string };
      if (!resp.ok) throw new Error(errorOf(data, `HTTP ${resp.status}`));
      setSchedule((data.schedules ?? []).map((s) => ({ ...s })));
      setScheduleDirty(false);
      toast('ok', 'Расписание сохранено');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось сохранить расписание');
    } finally {
      setScheduleSaving(false);
    }
  };

  const setArchived = async (archived: boolean): Promise<void> => {
    if (!blog) return;
    setSaving(true);
    try {
      const resp = await fetch(`/api/blogs/${encodeURIComponent(blog.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'archived' : 'active' }),
      });
      const data = (await resp.json().catch(() => ({}))) as { blog?: BlogDetailDto; error?: string };
      if (!resp.ok || !data.blog) throw new Error(errorOf(data, `HTTP ${resp.status}`));
      applyBlog(data.blog);
      setArchiveOpen(false);
      toast('ok', archived ? 'Блог в архиве' : 'Блог возвращён');
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Не удалось изменить статус');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SectionHead code="blog · studio" title="Загрузка блога…" />
        <Card label="данные"><p className="text-sm text-dim">Читаю настройки, промпты и расписание…</p></Card>
      </div>
    );
  }

  if (error || !blog) {
    return (
      <div className="space-y-4">
        <SectionHead code="blog · studio" title="Блог недоступен" actions={<Link className="text-sm text-accent hover:underline" href="/blog/settings">← Все блоги</Link>} />
        <Card label="ошибка" tone="danger">
          <p className="text-sm text-err">{error ?? 'Блог не найден'}</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void load()}>Повторить</Button>
            <Link className="inline-flex min-h-[36px] items-center rounded-md border border-line-strong px-3 text-sm text-dim hover:text-ink" href="/blog/settings">
              Все блоги
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHead
        code={`blog · ${blog.slug}`}
        title={blog.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={blog.status === 'archived' ? 'dim' : blog.readyForNews ? 'ok' : 'warn'}>
              {blog.status === 'archived' ? 'архив' : blog.readyForNews ? 'готов к news' : 'нужна настройка'}
            </Badge>
            <span>{blog.hasProfile ? `профиль: ${blog.profile}` : 'профиль не задан'}</span>
            <span>· RSS: {blog.sourcesCount}</span>
            <span>· промпты: {blog.agentPromptsCount}/8</span>
          </span>
        }
        actions={
          <Link className="text-sm text-accent hover:underline" href="/blog/settings">
            ← Все блоги
          </Link>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS} active={tab} onChange={changeTab} label="Разделы блога" />
        {dirty ? <Badge tone="warn">есть несохранённые изменения</Badge> : null}
      </div>

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'посты', value: blog.counts.posts },
              { label: 'за 7 дней', value: blog.counts.postsLast7Days },
              { label: 'новости', value: blog.counts.news },
              { label: 'стиль', value: blog.counts.styleSamples },
            ].map((s) => (
              <Card key={s.label} label={s.label}>
                <div className="font-mono text-2xl font-semibold tabular-nums text-ink">{s.value}</div>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card label="готовность">
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span>Профиль голоса</span>
                  <Badge tone={blog.hasProfile ? 'ok' : 'err'}>{blog.hasProfile ? 'есть' : 'не задан'}</Badge>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span>RSS-источники</span>
                  <Badge tone={blog.sourcesCount > 0 ? 'ok' : 'err'}>{blog.sourcesCount}</Badge>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span>Кастомные промпты</span>
                  <Badge tone={blog.agentPromptsCount > 0 ? 'accent' : 'dim'}>{blog.agentPromptsCount}/8</Badge>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span>Последний пост</span>
                  <span className="text-dim">{formatDate(blog.lastPostAt)}</span>
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => changeTab('prompts')}>Промпты агентов</Button>
                <Button size="sm" onClick={() => changeTab('general')}>Общие настройки</Button>
                <Link href={`/blog/news?blog=${encodeURIComponent(blog.slug)}`} className="inline-flex min-h-[32px] items-center rounded-md border border-line-strong px-2.5 text-xs text-dim hover:text-ink">
                  Запустить news
                </Link>
              </div>
            </Card>

            <Card label="последние посты">
              {posts.length === 0 ? (
                <EmptyState title="Постов пока нет" hint="Создайте пост по теме или запустите news-пайплайн." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {posts.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3">
                      <Link href={`/blog/posts/${p.id}`} className="line-clamp-2 text-dim hover:text-ink">
                        <span className="text-accent">#{p.id}</span> {p.topic ?? p.content.slice(0, 80)}
                      </Link>
                      <span className="shrink-0 text-xs text-dim">{formatDate(p.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card label="последние запуски расписания">
            {runs.length === 0 ? (
              <p className="text-sm text-dim">Запусков пока не было.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {runs.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === 'success' ? 'ok' : 'err'}>{r.status}</Badge>
                    <span className="text-dim">{r.startedAt}</span>
                    <span>попыток: {r.attempts}</span>
                    <span className="text-dim">{r.message}</span>
                    {r.postId ? <Link className="text-accent hover:underline" href={`/blog/posts/${r.postId}`}>#{r.postId}</Link> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card label="архив" tone={blog.status === 'archived' ? 'warn' : 'default'}>
            <p className="text-sm text-dim">
              {blog.status === 'archived'
                ? 'Блог в архиве: селекторы, автоматизация и расписание его не используют. Данные сохранены.'
                : 'Архивация скрывает блог из селекторов и останавливает автогенерацию. Данные не удаляются.'}
            </p>
            <Button className="mt-3" variant={blog.status === 'archived' ? 'primary' : 'danger'} onClick={() => setArchiveOpen(true)}>
              {blog.status === 'archived' ? 'Вернуть из архива' : 'Архивировать блог'}
            </Button>
          </Card>
        </div>
      ) : null}

      {tab === 'prompts' ? (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card label="агенты">
            <div className="space-y-3">
              {(['content', 'scout', 'quality', 'service'] as const).map((group) => {
                const items = prompts.filter((p) => p.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">{GROUP_LABELS[group]}</div>
                    <div className="space-y-1">
                      {items.map((p) => (
                        <button
                          key={p.agent}
                          type="button"
                          onClick={() => selectAgent(p.agent)}
                          className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                            p.agent === agent
                              ? 'border-accent-dim bg-accent/10 text-ink'
                              : 'border-line text-dim hover:border-accent-dim hover:text-ink'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span>{p.label}</span>
                            {p.isOverridden ? <span className="text-accent">•</span> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
            label={currentPrompt ? `${currentPrompt.label} · ${SOURCE_LABELS[currentPrompt.source]}` : 'промпт'}
            actions={
              currentPrompt ? (
                <Badge tone={currentPrompt.isOverridden ? 'accent' : 'dim'}>
                  {currentPrompt.isOverridden ? 'кастомный' : 'встроенный'}
                </Badge>
              ) : null
            }
          >
            {currentPrompt ? (
              <div className="space-y-3">
                <p className="text-sm text-dim">{currentPrompt.description}</p>
                <p className="rounded-md border border-line bg-surface-2 p-2 text-xs leading-relaxed text-dim">
                  Меняется: {currentPrompt.editableScope}
                </p>
                <Field
                  id="agent-prompt"
                  label="Текст промпта"
                  hint="Пустое поле = сброс к встроенному. Динамические данные и JSON-контракт добавляются автоматически."
                  error={promptError ?? undefined}
                >
                  <Textarea
                    value={promptDraft}
                    onValueChange={setPromptDraft}
                    max={currentPrompt.maxLength}
                    rows={12}
                    placeholder={currentPrompt.defaultPrompt}
                    disabled={promptSaving}
                  />
                </Field>
                {currentPrompt.agent === 'post.writer' ? (
                  <p className="text-xs text-warn">
                    Для автора поста явный промпт отключает few-shot примеры стиля; канал, подпись и контекст
                    добавляются автоматически.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => void savePrompt()} disabled={!dirtyPrompt || promptSaving || promptDraft.length > currentPrompt.maxLength} loading={promptSaving}>
                    Сохранить промпт
                  </Button>
                  <Button onClick={() => setPromptDraft(currentPrompt.prompt ?? '')} disabled={!dirtyPrompt || promptSaving}>
                    Отменить правки
                  </Button>
                  <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
                    Предпросмотр
                  </Button>
                  {currentPrompt.isOverridden ? (
                    <Button variant="danger" onClick={() => setResetOpen(true)} disabled={promptSaving}>
                      Сбросить к встроенному
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-dim">Промпты не загрузились — обновите страницу.</p>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'general' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card label="основное">
            <div className="space-y-3">
              <Field id="blog-name" label="Название">
                <input className={`${INPUT_CLASS} w-full`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} disabled={saving} />
              </Field>
              <Field id="blog-profile" label="Профиль голоса" hint="Имя профиля из /chat; пусто = без профиля.">
                <input className={`${INPUT_CLASS} w-full`} value={profile} maxLength={100} onChange={(e) => setProfile(e.target.value)} disabled={saving} />
              </Field>
              <Field id="blog-tg" label="Telegram chat_id" hint="Пусто = общий канал из env.">
                <input className={`${INPUT_CLASS} w-full`} value={tgChatId} maxLength={100} onChange={(e) => setTgChatId(e.target.value)} disabled={saving} />
              </Field>
              <Field id="blog-style" label="Пресет стиля">
                <select className={`${INPUT_CLASS} w-full`} value={stylePreset} onChange={(e) => setStylePreset(e.target.value as 'default' | 'antonov')} disabled={saving}>
                  <option value="default">По умолчанию (профиль + примеры)</option>
                  <option value="antonov">Антонов</option>
                </select>
              </Field>
            </div>
          </Card>

          <Card label="контекст и источники">
            <div className="space-y-3">
              <Field id="blog-context" label="Контекст блога" hint="Постоянные факты, аудитория, тон. Подмешивается к постам.">
                <Textarea value={contextPrompt} onValueChange={setContextPrompt} max={8000} rows={6} disabled={saving} />
              </Field>
              <Field id="blog-sources" label="RSS-источники" hint="По одной ссылке в строке. Пусто = источники не заданы.">
                <Textarea value={sourcesText} onValueChange={setSourcesText} max={12000} rows={5} disabled={saving} />
              </Field>
            </div>
          </Card>

          <div className="lg:col-span-2">
            {formError ? <p className="mb-2 text-sm text-err">{formError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void saveGeneral()} disabled={!dirtyGeneral || saving} loading={saving}>
                Сохранить настройки
              </Button>
              <Button
                onClick={() => {
                  setName(blog.name);
                  setProfile(blog.profile ?? '');
                  setTgChatId(blog.tgChatId ?? '');
                  setStylePreset(blog.stylePreset);
                  setSourcesText(blog.sources.join('\n'));
                  setContextPrompt(blog.contextPrompt ?? '');
                  setFormError(null);
                }}
                disabled={!dirtyGeneral || saving}
              >
                Отменить правки
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'schedule' ? (
        <Card label="расписание постов (дни недели)">
          <div className="space-y-4">
            <p className="text-xs text-dim">
              Слоты запускаются в локальном времени таймзоны (окно догона 3 часа). Черновики по умолчанию;
              автопубликация — правило блога в <Link className="text-accent hover:underline" href="/automation">/automation</Link>.
            </p>
            {schedule.length === 0 ? (
              <p className="rounded-md border border-line bg-surface-2 p-3 text-sm text-dim">Слотов нет — добавьте день и время.</p>
            ) : (
              <div className="space-y-3">
                {schedule.map((s, i) => (
                  <div key={i} className="rounded-md border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap items-end gap-3 text-xs text-dim">
                      <label className="flex flex-col gap-1">
                        день
                        <select className={INPUT_CLASS} value={s.dayOfWeek} onChange={(e) => updateSlot(i, { dayOfWeek: Number(e.target.value) })} disabled={scheduleSaving}>
                          {DAY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        время
                        <input type="time" className={INPUT_CLASS} value={s.timeLocal} onChange={(e) => updateSlot(i, { timeLocal: e.target.value })} disabled={scheduleSaving} />
                      </label>
                      <label className="flex flex-col gap-1">
                        таймзона
                        <input className={`${INPUT_CLASS} w-40`} value={s.timezone} onChange={(e) => updateSlot(i, { timezone: e.target.value })} disabled={scheduleSaving} />
                      </label>
                      <label className="flex flex-col gap-1">
                        вариантов
                        <select className={INPUT_CLASS} value={s.variants} onChange={(e) => updateSlot(i, { variants: Number(e.target.value) })} disabled={scheduleSaving}>
                          <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 pb-2">
                        <input type="checkbox" checked={s.enabled} onChange={(e) => updateSlot(i, { enabled: e.target.checked })} className="accent-accent" disabled={scheduleSaving} />
                        включён
                      </label>
                      <button type="button" className="pb-2 text-xs text-err hover:underline disabled:opacity-50" onClick={() => { setSchedule((prev) => prev.filter((_, idx) => idx !== i)); setScheduleDirty(true); }} disabled={scheduleSaving}>
                        удалить
                      </button>
                    </div>
                    <label className="mt-2 flex flex-col gap-1 text-xs text-dim">
                      тема / фокус (пусто = регулярный пост блога)
                      <input className={`${INPUT_CLASS} w-full`} value={s.topic} maxLength={500} onChange={(e) => updateSlot(i, { topic: e.target.value })} disabled={scheduleSaving} />
                    </label>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={addSlot} disabled={scheduleSaving || schedule.length >= 14}>Добавить слот</Button>
              <Button variant="primary" onClick={() => void saveSchedule()} disabled={!scheduleDirty || scheduleSaving} loading={scheduleSaving}>
                Сохранить расписание
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="Как увидит модель" footer={<Button onClick={() => setPreviewOpen(false)}>Закрыть</Button>}>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink">
          {currentPrompt?.effectivePrompt ?? ''}
        </pre>
        <p className="mt-2 text-xs text-dim">
          Это сохранённый/встроенный текст. При генерации код добавит канал, профиль, контекст и неизменяемые JSON-правила.
        </p>
      </Dialog>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={resetPrompt}
        title="Сбросить промпт?"
        tone="danger"
        confirmLabel="Сбросить"
        body={<p>Кастомный текст агента «{currentPrompt?.label}» будет удалён. Вернётся встроенное поведение (для автора — системный промпт/пресет).</p>}
      />

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => setArchived(blog.status !== 'archived')}
        title={blog.status === 'archived' ? 'Вернуть блог?' : 'Архивировать блог?'}
        tone={blog.status === 'archived' ? 'primary' : 'danger'}
        confirmLabel={blog.status === 'archived' ? 'Вернуть' : 'Архивировать'}
        body={<p>{blog.status === 'archived' ? 'Блог снова станет доступен для генерации.' : 'Данные сохранятся; автогенерация и расписание остановятся.'}</p>}
      />

      <Dialog
        open={pendingTab !== null}
        onClose={() => setPendingTab(null)}
        title="Есть несохранённые изменения"
        footer={
          <>
            <Button onClick={() => setPendingTab(null)}>Остаться</Button>
            <Button variant="danger" onClick={discardAndContinue}>Отменить правки и продолжить</Button>
          </>
        }
      >
        <p>Если уйти сейчас, правки в текущем разделе будут потеряны.</p>
      </Dialog>
    </div>
  );
}
