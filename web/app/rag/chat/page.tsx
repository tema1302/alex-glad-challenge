// /rag/chat — выбор/создание RAG-чата (DialogDb). web P3a.
// 'use client': список чатов (GET /api/rag/chat) + форма создания (POST → redirect).
// Сессия персистится в dialog.sqlite (история + task state), переживает reload.
// Редизайн C (день 30): Card-форма + data-list ссылок. Логика без изменений.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, INPUT_CLASS } from '../../components/ui/Field';
import { SectionHead } from '../../components/ui/SectionHead';
import { useIsomorphicLayoutEffect, useSpaHistory } from '../../components/ui/useSpaHistory';
import {
  clearListSnapshot,
  consumeReturnFlag,
  readListSnapshot,
  readScroll,
  saveListSnapshot,
} from '../../../lib/shared/spaHistory';

interface DialogChatItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  msg_count: number;
}

// Ключ снапшота/якоря этой страницы (S2 «Back&scroll»): карточка чата
// инвалидирует именно его при будущих мутациях.
const LIST_PATH = '/rag/chat';

export default function RagChatPickerPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [chats, setChats] = useState<DialogChatItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // S2 «Back&scroll»: отметка SPA-истории + throttled scroll-якорь (список).
  useSpaHistory(pathname, { list: true });

  // Возврат через popstate: высота после коммита данных; ref переживает
  // StrictMode double-mount.
  const pendingScrollRef = useRef<number | null>(null);
  // Снапшот применён на mount → mount-fetch пропускаем; create чистит снапшот
  // перед redirect — возврат «← назад» рефетчит и видит новый чат.
  const fromSnapshotRef = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const r = await fetch('/api/rag/chat');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { chats: DialogChatItem[] };
      setChats(data.chats);
      // Снапшот для мгновенного возврата «← назад» из чата (TTL 60 с).
      saveListSnapshot(LIST_PATH, data.chats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  // Mount (до paint): свежий снапшот → мгновенный рендер без fetch.
  useIsomorphicLayoutEffect(() => {
    const snap = readListSnapshot<DialogChatItem[]>(LIST_PATH);
    const savedY = consumeReturnFlag() ? readScroll(LIST_PATH) : null;
    if (savedY !== null) pendingScrollRef.current = savedY;
    if (snap && Array.isArray(snap)) {
      setChats(snap);
      fromSnapshotRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (fromSnapshotRef.current) return;
    void load();
  }, [load]);

  // Возврат: высота восстановлена после коммита данных (снапшот или fetch).
  useEffect(() => {
    const y = pendingScrollRef.current;
    if (y === null || chats === null || chats.length === 0) return;
    pendingScrollRef.current = null;
    window.scrollTo(0, y);
  }, [chats]);

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || undefined }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { id: string };
      // Снапшот списка устарел (чат создан, но в нём его нет) — возврат
      // «← назад» должен рефетчить, а не показать список без нового чата.
      clearListSnapshot(LIST_PATH);
      router.push(`/rag/chat/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHead
        code="rag · dialog"
        title="RAG-чат"
        description="Многоходовый диалог по базе знаний: история и «память задачи» переживают перезагрузку."
      />

      <Card label="new chat">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="rag-chat-title" label="Заголовок (опц.)" className="min-w-0 flex-1">
            <input
              className={`w-full ${INPUT_CLASS}`}
              placeholder="untitled"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={creating}
            />
          </Field>
          <Button variant="primary" onClick={() => void create()} disabled={creating} className="w-full sm:w-auto">
            {creating ? 'создаю…' : 'Создать и открыть'}
          </Button>
        </div>
      </Card>

      {error && (
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      <section>
        <SectionLabel>{chats ? `чаты · ${chats.length}` : 'чаты'}</SectionLabel>
        {chats === null ? (
          <p className="text-sm text-dim">Загрузка…</p>
        ) : chats.length === 0 ? (
          <EmptyState title="Нет чатов." hint="Создайте первый выше." />
        ) : (
          <ul className="space-y-2">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/rag/chat/${c.id}`}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <Card variant="interactive" arrow>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-dim">
                      <span>{c.id.slice(0, 8)}</span>
                      <span>{c.msg_count} сообщений</span>
                      <span>{c.updated_at}</span>
                    </div>
                    <div className="mt-1 truncate font-medium text-ink">{c.title}</div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
