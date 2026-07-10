// /mcp/todos — CRUD задач через TodoDb (день 28, web P1).
// 'use client': форма добавления + список с действиями ✓/✗/🗑. Перезагрузка списка после
// каждого действия. НИКАКИХ импортов core/ — тип TodoRow инлайн (сервер отдаёт тот же JSON).
'use client';

import { useCallback, useEffect, useState } from 'react';

type Recurring = 'daily' | 'weekly' | 'hourly';
type FormRecurring = 'none' | Recurring;

interface TodoItem {
  id: number;
  text: string;
  scheduled_at: string | null;
  recurring: Recurring | null;
  day_of_week: number | null;
  interval_hours: number | null;
  status: string;
  created_at: string;
}

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function recurringBadge(t: TodoItem): string | null {
  if (t.recurring === 'daily') return 'ежедневно';
  if (t.recurring === 'weekly') return `каждый ${DAYS[t.day_of_week ?? 0]}`;
  if (t.recurring === 'hourly') return t.interval_hours ? `каждые ${t.interval_hours}ч` : 'ежечасно';
  if (t.scheduled_at) return `на ${t.scheduled_at}`;
  return null;
}

export default function TodosPage() {
  const [text, setText] = useState('');
  const [recurring, setRecurring] = useState<FormRecurring>('none');
  const [intervalHours, setIntervalHours] = useState(1);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/todos', { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { todos: TodoItem[] };
      setTodos(data.todos ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { text: text.trim() };
      if (recurring !== 'none') {
        body.recurring = recurring;
        if (recurring === 'hourly') body.intervalHours = intervalHours;
      }
      const resp = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      setText('');
      setRecurring('none');
      setIntervalHours(1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'add failed');
    } finally {
      setSubmitting(false);
    }
  }, [text, recurring, intervalHours, submitting, load]);

  const act = useCallback(
    async (id: number, action: 'complete' | 'dismiss' | 'delete'): Promise<void> => {
      setError(null);
      try {
        const resp = await fetch(`/api/todos/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!resp.ok) {
          const j = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${resp.status}`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'action failed');
      }
    },
    [load],
  );

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Задачи (TodoDb)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Повторяющиеся напоминания и разовые задачи. Хранятся в{' '}
          <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">.data/todos.sqlite</code>.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">Новая задача</label>
        <input
          className="mt-1 w-full rounded border border-neutral-300 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          type="text"
          placeholder="Текст задачи…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={submitting}
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <fieldset className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">Повтор</span>
            <div className="mt-1 flex gap-3">
              {(['none', 'daily', 'weekly', 'hourly'] as FormRecurring[]).map((r) => (
                <label key={r} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="recurring"
                    checked={recurring === r}
                    onChange={() => setRecurring(r)}
                    disabled={submitting}
                  />
                  {r === 'none' ? 'разово' : r === 'daily' ? 'день' : r === 'weekly' ? 'неделя' : 'час'}
                </label>
              ))}
            </div>
          </fieldset>

          {recurring === 'hourly' && (
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-neutral-500">каждые N ч</span>
              <input
                className="mt-1 w-16 rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                type="number"
                min={1}
                max={168}
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value) || 1)}
                disabled={submitting}
              />
            </label>
          )}

          <button
            className="ml-auto rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={add}
            disabled={submitting || !text.trim()}
          >
            Добавить
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Задачи ({todos.length})
          </h2>
          <button className="text-xs text-accent hover:underline" onClick={load} disabled={loading}>
            обновить
          </button>
        </div>

        {todos.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            {loading ? 'Загрузка…' : 'Нет задач. Добавьте первую выше.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {todos.map((t) => {
              const badge = recurringBadge(t);
              const dim = t.status !== 'pending';
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span
                    className={`mt-0.5 rounded px-1.5 py-0.5 text-xs ${
                      t.status === 'done'
                        ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                        : t.status === 'dismissed'
                          ? 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                          : 'bg-accent/10 text-accent'
                    }`}
                  >
                    {t.status === 'done' ? 'done' : t.status === 'dismissed' ? 'dismissed' : 'pending'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`break-words ${dim ? 'text-neutral-400 line-through' : ''}`}>{t.text}</div>
                    {badge && <div className="mt-0.5 text-xs text-neutral-400">{badge}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      title="Выполнить"
                      className="rounded px-2 py-0.5 text-xs hover:bg-green-100 dark:hover:bg-green-950"
                      onClick={() => void act(t.id, 'complete')}
                    >
                      ✓
                    </button>
                    <button
                      title="Отменить"
                      className="rounded px-2 py-0.5 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800"
                      onClick={() => void act(t.id, 'dismiss')}
                    >
                      ✗
                    </button>
                    <button
                      title="Удалить"
                      className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
                      onClick={() => void act(t.id, 'delete')}
                    >
                      🗑
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
