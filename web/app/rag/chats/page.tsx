// /rag/chats — каталог TG-чатов и aliases. web P3a.
// 'use client': GET /api/rag/chats (titles + aliases + dialog-chats), POST add/rm alias.
// Редизайн C (день 30): 3 data-list таблицы + Card-форма. Логика без изменений.
// Все offline (chatCatalog JSON-кэш из index-tg + alias-файл), без сетевых вызовов к TG.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { INPUT_CLASS } from '../../components/ui/Field';
import { SectionHead } from '../../components/ui/SectionHead';

interface AliasRow {
  name: string;
  chatKey: string;
  topicId?: number;
}
interface DialogChatItem {
  id: string;
  title: string;
  msg_count: number;
  updated_at: string;
}
interface Catalog {
  titles: Record<string, string>;
  aliases: AliasRow[];
  chats: DialogChatItem[];
}

export default function RagChatsPage() {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [chatKey, setChatKey] = useState('');
  const [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const r = await fetch('/api/rag/chats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as Catalog);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (action: 'add' | 'rm', payload: { name: string; chatKey?: string; topicId?: number }): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/rag/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setName(''); setChatKey(''); setTopicId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(false);
    }
  };

  const titleEntries = data ? Object.entries(data.titles) : [];

  return (
    <div className="space-y-8">
      <SectionHead
        code="rag · chats"
        title="Каталог чатов"
        description="Кэш названий чатов и aliases для RAG-чата (только чтение)."
      />

      {error && (
        <Card tone="danger">
          <p className="text-sm text-err">{error}</p>
        </Card>
      )}

      {/* Add alias */}
      <Card label="add alias">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">Имя</span>
            <input
              className={`mt-1 ${INPUT_CLASS} w-40`}
              value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
              placeholder="news_ru"
            />
          </label>
          <label className="flex-1 text-sm">
            <span className="block text-xs font-medium text-dim">chatKey</span>
            <input
              className={`mt-1 ${INPUT_CLASS} w-full font-mono text-xs`}
              list="chatkey-dl"
              value={chatKey} onChange={(e) => setChatKey(e.target.value)} disabled={busy}
              placeholder="-1001234567890"
            />
            <datalist id="chatkey-dl">
              {titleEntries.map(([k]) => <option key={k} value={k} />)}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-dim">topicId (опц.)</span>
            <input
              className={`mt-1 ${INPUT_CLASS} w-24`}
              value={topicId} onChange={(e) => setTopicId(e.target.value)} disabled={busy}
            />
          </label>
          <Button
            variant="primary"
            onClick={() => void submit('add', { name: name.trim(), chatKey: chatKey.trim(), topicId: topicId ? Number(topicId) : undefined })}
            disabled={busy || !name.trim() || !chatKey.trim()}
          >
            добавить
          </Button>
        </div>
      </Card>

      {/* Aliases */}
      <section>
        <SectionLabel>{data ? `aliases · ${data.aliases.length}` : 'aliases'}</SectionLabel>
        {!data ? (
          <p className="text-sm text-dim">Загрузка…</p>
        ) : data.aliases.length === 0 ? (
          <EmptyState title="Нет aliases." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 text-xs font-medium text-dim">name</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">chatKey</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">topic</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">title</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.aliases.map((a) => (
                  <tr key={a.name} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
                    <td className="px-3 py-2 font-medium text-ink">{a.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-dim">{a.chatKey}</td>
                    <td className="px-3 py-2 font-mono text-xs text-dim">{a.topicId != null ? a.topicId : '—'}</td>
                    <td className="px-3 py-2 text-dim">{data.titles[a.chatKey] ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="danger"
                        onClick={() => void submit('rm', { name: a.name })}
                        disabled={busy}
                      >
                        удалить
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Titles catalog */}
      <section>
        <SectionLabel>{data ? `chatkey → title · ${titleEntries.length}` : 'chatkey → title'}</SectionLabel>
        {!data ? (
          <p className="text-sm text-dim">Загрузка…</p>
        ) : titleEntries.length === 0 ? (
          <EmptyState
            title="Кэш пуст."
            hint={<>Наполняется при индексации TG (<code className="font-mono text-[12px] text-ink">rag index-tg</code>).</>}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 text-xs font-medium text-dim">chatKey</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">title</th>
                </tr>
              </thead>
              <tbody>
                {titleEntries.map(([k, t]) => (
                  <tr key={k} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
                    <td className="px-3 py-2 font-mono text-xs text-dim">{k}</td>
                    <td className="px-3 py-2 text-ink">{t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* DialogDb chats */}
      <section>
        <SectionLabel>{data ? `rag-чаты · ${data.chats.length}` : 'rag-чаты'}</SectionLabel>
        {!data ? (
          <p className="text-sm text-dim">Загрузка…</p>
        ) : data.chats.length === 0 ? (
          <EmptyState
            title="Нет чатов."
            hint={<>Создайте на <a href="/rag/chat" className="text-accent hover:underline">/rag/chat</a>.</>}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 text-xs font-medium text-dim">id</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">title</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">messages</th>
                  <th className="px-3 py-2 text-xs font-medium text-dim">updated</th>
                </tr>
              </thead>
              <tbody>
                {data.chats.map((c) => (
                  <tr key={c.id} className="border-b border-line transition-colors duration-150 hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <a href={`/rag/chat/${c.id}`} className="font-mono text-xs text-accent hover:underline">{c.id.slice(0, 8)}</a>
                    </td>
                    <td className="px-3 py-2 text-ink">{c.title}</td>
                    <td className="px-3 py-2 font-mono text-xs text-dim">{c.msg_count}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-dim">{c.updated_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
