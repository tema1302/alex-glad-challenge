// Dashboard (/dashboard) — server component, force-dynamic (читает live-БД каждый запрос).
//
// Редизайн C (день 30): stat-grid через <Tile>, статус ключей через <StatusDot>
// (только Boolean configured + имя провайдера; значения ключей NEVER), активная
// модель — отдельным <StatusDot> (provider · model — public-мета, не секрет).
//
// Все обращения к БД — через server-only singletons (web/lib/server/db.ts), пути —
// dataPath(). Ключи — через getKeysStatus (web/lib/server/env.ts): наружу идут только
// configured-флаги и public-мета модели; сами значения/TG_SESSION не покидают env.ts.
import Link from 'next/link';
import type { Metadata } from 'next';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, withDb } from '../../lib/server/db';
import { getKeysStatus } from '../../lib/server/env';
import { capabilitySections } from '../../data/showcase';
import { Tile } from '../components/ui/Tile';
import { Card } from '../components/ui/Card';
import { SectionLabel } from '../components/ui/SectionLabel';
import { StatusDot } from '../components/ui/StatusDot';

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

export default async function DashboardPage() {
  const [stats, keys] = await Promise.all([readStats(), Promise.resolve(getKeysStatus())]);
  const ragTotal = stats.ragFixed + stats.ragStructure + stats.ragTelegram;
  const deepseekOn = keys.cloud.configured && keys.cloud.provider === 'DeepSeek';
  const openrouterOn = keys.cloud.configured && keys.cloud.provider === 'OpenRouter';

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>dashboard · live</SectionLabel>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-tight text-ink">Dashboard</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
          Состояние системы в реальном времени. Данные из локального{' '}
          <code className="font-mono text-[12px] text-ink">SQLite</code>-хранилища (вне git); ключи —
          только факт настройки, значения не светятся.
        </p>
      </section>

      {/* ── DB stats ── */}
      <section>
        <SectionLabel>db stats</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="news" value={stats.news} />
          <Tile label="posts" value={stats.posts} />
          <Tile label="style" value={stats.styleSamples} />
          <Tile
            label="rag"
            value={ragTotal}
            hint={`f ${stats.ragFixed} · s ${stats.ragStructure} · tg ${stats.ragTelegram}`}
          />
          <Tile label="tg msg" value={stats.tgMessages} hint={`${stats.tgChats} chats · ${stats.tgTopics} topics`} />
          <Tile label="dialog" value={stats.dialogChats} hint={`${stats.dialogMessages} msg`} />
        </div>
      </section>

      {/* ── Keys — Boolean only, values NEVER ── */}
      <section>
        <SectionLabel>keys · values hidden</SectionLabel>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <StatusDot status={deepseekOn ? 'ok' : 'off'} label="DeepSeek" />
          <StatusDot status={openrouterOn ? 'ok' : 'off'} label="OpenRouter" />
          <StatusDot status={keys.local.configured ? 'ok' : 'off'} label="Local LLM · Ollama" />
          <StatusDot status={keys.embed.configured ? 'ok' : 'off'} label="Embeddings" />
          <StatusDot status={keys.mtproto.configured ? 'ok' : 'off'} label="MTProto · userbot" />
          <StatusDot status={keys.botApi.configured ? 'ok' : 'off'} label="Bot API" />
        </div>
      </section>

      {/* ── Active model (public-мета, не секрет) ── */}
      <section>
        <SectionLabel>active model</SectionLabel>
        {keys.activeModel ? (
          <StatusDot status="ok" label={`${keys.activeProvider ?? 'model'} · ${keys.activeModel}`} />
        ) : (
          <StatusDot status="warn" label="LLM не настроен — задайте ключи в .env" />
        )}
      </section>

      {/* ── Разделы — навигация на витрину ── */}
      <section>
        <Card label="разделы">
          <ul className="space-y-2 font-mono text-sm">
            <li>
              <Link href="/showcase" className="text-accent hover:underline">
                Витрина возможностей →
              </Link>
              <span className="ml-2 text-xs text-dim">что умеет система по модулям</span>
            </li>
            {capabilitySections.slice(0, 4).map((s) => (
              <li key={s.id} className="text-dim">
                {s.title} <span className="text-xs">(P1+, скоро)</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
