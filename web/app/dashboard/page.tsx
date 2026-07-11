// Dashboard (/dashboard) — server component, force-dynamic (читает live-БД каждый запрос).
// Переехал 1:1 из app/page.tsx (день 30: / отдал под лендинг Артемия).
//
// Виджеты: счётчики БД (news/posts/style + RAG-чанки по стратегиям + TG-сообщения +
// dialog-чаты/сообщения) и статус ключей БЕЗ значений (DeepSeek ✓/✗, OpenRouter,
// Local LLM, MTProto configured, Bot API) + активная модель. Все обращения к БД —
// через server-only singletons (web/lib/server/db.ts), пути — dataPath().
import Link from 'next/link';
import type { Metadata } from 'next';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, withDb } from '../../lib/server/db';
import { getKeysStatus } from '../../lib/server/env';
import { capabilitySections } from '../../data/showcase';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

interface DashboardStats {
  news: number;
  posts: number;
  styleSamples: number;
  ragFixed: number;
  ragStructure: number;
  ragTelegram: number;
  tgMessages: number;
  tgTopics: number;
  tgChats: number;
  dialogChats: number;
  dialogMessages: number;
}

async function readStats(): Promise<DashboardStats> {
  return withDb(() => {
    const blog = getBlogDb();
    const rag = getRagStore();
    const tg = getTgStore();
    const dialog = getDialogDb();
    const tgStats = tg.stats();
    const chats = dialog.listChats(2000);
    return {
      news: blog.newsCount(),
      posts: blog.postsCount(),
      styleSamples: blog.styleSamplesCount(),
      ragFixed: rag.count('fixed'),
      ragStructure: rag.count('structure'),
      ragTelegram: rag.count('telegram'),
      tgMessages: tgStats.messages,
      tgTopics: tgStats.topics,
      tgChats: tgStats.chats,
      dialogChats: chats.length,
      dialogMessages: chats.reduce((sum, c) => sum + c.msg_count, 0),
    };
  });
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-neutral-400">{hint}</div> : null}
    </div>
  );
}

function KeyRow({ name, on, detail }: { name: string; on: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm">{name}</span>
      <span className="flex items-center gap-2">
        {detail ? <span className="text-xs text-neutral-400">{detail}</span> : null}
        <span className={on ? 'text-green-600 dark:text-green-400' : 'text-neutral-400'}>
          {on ? '✓' : '✗'}
        </span>
      </span>
    </div>
  );
}

export default async function DashboardPage() {
  const [stats, keys] = await Promise.all([readStats(), Promise.resolve(getKeysStatus())]);
  const ragTotal = stats.ragFixed + stats.ragStructure + stats.ragTelegram;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Состояние системы на день 30. Данные из <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">challenge/.data</code>.
        </p>
        {keys.activeModel ? (
          <p className="mt-2 text-sm">
            Активная модель:{' '}
            <span className="font-medium">
              {keys.activeModel}
              {keys.activeProvider ? <span className="text-neutral-400"> ({keys.activeProvider})</span> : null}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            LLM не настроен — задайте ключи в <code className="rounded bg-neutral-200 px-1 text-xs dark:bg-neutral-800">.env</code>.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">База знаний</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Новости" value={stats.news} />
          <Stat label="Посты" value={stats.posts} />
          <Stat label="Образцы стиля" value={stats.styleSamples} />
          <Stat
            label="RAG-чанки"
            value={ragTotal}
            hint={`fixed ${stats.ragFixed} · structure ${stats.ragStructure} · tg ${stats.ragTelegram}`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Диалоги и Telegram</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="TG-сообщения" value={stats.tgMessages} hint={`${stats.tgChats} чатов · ${stats.tgTopics} топиков`} />
          <Stat label="Dialog-чаты" value={stats.dialogChats} hint={`${stats.dialogMessages} сообщений`} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Статус ключей</h2>
          <p className="mt-1 text-xs text-neutral-400">Только факт настройки. Значения не показываются.</p>
          <div className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
            <KeyRow name="DeepSeek" on={keys.cloud.configured && keys.cloud.provider === 'DeepSeek'} detail={keys.cloud.provider === 'DeepSeek' ? keys.cloud.model : undefined} />
            <KeyRow name="OpenRouter" on={keys.cloud.configured && keys.cloud.provider === 'OpenRouter'} detail={keys.cloud.provider === 'OpenRouter' ? keys.cloud.model : undefined} />
            <KeyRow name="Local LLM (Ollama)" on={keys.local.configured} detail={keys.local.model} />
            <KeyRow name="Эмбеддинги" on={keys.embed.configured} detail={keys.embed.model} />
            <KeyRow name="MTProto (userbot)" on={keys.mtproto.configured} />
            <KeyRow name="Bot API (публикация)" on={keys.botApi.configured} />
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Разделы</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/showcase" className="text-accent hover:underline">
                Витрина возможностей →
              </Link>
              <span className="ml-2 text-xs text-neutral-400">что умеет система по модулям</span>
            </li>
            {capabilitySections.slice(0, 4).map((s) => (
              <li key={s.id} className="text-neutral-400">
                {s.title} <span className="text-xs">(P1+, скоро)</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
