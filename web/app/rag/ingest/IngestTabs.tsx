'use client';

// IngestTabs — «База знаний» /rag/ingest (rag-ingest, П-3). Один клиентский остров,
// три таба-источника (Заметка | Файл | Telegram) + полоса «Что в базе».
//
// Контракты (роуты — пакет П-2):
//   POST   /api/rag/notes — JSON {title, text} ИЛИ formData file → {ok, source, title, chunks};
//   DELETE /api/rag/notes — JSON {source} → {ok, deleted};
//   GET    /api/rag/notes — полоса «что в базе»: {partitions: {fixed, structure,
//          telegram, notes, docs, faq}, notes: [{source, title, chunks}]} (живой контракт
//          П-2 — карта счётчиков, dim/telegramChats не экспонируются).
// Вкладка Telegram — клиентский чейн СУЩЕСТВУЮЩИХ SSE-роутов (прецедент FullPipelineRun):
//   фаза 1: POST /api/tg/collect  {chatRef, topicId?} — reset/limit НЕ передаются вовсе;
//   фаза 2: POST /api/rag/index-tg {chatRef, topicId?} — тело по минимуму, БЕЗ reset/top/limit.
//   ⚠️ LANDMINE (reset:true → clearStrategy('telegram')) из этого UI недостижим: поля reset
//   ни в одной форме нет. Опасные режимы — только на старой служебной /rag/index-tg.
// 0 импортов core/ и server-only (инвариант админки); превалидация файла — shared
// noteFileError из lib/shared/forms (без server-only, единые тексты с роутом П-2).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { noteFileError } from '../../../lib/shared/forms';
import type { SseRagIndexTgEvent, SseTgCollectEvent } from '../../../lib/shared/sse';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../components/ui/Toast';
import { IconCheck } from '../../components/ui/icons';

// --- локальные типы живого контракта полосы «Что в базе» (GET /api/rag/notes,
// роут — П-2): счётчики всех партиций картой + список заметок {source,title,chunks} ---
type StrategyKey = 'fixed' | 'structure' | 'telegram' | 'notes' | 'docs' | 'faq';
interface StatsNote {
  source: string;
  title: string;
  chunks: number;
}
interface RagStats {
  ok?: boolean;
  partitions: Partial<Record<StrategyKey, number>>;
  notes: StatsNote[];
}

// Превалидация файла — shared noteFileError (без server-only, единые тексты с роутом).

// «1 фрагмент / 2 фрагмента / 5 фрагментов» — без dev-жаргона («чанк» запрещён).
function fragmentsLabel(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} фрагмент`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} фрагмента`;
  return `${n} фрагментов`;
}

// --- SSE-хелперы: копия readSseStream/postSse из FullPipelineRun (тот же контракт) ---
async function readSseStream<T>(resp: Response, onEvent: (ev: T) => void): Promise<void> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error(`HTTP ${resp.status}: пустой поток`);
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep).trim();
      buf = buf.slice(sep + 2);
      if (!raw.startsWith('data:')) continue;
      const dataLine = raw.slice(5).trim();
      if (!dataLine) continue;
      let ev: T;
      try {
        ev = JSON.parse(dataLine) as T;
      } catch {
        continue;
      }
      onEvent(ev);
    }
  }
}

async function postSse<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (ev: T) => void,
): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  await readSseStream(resp, onEvent);
}

const TITLE_MAX = 120;
const TEXT_MAX = 20000;

type TabId = 'note' | 'file' | 'telegram';
type TgPhase = 'idle' | 'collect' | 'index';

interface DoneInfo {
  title: string;
  chunks: number;
}

export function IngestTabs() {
  const { toast } = useToast();

  const [tab, setTab] = useState<TabId>('note');

  // Полоса «Что в базе» — refetch после каждой мутации.
  const [stats, setStats] = useState<RagStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const refreshStats = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch('/api/rag/notes');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats((await r.json()) as RagStats);
      setStatsError(null);
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Не удалось загрузить состав базы');
    }
  }, []);
  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  // --- вкладка «Заметка» ---
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteDone, setNoteDone] = useState<DoneInfo | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  const addNote = async (): Promise<void> => {
    if (!noteTitle.trim() || !noteText.trim() || noteBusy) return;
    setNoteBusy(true);
    setNoteError(null);
    setNoteDone(null);
    try {
      const resp = await fetch('/api/rag/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: noteTitle.trim(), text: noteText.trim() }),
      });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        title?: string;
        chunks?: number;
        error?: string;
      };
      if (!resp.ok || !j.ok) {
        // Ошибка не стирает введённый текст — правишь и повторяешь (паттерн DigestComposer).
        const m = j.error ?? `HTTP ${resp.status}`;
        setNoteError(m);
        toast('err', m);
        return;
      }
      const chunks = typeof j.chunks === 'number' ? j.chunks : 0;
      setNoteDone({ title: j.title ?? noteTitle.trim(), chunks });
      toast('ok', `Добавлено ${fragmentsLabel(chunks)}`);
      setNoteTitle('');
      setNoteText('');
      void refreshStats();
    } catch {
      const m = 'Сеть недоступна — попробуйте ещё раз';
      setNoteError(m);
      toast('err', m);
    } finally {
      setNoteBusy(false);
    }
  };

  // --- вкладка «Файл» ---
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileDone, setFileDone] = useState<DoneInfo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const onFilePick = (picked: File | null): void => {
    setFileDone(null);
    setFileError(null);
    if (!picked) {
      setFile(null);
      setFileProblem(null);
      return;
    }
    const problem = noteFileError(picked.name, picked.size);
    setFileProblem(problem);
    setFile(problem ? null : picked);
  };

  const addFile = async (): Promise<void> => {
    if (!file || fileBusy) return;
    setFileBusy(true);
    setFileError(null);
    setFileDone(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/rag/notes', { method: 'POST', body: fd });
      const j = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        title?: string;
        chunks?: number;
        error?: string;
      };
      if (!resp.ok || !j.ok) {
        const m = j.error ?? `HTTP ${resp.status}`;
        setFileError(m);
        toast('err', m);
        return;
      }
      const chunks = typeof j.chunks === 'number' ? j.chunks : 0;
      setFileDone({ title: j.title ?? file.name, chunks });
      toast('ok', `Добавлено ${fragmentsLabel(chunks)}`);
      setFile(null);
      void refreshStats();
    } catch {
      const m = 'Сеть недоступна — попробуйте ещё раз';
      setFileError(m);
      toast('err', m);
    } finally {
      setFileBusy(false);
    }
  };

  // --- вкладка «Telegram» (чейн collect → index-tg, обе фазы SSE) ---
  const [chatRef, setChatRef] = useState('');
  const [topicId, setTopicId] = useState('');
  const [tgPhase, setTgPhase] = useState<TgPhase>('idle');
  const [tgProgress, setTgProgress] = useState('');
  const [tgDone, setTgDone] = useState<DoneInfo | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tgRunning = tgPhase !== 'idle';

  const addChat = useCallback(async (): Promise<void> => {
    const ref = chatRef.trim();
    if (!ref || tgRunning) return;
    setTgError(null);
    setTgDone(null);
    setTgProgress('');
    const ac = new AbortController();
    abortRef.current = ac;
    // Минимальное тело: reset/limit/top НЕ передаются ни в один роут — дефолты сервера
    // безопасны (collect: reset=false; index-tg: whole-chat чистит только этот чат).
    const body = {
      chatRef: ref,
      topicId: topicId.trim() !== '' && Number.isFinite(Number(topicId)) ? Number(topicId) : undefined,
    };
    try {
      // Фаза 1 — сбор сообщений чата (SSE: start → progress → done|error).
      setTgPhase('collect');
      setTgProgress('сбор…');
      const collectEvents: SseTgCollectEvent[] = [];
      await postSse<SseTgCollectEvent>('/api/tg/collect', body, ac.signal, (ev) => {
        collectEvents.push(ev);
        if (ev.type === 'stage' && ev.step === 'progress') {
          setTgProgress(`сбор… ${ev.detail?.fetched ?? 0}`);
        }
      });
      const cErr = collectEvents.find((e): e is Extract<SseTgCollectEvent, { type: 'error' }> => e.type === 'error');
      if (cErr) throw new Error(cErr.message);

      // Фаза 2 — добавление в базу (SSE: start → progress indexed/total → done|error).
      setTgPhase('index');
      setTgProgress('добавляем в базу…');
      const indexEvents: SseRagIndexTgEvent[] = [];
      await postSse<SseRagIndexTgEvent>('/api/rag/index-tg', body, ac.signal, (ev) => {
        indexEvents.push(ev);
        if (ev.type === 'stage' && ev.step === 'progress' && ev.detail?.indexed != null) {
          setTgProgress(`добавляем в базу… ${ev.detail.indexed}/${ev.detail.total ?? '?'}`);
        }
      });
      const iErr = indexEvents.find((e): e is Extract<SseRagIndexTgEvent, { type: 'error' }> => e.type === 'error');
      if (iErr) throw new Error(iErr.message);
      const iDone = indexEvents.find((e): e is Extract<SseRagIndexTgEvent, { type: 'done' }> => e.type === 'done');
      if (!iDone) throw new Error('Чат обработан, но результат не получен');
      const cDone = collectEvents.find((e): e is Extract<SseTgCollectEvent, { type: 'done' }> => e.type === 'done');
      setTgDone({ title: cDone?.chatKey ?? ref, chunks: iDone.indexed });
      toast('ok', `Добавлено ${fragmentsLabel(iDone.indexed)}`);
      void refreshStats();
    } catch (e) {
      const m =
        e instanceof DOMException && e.name === 'AbortError'
          ? 'Отменено'
          : e instanceof Error
            ? e.message
            : 'Не удалось добавить чат';
      setTgError(m);
      if (m !== 'Отменено') toast('err', m);
    } finally {
      setTgPhase('idle');
      setTgProgress('');
      abortRef.current = null;
    }
  }, [chatRef, topicId, tgRunning, toast, refreshStats]);

  // --- удаление заметки (ConfirmDialog, danger) ---
  const [pendingDelete, setPendingDelete] = useState<StatsNote | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteNote = async (): Promise<void> => {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const resp = await fetch('/api/rag/notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: target.source }),
      });
      const j = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!resp.ok || !j.ok) {
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      toast('ok', 'Заметка удалена из базы');
      setPendingDelete(null);
      void refreshStats();
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Не удалось удалить заметку';
      toast('err', m);
      throw e; // ConfirmDialog остаётся открытым, ошибка уже показана тостом
    } finally {
      setDeleting(false);
    }
  };

  // --- производные значения полосы «Что в базе» ---
  const counts = stats?.partitions ?? {};
  const structureChunks = counts.structure ?? 0;
  const notesChunks = counts.notes ?? 0;
  const telegramChunks = counts.telegram ?? 0;
  const otherPartitions: Array<{ strategy: StrategyKey; chunks: number }> = (
    ['fixed', 'docs', 'faq'] as StrategyKey[]
  ).map((s) => ({ strategy: s, chunks: counts[s] ?? 0 }));

  return (
    <div className="space-y-6">
      {/* --- табы-источники + форма активного источника --- */}
      <div className="space-y-3">
        <Tabs
          label="Источник добавления"
          tabs={[
            { id: 'note', label: 'Заметка' },
            { id: 'file', label: 'Файл' },
            { id: 'telegram', label: 'Telegram' },
          ]}
          active={tab}
          onChange={(id) => setTab(id as TabId)}
        />

        {/* Вкладка «Заметка» */}
        {tab === 'note' && (
          <Card label="Новая заметка">
            <Field id="note-title" label="Название" hint="Повторное добавление с тем же названием обновит заметку.">
              <input
                className={`w-full ${INPUT_CLASS}`}
                maxLength={TITLE_MAX}
                placeholder="Например: Идеи для виджетов"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                disabled={noteBusy}
              />
            </Field>
            <div className="mt-1 text-right font-mono text-[11px] tabular-nums text-dim">
              {noteTitle.length} / {TITLE_MAX}
            </div>
            <div className="mt-3">
              <Field id="note-text" label="Текст заметки">
                <Textarea
                  value={noteText}
                  onValueChange={setNoteText}
                  max={TEXT_MAX}
                  warnAt={18000}
                  rows={8}
                  placeholder="Текст заметки…"
                  disabled={noteBusy}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Button variant="primary" loading={noteBusy} onClick={() => void addNote()} disabled={!noteTitle.trim() || !noteText.trim()}>
                Добавить в базу
              </Button>
            </div>
            {noteDone && (
              <SuccessCard chunks={noteDone.chunks} />
            )}
            {noteError && (
              <ErrorNote message={noteError} />
            )}
          </Card>
        )}

        {/* Вкладка «Файл» */}
        {tab === 'file' && (
          <Card label="Новый файл">
            <Field
              id="note-file"
              label="Файл"
              hint="Текстовый файл .txt или .md, до 512 КБ. Название заметки возьмётся из имени файла."
              error={fileProblem ?? undefined}
            >
              <input
                type="file"
                accept=".txt,.md,.markdown"
                className={`w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface-2 file:px-2.5 file:py-1 file:text-xs file:text-ink ${INPUT_CLASS}`}
                onChange={(e) => onFilePick(e.target.files?.[0] ?? null)}
                disabled={fileBusy}
              />
            </Field>
            <div className="mt-4">
              <Button variant="primary" loading={fileBusy} onClick={() => void addFile()} disabled={!file}>
                Добавить в базу
              </Button>
            </div>
            {fileDone && <SuccessCard chunks={fileDone.chunks} />}
            {fileError && <ErrorNote message={fileError} />}
          </Card>
        )}

        {/* Вкладка «Telegram» — чейн collect → index-tg под одной кнопкой */}
        {tab === 'telegram' && (
          <Card label="Чат Telegram">
            <Field
              id="tg-chat-ref"
              label="Чат"
              hint="Публичный канал через @, ссылка t.me или внутренний идентификатор -100… Требуется настроенный MTProto на сервере."
            >
              <input
                className={`w-full font-mono text-xs ${INPUT_CLASS}`}
                placeholder="@канал или ссылка t.me…"
                value={chatRef}
                onChange={(e) => setChatRef(e.target.value)}
                disabled={tgRunning}
              />
            </Field>
            <details className="mt-3 rounded-md border border-line bg-surface p-3">
              <summary className="cursor-pointer text-xs font-medium text-dim">Расширенные настройки</summary>
              <div className="mt-3">
                <Field
                  id="tg-topic-id"
                  label="Тема (topicId)"
                  hint="Необязательно. Пусто — добавляется весь чат."
                >
                  <input
                    className={`w-28 ${INPUT_CLASS}`}
                    inputMode="numeric"
                    placeholder="общий"
                    value={topicId}
                    onChange={(e) => setTopicId(e.target.value)}
                    disabled={tgRunning}
                  />
                </Field>
              </div>
            </details>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                loading={tgRunning}
                onClick={() => void addChat()}
                disabled={!chatRef.trim()}
              >
                Добавить чат
              </Button>
              <Button variant="ghost" onClick={() => abortRef.current?.abort()} disabled={!tgRunning}>
                Стоп
              </Button>
            </div>
            {tgRunning && (
              <p className="mt-3 flex items-center gap-2 font-mono text-xs text-dim" role="status" aria-live="polite">
                <span
                  className="spin inline-block h-3 w-3 rounded-full border border-line-strong border-t-accent"
                  aria-hidden
                />
                {tgPhase === 'collect' ? 'Собираю сообщения чата…' : 'Добавляю в базу…'}
                {tgProgress ? ` · ${tgProgress}` : ''}
              </p>
            )}
            {tgDone && <SuccessCard chunks={tgDone.chunks} title={tgDone.title} />}
            {tgError && <ErrorNote message={tgError} />}
          </Card>
        )}
      </div>

      {/* --- полоса «Что в базе»: счётчики + список заметок с удалением --- */}
      <Card label="что в базе">
        {statsError && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-err">Состав базы не загрузился: {statsError}</p>
            <Button size="sm" onClick={() => void refreshStats()}>
              Обновить
            </Button>
          </div>
        )}
        {!statsError && stats === null && (
          <div className="space-y-2">
            <Skeleton variant="line" />
            <Skeleton variant="line" />
            <Skeleton variant="line" />
          </div>
        )}
        {stats !== null && (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-dim">
              <span>
                Руководство{' '}
                <span className="font-medium tabular-nums text-ink">{structureChunks}</span>
              </span>
              <span>
                Заметки{' '}
                <span data-testid="notes-count" className="font-medium tabular-nums text-ink">
                  {notesChunks}
                </span>
              </span>
              <span>
                Telegram{' '}
                <span className="font-medium tabular-nums text-ink">{telegramChunks}</span>
              </span>
            </div>

            <div className="mt-4">
              {stats.notes.length === 0 ? (
                <EmptyState
                  title="Заметок пока нет."
                  hint="Добавьте первую на вкладке «Заметка» — она сразу появится в этом списке."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {stats.notes.map((n) => (
                    <li key={n.source} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{n.title}</span>
                        <span className="font-mono text-[11px] text-dim">{fragmentsLabel(n.chunks)}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setPendingDelete(n)}
                        aria-label={`Удалить ${n.title}`}
                        className="shrink-0"
                      >
                        удалить
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <details className="mt-3 rounded-md border border-line bg-surface p-3">
              <summary className="cursor-pointer text-xs font-medium text-dim">Технические детали</summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
                {otherPartitions.map((p) => (
                  <div key={p.strategy} className="contents">
                    <dt className="font-mono text-dim">{p.strategy}</dt>
                    <dd className="tabular-nums text-ink">{p.chunks}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                Отдельные TG-чаты и их объёмы — в{' '}
                <Link href="/rag/chats" className="text-accent hover:underline">
                  каталоге чатов
                </Link>
                .
              </p>
            </details>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={deleteNote}
        title="Удалить заметку из базы?"
        confirmLabel="Удалить"
        tone="danger"
        body={
          <div className="space-y-2 text-sm">
            <p className="text-ink">{pendingDelete?.title}</p>
            <p className="text-xs text-dim">
              Из базы исчезнут все её фрагменты ({pendingDelete ? fragmentsLabel(pendingDelete.chunks) : ''}).
              Текст заметки останется у вас — при необходимости добавьте её заново.
            </p>
          </div>
        }
      />
    </div>
  );
}

// Зелёная карточка успеха: «Добавлено N фрагментов» + честные ссылки проверки
// (/rag/chat — чат базы знаний; /demo заметки НЕ видит — публичная витрина смотрит
// только на руководство, поэтому ссылку на /demo не даём).
function SuccessCard({ chunks, title }: { chunks: number; title?: string }) {
  return (
    <section className="mt-4 rounded-md border border-ok/40 bg-ok/10 p-4 text-sm" role="status">
      <h3 className="flex items-center gap-2 font-medium text-ok">
        <span aria-hidden="true" className="shrink-0">
          <IconCheck />
        </span>
        Добавлено {fragmentsLabel(chunks)}
        {title ? <span className="min-w-0 truncate font-normal text-ink">· {title}</span> : null}
      </h3>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <Link href="/rag/chat" className="text-accent hover:underline">
          Спросить в чате базы
        </Link>
        <Link href="/rag" className="text-accent hover:underline">
          Открыть RAG-поиск
        </Link>
      </p>
    </section>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err" role="alert">
      {message}
    </p>
  );
}
