// /mcp/todos — CRUD задач через TodoDb (день 28, web P1).
// 'use client': форма добавления + список с действиями ✓/✗/🗑. Перезагрузка списка после
// каждого действия. НИКАКИХ импортов core/ — тип TodoRow инлайн (сервер отдаёт тот же JSON).
// Редизайн C (день 30): Card-форма + data-list с StatusDot. Логика без изменений.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusDot } from '../../components/ui/StatusDot';

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

const INPUT =
  'rounded border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink placeholder:text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50';
const LABEL_TAG = 'block font-mono text-xs uppercase tracking-wider text-dim';

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
    <div className="space-y-8">
      <section>
        <SectionLabel>todos · todos.sqlite</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Задачи</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Повторяющиеся напоминания и разовые задачи. Хранятся в{' '}
          <code className="font-mono text-[12px] text-ink">.data/todos.sqlite</code>.
        </p>
      </section>

      <Card label="new task">
        <label className="block text-sm">
          <span className={LABEL_TAG}>Текст задачи</span>
          <input
            className={`mt-1 w-full ${INPUT}`}
            type="text"
            placeholder="Текст задачи…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <fieldset className="text-sm">
            <span className={LABEL_TAG}>Повтор</span>
            <div className="mt-1 flex gap-3">
              {(['none', 'daily', 'weekly', 'hourly'] as FormRecurring[]).map((r) => (
                <label key={r} className="flex items-center gap-1 text-dim">
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
              <span className={LABEL_TAG}>каждые N ч</span>
              <input
                className={`mt-1 w-16 ${INPUT}`}
                type="number"
                min={1}
                max={168}
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value) || 1)}
                disabled={submitting}
              />
            </label>
          )}

          <Button
            variant="primary"
            className="ml-auto"
            onClick={add}
            disabled={submitting || !text.trim()}
          >
            Добавить
          </Button>
        </div>
      </Card>

      {error && (
        <p className="rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">{error}</p>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>{`задачи · ${todos.length}`}</SectionLabel>
          <Button variant="ghost" onClick={load} disabled={loading}>
            {loading ? 'загрузка…' : 'обновить'}
          </Button>
        </div>

        {todos.length === 0 ? (
          <p className="text-sm text-dim">
            {loading ? 'Загрузка…' : 'Нет задач. Добавьте первую выше.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {todos.map((t) => {
              const badge = recurringBadge(t);
              const dim = t.status !== 'pending';
              const status = t.status === 'done' ? 'ok' : t.status === 'dismissed' ? 'off' : 'warn';
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-md border border-line bg-surface p-3 text-sm"
                >
                  <StatusDot status={status} label={t.status} />
                  <div className="min-w-0 flex-1">
                    <div className={`break-words ${dim ? 'text-dim line-through' : 'text-ink'}`}>{t.text}</div>
                    {badge && <div className="mt-0.5 font-mono text-xs text-dim">{badge}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      title="Выполнить"
                      className="rounded border border-line-strong px-2 py-0.5 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
                      onClick={() => void act(t.id, 'complete')}
                    >
                      ✓
                    </button>
                    <button
                      title="Отменить"
                      className="rounded border border-line-strong px-2 py-0.5 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
                      onClick={() => void act(t.id, 'dismiss')}
                    >
                      ✗
                    </button>
                    <button
                      title="Удалить"
                      className="rounded border border-line-strong px-2 py-0.5 text-xs text-err transition-colors hover:bg-err/10 disabled:opacity-50"
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
