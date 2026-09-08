// Dashboard (/dashboard) — server component (ТЗ §8.3): хаб админки.
// (а) Быстрые действия: «Новый пост в TG» (J1), «Черновики блога» (J2),
//     «История публикаций» (J3); (б) статус-строка ключей + tg configured
//     (getKeysStatus — только флаги/мета, значения секретов NEVER); (в) тайлы
//     статистики (live-БД). Все обращения к БД — server-only singletons +
//     withDb(). force-dynamic: читает live-данные каждый запрос.
import Link from 'next/link';
import type { Metadata } from 'next';
import type { ComponentType, ReactNode } from 'react';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, withDb } from '../../lib/server/db';
import { getKeysStatus } from '../../lib/server/env';
import { SectionHead } from '../components/ui/SectionHead';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Card } from '../components/ui/Card';
import { Tile } from '../components/ui/Tile';
import { StatusDot } from '../components/ui/StatusDot';
import { IconEdit, IconHistory, IconSend } from '../components/ui/icons';

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

// Быстрое действие — интерактивная карточка-ссылка (путь ≤ 1 клика от /dashboard, ТЗ G1).
// Контракт «интерактив vs инфо»: тень+hover+стрелка = можно нажать (Card variant="interactive").
function QuickAction({
  href,
  icon: Icon,
  title,
  desc,
}: {
  href: string;
  icon: ComponentType;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <Card variant="interactive" arrow className="h-full">
        <span className="flex items-center gap-2 font-sans text-sm font-semibold text-ink">
          <span aria-hidden="true" className="text-accent">
            <Icon />
          </span>
          {title}
        </span>
        <span className="mt-1 block text-sm leading-snug text-dim group-hover:text-ink">{desc}</span>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const [stats, keys] = await Promise.all([readStats(), Promise.resolve(getKeysStatus())]);
  const ragTotal = stats.ragFixed + stats.ragStructure + stats.ragTelegram;
  const deepseekOn = keys.cloud.configured && keys.cloud.provider === 'DeepSeek';
  const openrouterOn = keys.cloud.configured && keys.cloud.provider === 'OpenRouter';

  const statusLine: Array<{ status: 'ok' | 'off'; label: ReactNode }> = [
    { status: deepseekOn ? 'ok' : 'off', label: 'DeepSeek' },
    { status: openrouterOn ? 'ok' : 'off', label: 'OpenRouter' },
    { status: keys.local.configured ? 'ok' : 'off', label: 'Local LLM · Ollama' },
    { status: keys.embed.configured ? 'ok' : 'off', label: 'Embeddings' },
    { status: keys.mtproto.configured ? 'ok' : 'off', label: 'MTProto · userbot' },
    {
      status: keys.botApi.configured ? 'ok' : 'off',
      label: keys.botApi.channelLabel ? `Bot API · ${keys.botApi.channelLabel}` : 'Bot API',
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHead
        code="dashboard · live"
        title="Dashboard"
        description="Ключи показаны только как факт настройки — значения секретов не отображаются."
      />

      {/* ── Быстрые действия (J1/J2/J3) ── */}
      <section>
        <SectionLabel>быстрые действия</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickAction
            href="/telegram/publish"
            icon={IconSend}
            title="Новый пост в TG"
            desc="Компоузер: разметка, превью, подтверждение, отправка"
          />
          <QuickAction
            href="/blog/posts"
            icon={IconEdit}
            title="Черновики блога"
            desc="Правка постов и публикация в канал из карточки"
          />
          <QuickAction
            href="/telegram/publish#history"
            icon={IconHistory}
            title="История публикаций"
            desc="Outbox: что ушло, message_id, ошибки"
          />
        </div>
      </section>

      {/* ── Статус: ключи + tg configured (Boolean only, values NEVER) ── */}
      <section>
        <SectionLabel>Ключи и сервисы</SectionLabel>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {statusLine.map((s) => (
            <StatusDot key={String(s.label)} status={s.status} label={s.label} />
          ))}
        </div>
      </section>

      {/* ── Active model (public-мета, не секрет) ── */}
      <section>
        <SectionLabel>Модель</SectionLabel>
        {keys.activeModel ? (
          <StatusDot status="ok" label={`${keys.activeProvider ?? 'model'} · ${keys.activeModel}`} />
        ) : (
          <StatusDot status="warn" label="LLM не настроен — задайте ключи в .env" />
        )}
      </section>

      {/* ── DB stats ── */}
      <section>
        <SectionLabel>Базы данных</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="новости" value={stats.news} />
          <Tile label="посты" value={stats.posts} />
          <Tile label="стиль" value={stats.styleSamples} />
          <Tile
            label="rag"
            value={ragTotal}
            hint={`f ${stats.ragFixed} · s ${stats.ragStructure} · tg ${stats.ragTelegram}`}
          />
          <Tile label="tg сообщения" value={stats.tgMessages} hint={`${stats.tgChats} chats · ${stats.tgTopics} topics`} />
          <Tile label="диалоги" value={stats.dialogChats} hint={`${stats.dialogMessages} msg`} />
        </div>
      </section>
    </div>
  );
}
