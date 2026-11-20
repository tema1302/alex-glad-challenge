// /automation — правила автоматизации блогов + ручной запуск + история.
// Прогон правила с автопубликацией — реальная отправка в TG-канал: как все
// publish-пути морды, он идёт через ConfirmDialog; без автопубликации (черновик)
// запуск идёт сразу.
// S5: правило создаётся из UI (upsert по action:'configure' — новый эндпоинт не
// нужен); флаг планировщика (schedulerEnabled) показывается честно: правило при
// мёртвом тикере не «работает»; тумблер автопубликации — общий для интервальных
// прогонов и слотов расписания блога (одна запись automation_rules).
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LinkButton } from '../components/ui/LinkButton';
import { SectionHead } from '../components/ui/SectionHead';
import { EmptyState } from '../components/ui/EmptyState';
import { Dialog } from '../components/ui/Dialog';
import { Field, INPUT_CLASS } from '../components/ui/Field';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';

interface Rule {
  blogId: number;
  blogSlug: string | null;
  blogName: string;
  stylePreset: 'default' | 'antonov';
  enabled: boolean;
  intervalMinutes: number;
  autoPublish: boolean;
  nextRunAt: string | null;
}
interface Run {
  id: number;
  blogId: number;
  status: string;
  message: string;
  postId?: number | null;
  startedAt: string;
}
interface BlogOption {
  id: number;
  slug: string;
  name: string;
  hasProfile: boolean;
  sourcesCount: number;
  tgChatId?: string | null;
  tgChatIdSet?: boolean;
  readyForNews?: boolean;
}

// Шаги интервала — общий набор для создания и правки правила.
const INTERVAL_STEPS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 5, label: '5 мин' },
  { minutes: 30, label: '30 мин' },
  { minutes: 60, label: '1 ч' },
  { minutes: 180, label: '3 ч' },
  { minutes: 360, label: '6 ч' },
  { minutes: 720, label: '12 ч' },
  { minutes: 1440, label: 'сутки' },
];

function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) return 'раз в сутки';
  if (minutes % 60 === 0) return `каждые ${minutes / 60} ч`;
  return `каждые ${minutes} мин`;
}

export default function AutomationPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runTarget, setRunTarget] = useState<Rule | null>(null);
  const [schedulerEnabled, setSchedulerEnabled] = useState<boolean | null>(null);

  // Данные для диалога «Новое правило».
  const [blogs, setBlogs] = useState<BlogOption[] | null>(null);
  const [blogsError, setBlogsError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBlogId, setNewBlogId] = useState('');
  const [newInterval, setNewInterval] = useState('360');
  const [newAutoPublish, setNewAutoPublish] = useState(false);
  const [newEnable, setNewEnable] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/automation');
      if (!r.ok) {
        setError('не удалось загрузить');
        return;
      }
      const data = (await r.json()) as { rules: Rule[]; runs: Run[]; schedulerEnabled?: boolean };
      setRules(data.rules);
      setRuns(data.runs);
      setSchedulerEnabled(typeof data.schedulerEnabled === 'boolean' ? data.schedulerEnabled : null);
    } catch {
      // Сетевой сбой не должен выглядеть как «правил нет» — текст вместо пустоты.
      setError('не удалось загрузить правила — сеть недоступна');
    }
  }, []);

  const loadBlogs = useCallback(async () => {
    try {
      const r = await fetch('/api/blogs');
      if (!r.ok) {
        setBlogsError('Не удалось загрузить блоги');
        return;
      }
      const data = (await r.json()) as { blogs?: BlogOption[] };
      setBlogs(data.blogs ?? []);
      setBlogsError(null);
    } catch {
      // Отдельный текст от ошибки правил: селектор и список падают независимо.
      setBlogsError('Не удалось загрузить блоги — сеть недоступна');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBlogs();
  }, [load, loadBlogs]);

  const configure = async (blogId: number, patch: Partial<Pick<Rule, 'enabled' | 'intervalMinutes' | 'autoPublish'>>) => {
    setError(null);
    try {
      const r = await fetch('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'configure', blogId, ...patch }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'не удалось сохранить правило');
      }
    } catch {
      setError('не удалось сохранить правило — сеть недоступна');
    }
    void load();
  };

  const runNow = useCallback(
    async (target: Rule) => {
      setError(null);
      try {
        const r = await fetch('/api/automation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'run', blogId: target.blogId }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          message?: string;
          error?: string;
        };
        if (!r.ok || data.error) {
          setError(data.error ?? 'ошибка запуска');
        } else if (data.status === 'error') {
          // Прогон состоялся, но пайплайн упал — молчать нельзя.
          setError(data.message ?? 'прогон завершился с ошибкой');
        } else {
          toast('ok', `Прогон выполнен${data.message ? `: ${data.message}` : ''}`);
        }
      } catch {
        setError('не удалось запустить прогон — сеть недоступна');
      }
      void load();
    },
    [toast, load],
  );

  const setPreset = async (slug: string, stylePreset: Rule['stylePreset']) => {
    setError(null);
    const r = await fetch(`/api/blogs/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylePreset }),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'не удалось сменить пресет');
    }
    void load();
  };

  // Блоги без правила: action:'configure' — upsert, «создание» для блога с
  // правилом перезаписало бы его настройки, поэтому такие блоги в селект не идут.
  const availableBlogs = (blogs ?? []).filter(
    (b) => !(rules ?? []).some((r) => r.blogId === b.id),
  );
  const selectedBlog = availableBlogs.find((b) => String(b.id) === newBlogId) ?? null;

  const openCreate = () => {
    setNewBlogId('');
    setNewInterval('360');
    setNewAutoPublish(false);
    setNewEnable(false);
    setCreateError(null);
    setCreateOpen(true);
  };

  const createRule = async () => {
    if (!selectedBlog) {
      setCreateError('выберите блог');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          blogId: selectedBlog.id,
          enabled: newEnable,
          autoPublish: newAutoPublish,
          intervalMinutes: Number(newInterval),
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setCreateError(data.error ?? 'не удалось создать правило');
        return;
      }
      toast('ok', `Правило для «${selectedBlog.name}» создано`);
      setCreateOpen(false);
      void load();
    } catch {
      setCreateError('не удалось создать правило — сеть недоступна');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHead
        code="product · automation"
        title="Автоматизация блогов"
        description="Правило = интервал прогонов + общий тумблер автопубликации: он действует и на интервальные прогоны, и на слоты расписания блога. Стиль задаётся пресетом блога."
        actions={
          rules && rules.length > 0 ? (
            <Button variant="primary" onClick={openCreate}>
              Создать правило
            </Button>
          ) : undefined
        }
      />
      {error ? <p className="text-sm text-err">{error}</p> : null}
      {schedulerEnabled === true ? (
        <p role="status" className="text-xs text-ok">
          планировщик: работает — тики ходят, пока запущен web-сервер
        </p>
      ) : schedulerEnabled === false ? (
        <p role="status" className="text-xs text-err">
          планировщик: выключен — правила не срабатывают автоматически; тики включаются
          настройкой сервера
        </p>
      ) : null}

      {rules == null ? (
        !error ? <p className="text-sm text-dim">Загрузка…</p> : null
      ) : rules.length === 0 ? (
        <EmptyState
          title="Правил нет"
          hint="Правило создаётся на конкретный блог: выберите блог, интервал и автопубликацию."
          action={
            <Button variant="primary" onClick={openCreate}>
              Создать правило
            </Button>
          }
        />
      ) : (
        <Card label="Правила">
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.blogId} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{r.blogName}</p>
                    <p className="text-xs text-dim">
                      {r.enabled ? intervalLabel(r.intervalMinutes) : 'выключено'}
                      {r.nextRunAt && r.enabled ? ` · следующий запуск ${r.nextRunAt.slice(0, 16).replace('T', ' ')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-dim">
                      <input type="checkbox" checked={r.enabled} onChange={(e) => configure(r.blogId, { enabled: e.target.checked })} className="accent-accent" />
                      вкл
                    </label>
                    <label className="flex items-center gap-1 text-xs text-dim">
                      <input type="checkbox" checked={r.autoPublish} onChange={(e) => configure(r.blogId, { autoPublish: e.target.checked })} className="accent-accent" />
                      автопубликация
                    </label>
                    <Button
                      variant="primary"
                      onClick={() => (r.autoPublish ? setRunTarget(r) : void runNow(r))}
                    >
                      Запустить
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-dim">
                  интервал:
                  <select
                    value={r.intervalMinutes}
                    onChange={(e) => configure(r.blogId, { intervalMinutes: Number(e.target.value) })}
                    className="rounded border border-line bg-surface-2 px-2 py-1 text-ink"
                  >
                    {INTERVAL_STEPS.map((s) => (
                      <option key={s.minutes} value={s.minutes}>{s.label}</option>
                    ))}
                  </select>
                  {r.blogSlug ? (
                    <>
                      пресет стиля:
                      <select
                        aria-label="Пресет стиля"
                        value={r.stylePreset}
                        onChange={(e) => setPreset(r.blogSlug as string, e.target.value as Rule['stylePreset'])}
                        className="rounded border border-line bg-surface-2 px-2 py-1 text-ink"
                      >
                        <option value="default">по умолчанию</option>
                        <option value="antonov">Антонов</option>
                      </select>
                      <LinkButton
                        variant="ghost"
                        size="sm"
                        href={`/blog/settings/${encodeURIComponent(r.blogSlug)}?tab=schedule`}
                      >
                        расписание блога →
                      </LinkButton>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card label="Последние запуски">
        {runs.length === 0 ? (
          <p className="text-sm text-dim">Запусков ещё не было.</p>
        ) : (
          <ul className="space-y-1">
            {runs.slice(0, 20).map((r) => {
              const name = rules?.find((x) => x.blogId === r.blogId)?.blogName ?? `#${r.blogId}`;
              return (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${r.status === 'success' ? 'bg-ok' : r.status === 'error' ? 'bg-err' : 'bg-dim'}`} />
                  <span className="text-dim">{name}</span>
                  <span className="truncate text-ink">{r.message}</span>
                  {r.postId ? (
                    <Link href={`/blog/posts/${r.postId}`} className="shrink-0 text-xs text-accent hover:text-ink">
                      → #{r.postId}
                    </Link>
                  ) : null}
                  <span className="ml-auto text-xs text-dim">{r.startedAt.slice(0, 16).replace('T', ' ')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Создание правила: upsert поверх существующего configure-контракта. */}
      <Dialog
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Новое правило автоматизации"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Отмена
            </Button>
            <Button variant="primary" onClick={() => void createRule()} loading={creating}>
              Создать правило
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {blogsError ? (
            <p className="text-xs text-err">
              {blogsError} —{' '}
              <button type="button" className="text-accent" onClick={() => void loadBlogs()}>
                повторить
              </button>
            </p>
          ) : null}
          {availableBlogs.length === 0 && !blogsError ? (
            <p className="text-sm text-dim">
              {blogs && blogs.length === 0
                ? 'Активных блогов нет — создайте блог в студии.'
                : 'У всех активных блогов уже есть правила.'}
              {blogs && blogs.length === 0 ? (
                <>
                  {' '}
                  <Link href="/blog/settings" className="text-accent hover:text-ink">
                    открыть студию →
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <Field id="new-rule-blog" label="блог" hint="Редактировать существующее правило — тумблерами в списке.">
            <select
              value={newBlogId}
              onChange={(e) => setNewBlogId(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">— выберите блог —</option>
              {availableBlogs.map((b) => (
                <option key={b.id} value={b.id}>
                  {`${b.name} · RSS ${b.sourcesCount} · профиль ${b.hasProfile ? '✓' : '—'}`}
                </option>
              ))}
            </select>
          </Field>
          {selectedBlog && selectedBlog.readyForNews === false ? (
            <p className="text-xs text-warn">
              У блога «{selectedBlog.name}» не хватает RSS-источников или профиля голоса — прогоны
              будут падать с ошибкой. Настройте блог в студии.
            </p>
          ) : null}
          <Field id="new-rule-interval" label="интервал прогона">
            <select
              value={newInterval}
              onChange={(e) => setNewInterval(e.target.value)}
              className={INPUT_CLASS}
            >
              {INTERVAL_STEPS.map((s) => (
                <option key={s.minutes} value={s.minutes}>{s.label}</option>
              ))}
            </select>
          </Field>
          {newInterval === '5' ? (
            <p role="note" className="text-xs text-warn">
              5 минут — только для черновиков: с автопубликацией это пост в канал каждые 5 минут.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={newAutoPublish}
              onChange={(e) => setNewAutoPublish(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span>
              автопубликация
              <span className="mt-1 block text-xs text-dim">
                {newAutoPublish
                  ? selectedBlog
                    ? selectedBlog.tgChatId || selectedBlog.tgChatIdSet
                      ? `Каждый прогон будет сразу отправлять пост в канал блога «${selectedBlog.name}».`
                      : `У блога «${selectedBlog.name}» не задан chat_id — пост уйдёт в общий канал.`
                    : 'Каждый прогон будет сразу отправлять пост в канал блога.'
                  : 'Выключено: прогоны создают черновики, публикация — вручную.'}
              </span>
            </span>
          </label>
          <p className="text-xs text-dim">
            Тумблер автопубликации общий: он же включает публикацию слотов расписания этого блога.
          </p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={newEnable}
              onChange={(e) => setNewEnable(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span>
              включить сразу
              <span className="mt-1 block text-xs text-dim">
                Правило сработает на первом же тике планировщика — почти сразу. Оставьте
                выключенным, чтобы сначала посмотреть список.
              </span>
            </span>
          </label>
          {createError ? <p role="alert" className="text-xs text-err">{createError}</p> : null}
        </div>
      </Dialog>

      {/* Автопубликация = реальная отправка в канал: подтверждение перед прогоном,
          как у всех publish-путей (TgComposer, DigestComposer, страница поста). */}
      <ConfirmDialog
        open={runTarget !== null}
        onClose={() => setRunTarget(null)}
        onConfirm={async () => {
          if (runTarget) await runNow(runTarget);
        }}
        title="Запустить прогон с автопубликацией?"
        confirmLabel="Запустить прогон"
        body={
          <div className="space-y-3">
            <p className="text-sm">
              Прогон сгенерирует пост и <strong className="text-warn">сразу опубликует</strong> его в
              Telegram-канал блога «{runTarget?.blogName}».
            </p>
            <p className="rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
              Реальная отправка — сообщение уйдёт подписчикам канала. У правил без
              автопубликации прогон создаёт черновик и ничего не отправляет.
            </p>
          </div>
        }
      />
    </div>
  );
}
