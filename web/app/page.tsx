// Лендинг Артемия (/) — единственный brand-moment внутри PRODUCT (редизайн C).
// Server component, force-dynamic. Live-данные — server-only (lib/server/db +
// lib/server/env по образцу dashboard); 0 значений ключей наружу — только счётчики,
// флаги, имя модели (не секрет). Без page-load motion / gradient / glow (PRODUCT).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, withDb } from '../lib/server/db';
import { getKeysStatus } from '../lib/server/env';
import { Tile } from './components/ui/Tile';
import { Card } from './components/ui/Card';
import { SectionLabel } from './components/ui/SectionLabel';

export const dynamic = 'force-dynamic';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

interface Live {
  ragTotal: number;
  tgMessages: number;
  posts: number;
  news: number;
  styleSamples: number;
  dialogChats: number;
  dialogMessages: number;
  model: string | null;
  provider: string | null;
  keysOn: number;
  keysTotal: number;
}

async function readLive(): Promise<Live> {
  return withDb(() => {
    const blog = getBlogDb();
    const rag = getRagStore();
    const tg = getTgStore();
    const dialog = getDialogDb();
    const tgStats = tg.stats();
    const chats = dialog.listChats(2000);
    const keys = getKeysStatus();
    const keySlots = [keys.cloud, keys.local, keys.embed, keys.mtproto, keys.botApi];
    return {
      ragTotal: rag.count('fixed') + rag.count('structure') + rag.count('telegram'),
      tgMessages: tgStats.messages,
      posts: blog.postsCount(),
      news: blog.newsCount(),
      styleSamples: blog.styleSamplesCount(),
      dialogChats: chats.length,
      dialogMessages: chats.reduce((sum, c) => sum + c.msg_count, 0),
      model: keys.activeModel,
      provider: keys.activeProvider,
      keysOn: keySlots.filter((k) => k.configured).length,
      keysTotal: keySlots.length,
    };
  });
}

// asset-tag field — engraved nameplate row (сигнатура лендинга).
function Field({ k, children, span2 = false }: { k: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={`bg-surface px-3 py-2.5 ${span2 ? 'col-span-2' : ''}`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-dim">{k}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] text-ink">{children}</div>
    </div>
  );
}

export default async function HomePage() {
  const s = await readLive();

  const modules = [
    { idx: '01', name: 'LLM-core', role: 'qwen3.5:4b локально + cloud-опц.', value: s.model ?? '—', href: '/rag/chat' },
    { idx: '02', name: 'RAG', role: 'embeddings · cosine · rerank · guard «не знаю»', value: `${s.ragTotal} chunks`, href: '/rag' },
    { idx: '03', name: 'Telegram', role: 'MTProto-userbot → forum-топики → индекс', value: `${s.tgMessages} msg`, href: '/tg/top' },
    { idx: '04', name: 'Blog-pipeline', role: 'RSS → FSM plan/execute/validate/revise', value: `${s.posts} posts`, href: '/blog/pipeline' },
    { idx: '05', name: 'Dialog', role: '3 слоя памяти · ветвление · профили', value: `${s.dialogChats} chats`, href: '/chat' },
    { idx: '06', name: 'MCP', role: 'свои HTTP/stdio-серверы · agent-loop', value: 'stdio+http', href: '/mcp/tools' },
  ];

  const boundaries = [
    { t: 'LLM на 127.0.0.1', d: 'Ollama qwen3.5 локально. Cloud (DeepSeek/OpenRouter) — опционально, по вашему выбору.' },
    { t: 'Ключи только в .env', d: 'Токены, MTProto-сессия, API-ключи не покидают машину и не светятся в UI.' },
    { t: 'Bind на loopback', d: 'Next dev и MCP-серверы слушают только 127.0.0.1. Внешнего доступа нет.' },
  ];

  return (
    <div className="space-y-10">
      {/* ── Hero ── */}
      <section>
        <SectionLabel>landing · v30</SectionLabel>
        <h1 className="font-mono text-4xl font-semibold uppercase leading-[0.95] tracking-tight text-ink sm:text-5xl">
          Локальный
          <br />
          AI-стэк
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-dim">
          Артемий, AI-инженер. LLM, RAG, MTProto и MCP запущены на этом ноутбуке — без облака,
          без ключей наружу.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className={`inline-flex min-h-[40px] items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-filter hover:brightness-110 ${FOCUS}`}
          >
            Открыть Dashboard →
          </Link>
          <Link
            href="/showcase"
            className={`inline-flex min-h-[40px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-accent ${FOCUS}`}
          >
            Витрина фич
          </Link>
        </div>
      </section>

      {/* ── Asset-tag plate (сигнатура: engraved nameplate) ── */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line font-mono">
        <Field k="host">127.0.0.1</Field>
        <Field k="operator">Артемий</Field>
        <Field k="build">day 30 / 30</Field>
        <Field k="status">
          <span className="mr-1.5 inline-block h-2 w-2 translate-y-[-1px] rounded-full bg-accent" />
          ACTIVE
        </Field>
        <Field k="model" span2>
          {s.model ? `${s.model}${s.provider ? ` · ${s.provider}` : ''}` : 'не настроен'}
        </Field>
        <Field k="boundary" span2>
          local-only · no keys out
        </Field>
      </section>

      {/* ── Live counters — proof the stack is alive ── */}
      <section>
        <SectionLabel>live · 127.0.0.1</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="rag chunks" value={s.ragTotal} />
          <Tile label="tg messages" value={s.tgMessages} />
          <Tile label="blog posts" value={s.posts} />
          <Tile label="news" value={s.news} />
          <Tile label="style samples" value={s.styleSamples} />
          <Tile label="chats" value={s.dialogChats} hint={`${s.dialogMessages} msg`} />
          <Tile label="dialog msg" value={s.dialogMessages} />
          <Tile label="keys" value={`${s.keysOn}/${s.keysTotal}`} hint="values hidden" />
        </div>
      </section>

      {/* ── Boundary manifesto ── */}
      <section>
        <SectionLabel>boundary</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          {boundaries.map((b) => (
            <Card key={b.t}>
              <div className="font-mono text-sm font-semibold text-ink">{b.t}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{b.d}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Process ledger — модули как running processes ── */}
      <section>
        <SectionLabel>process ledger</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Card key={m.idx}>
              <Link href={m.href} className={`group -m-1 block rounded p-1 transition-colors hover:bg-surface-2 ${FOCUS}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
                    {m.name}
                  </span>
                  <span className="font-mono text-xs text-dim">{m.idx}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-dim">{m.role}</p>
                <div className="mt-3 font-mono text-sm text-accent">
                  {m.value} <span className="text-dim transition-colors group-hover:text-ink">→</span>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {/* ── 30-day build — bars + numeric labels (не цветом единым) ── */}
      <section>
        <SectionLabel>30-day build</SectionLabel>
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between font-mono text-[11px] text-dim">
            <span>
              <span className="text-ink">30</span> / 30 days
            </span>
            <span>23 live sections</span>
          </div>
          <div className="flex items-end gap-[3px]">
            {Array.from({ length: 30 }).map((_, i) => {
              const day = i + 1;
              const isCurrent = day === 30;
              const labeled = day === 1 || day % 5 === 0;
              return (
                <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    className={`h-10 w-full rounded-[1px] ${isCurrent ? 'bg-accent' : 'bg-line-strong'}`}
                    title={`day ${day}`}
                  />
                  <span className={`font-mono text-[10px] leading-none ${isCurrent ? 'text-accent' : 'text-dim'}`}>
                    {labeled || isCurrent ? day : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-dim">
            day 30 — локальная LLM как приватный сервис. Полная карта 23 разделов — в header и footer.
          </p>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="border-t border-line pt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-lg font-semibold text-ink">Докажи, что стэк жив.</p>
            <p className="mt-1 text-[13px] text-dim">
              Открой dashboard — счётчики БД и статус ключей в реальном времени.
            </p>
          </div>
          <Link
            href="/dashboard"
            className={`inline-flex min-h-[40px] shrink-0 items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-filter hover:brightness-110 ${FOCUS}`}
          >
            Dashboard →
          </Link>
        </div>
      </section>
    </div>
  );
}
