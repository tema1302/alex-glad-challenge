// Лендинг Артемия (/) — machine-nameplate. Server component, force-dynamic.
// Signature: asset-tag (hostname 127.0.0.1 + live-поля из БД) вместо digital-rain /
// boot-terminal / gradient-neon (клише). Amber-on-ink instrumentation, не acid-green дефолт.
// Палитра/типографика landing-scoped (land.* + font-sans body) — 23 страницы НЕ трогаются.
// Live-данные — server-only (lib/server/db + lib/server/env по образцу dashboard);
// 0 значений ключей наружу — только счётчики, флаги, имя модели (не секрет).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getBlogDb, getDialogDb, getRagStore, getTgStore, withDb } from '../lib/server/db';
import { getKeysStatus } from '../lib/server/env';

export const dynamic = 'force-dynamic';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-land-amber focus-visible:ring-offset-2 focus-visible:ring-offset-land-ink';

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

function Field({ k, children, span2 = false }: { k: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={`bg-land-panel px-3 py-2.5 ${span2 ? 'col-span-2' : ''}`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-land-dim">{k}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] text-land-bone">{children}</div>
    </div>
  );
}

function Count({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="bg-land-panel px-4 py-3">
      <div className="font-mono text-2xl font-semibold tabular-nums text-land-bone">{n}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-land-dim">{l}</div>
    </div>
  );
}

function ModuleRow({
  idx,
  name,
  role,
  value,
  href,
  accent,
}: {
  idx: string;
  name: string;
  role: string;
  value: string;
  href: string;
  accent: 'amber' | 'teal';
}) {
  const valColor = accent === 'amber' ? 'text-land-amber' : 'text-land-teal';
  return (
    <Link
      href={href}
      className={`group grid grid-cols-[auto_1fr_auto] items-center gap-4 px-1 py-4 transition-colors hover:bg-land-panel ${FOCUS}`}
    >
      <span className="font-mono text-xs text-land-dim">{idx}</span>
      <span className="min-w-0">
        <span className="block font-mono text-sm font-semibold uppercase tracking-wide text-land-bone">{name}</span>
        <span className="mt-0.5 block truncate text-[13px] text-land-dim">{role}</span>
      </span>
      <span className="flex items-center gap-3">
        <span className={`font-mono text-sm tabular-nums ${valColor}`}>{value}</span>
        <span className="font-mono text-land-dim transition-colors group-hover:text-land-bone">→</span>
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const s = await readLive();

  const modules = [
    { idx: '01', name: 'LLM-core', role: 'qwen3.5:4b локально + cloud-опц.', value: s.model ?? '—', href: '/rag/chat', accent: 'amber' as const },
    { idx: '02', name: 'RAG', role: 'embeddings · cosine · rerank · guard «не знаю»', value: `${s.ragTotal} chunks`, href: '/rag', accent: 'teal' as const },
    { idx: '03', name: 'Telegram', role: 'MTProto-userbot → forum-топики → индекс', value: `${s.tgMessages} msg`, href: '/tg/top', accent: 'teal' as const },
    { idx: '04', name: 'Blog-pipeline', role: 'RSS → FSM plan/execute/validate/revise', value: `${s.posts} posts`, href: '/blog/pipeline', accent: 'amber' as const },
    { idx: '05', name: 'Dialog', role: '3 слоя памяти · ветвление · профили', value: `${s.dialogChats} chats`, href: '/chat', accent: 'amber' as const },
    { idx: '06', name: 'MCP', role: 'свои HTTP/stdio-серверы · agent-loop', value: 'stdio+http', href: '/mcp/tools', accent: 'teal' as const },
  ];

  return (
    <div className="-mx-4 space-y-14 bg-land-ink px-4 font-sans text-land-dim">
      {/* ── Nameplate hero (signature) ── */}
      <section className="relative pt-2">
        <div className="ai-sweep relative overflow-hidden rounded-md border border-land-line bg-land-panel">
          <div className="grid gap-8 p-6 sm:p-9 md:grid-cols-[1.35fr_1fr] md:gap-10">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-land-dim">
                hostname · <span className="text-land-amber">127.0.0.1</span>
              </p>
              <h1 className="mt-4 font-mono text-[2.6rem] font-semibold uppercase leading-[0.92] tracking-tight text-land-bone sm:text-6xl">
                Локальный
                <br />
                AI-стэк
              </h1>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed">
                Артемий, AI-инженер. LLM, RAG, MTProto и MCP запущены на этом ноутбуке — без
                облака, без ключей наружу.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className={`rounded-md border border-land-amber/60 bg-land-amber/10 px-5 py-2.5 text-sm font-semibold text-land-amber transition-colors hover:bg-land-amber/20 ${FOCUS}`}
                >
                  Открыть Dashboard →
                </Link>
                <Link
                  href="/showcase"
                  className={`rounded-md border border-land-line px-5 py-2.5 text-sm font-semibold text-land-bone transition-colors hover:border-land-dim ${FOCUS}`}
                >
                  Витрина фич
                </Link>
              </div>
            </div>

            {/* asset-tag fields — engraved plate */}
            <div className="grid grid-cols-2 gap-px self-start border border-land-line bg-land-line font-mono">
              <Field k="host">127.0.0.1</Field>
              <Field k="operator">Артемий</Field>
              <Field k="build">day 30 / 30</Field>
              <Field k="status">
                <span className="ai-carrier mr-1.5 inline-block h-2 w-2 translate-y-[-1px] rounded-full bg-land-amber" />
                ACTIVE
              </Field>
              <Field k="model" span2>
                {s.model ? `${s.model}${s.provider ? ` · ${s.provider}` : ''}` : 'не настроен'}
              </Field>
              <Field k="boundary" span2>
                local-only · no keys out
              </Field>
            </div>
          </div>

          {/* live counters strip — proof the stack is alive */}
          <div className="grid grid-cols-2 gap-px border-t border-land-line bg-land-line sm:grid-cols-4">
            <Count n={s.ragTotal} l="rag chunks" />
            <Count n={s.tgMessages} l="tg messages" />
            <Count n={s.posts} l="blog posts" />
            <Count n={`${s.keysOn}/${s.keysTotal}`} l="keys · values hidden" />
          </div>
        </div>
      </section>

      {/* ── Boundary manifesto ── */}
      <section className="grid gap-px border border-land-line bg-land-line sm:grid-cols-3">
        {[
          { t: 'LLM на 127.0.0.1', d: 'Ollama qwen3.5 локально. Cloud (DeepSeek/OpenRouter) — опционально, по вашему выбору.' },
          { t: 'Ключи только в .env', d: 'Токены, MTProto-сессия, API-ключи не покидают машину и не светятся в UI.' },
          { t: 'Bind на loopback', d: 'Next dev и MCP-серверы слушают только 127.0.0.1. Внешнего доступа нет.' },
        ].map((b) => (
          <div key={b.t} className="bg-land-panel p-5">
            <div className="font-mono text-sm font-semibold text-land-bone">{b.t}</div>
            <p className="mt-2 text-[13px] leading-relaxed text-land-dim">{b.d}</p>
          </div>
        ))}
      </section>

      {/* ── Process ledger — модули как running processes, входы в live-разделы ── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-land-dim">// running processes</h2>
          <span className="font-mono text-xs text-land-dim">6 modules</span>
        </div>
        <div className="divide-y divide-land-line border-y border-land-line">
          {modules.map((m) => (
            <ModuleRow key={m.idx} {...m} />
          ))}
        </div>
        <p className="mt-3 font-mono text-[11px] text-land-dim">
          live-числа — из challenge/.data на этом ноутбуке. 0 или «—» = модуль не проиндексирован.
        </p>
      </section>

      {/* ── 30-day line — реальная последовательность, numbering оправдан ── */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-land-dim">// 30-day build</h2>
          <span className="font-mono text-xs text-land-dim">23 live sections</span>
        </div>
        <div className="flex items-end gap-[3px]">
          {Array.from({ length: 30 }).map((_, i) => {
            const day = i + 1;
            const isCurrent = day === 30;
            const isMilestone = day % 10 === 0;
            return (
              <div key={day} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  className={`h-10 w-full rounded-[1px] ${
                    isCurrent ? 'bg-land-amber' : isMilestone ? 'bg-land-teal/70' : 'bg-land-line'
                  }`}
                  title={`day ${day}`}
                />
                {isMilestone ? (
                  <span className="font-mono text-[9px] text-land-dim">{day}</span>
                ) : (
                  <span className="h-[9px]" />
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 font-mono text-[11px] text-land-dim">
          day 30 — локальная LLM как приватный сервис. Полная карта 23 разделов — в header и footer.
        </p>
      </section>

      {/* ── Footer CTA ── */}
      <section className="border-t border-land-line pt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-lg font-semibold text-land-bone">Докажи, что стэк жив.</p>
            <p className="mt-1 text-[13px] text-land-dim">
              Открой dashboard — счётчики БД и статус ключей в реальном времени.
            </p>
          </div>
          <Link
            href="/dashboard"
            className={`shrink-0 rounded-md border border-land-amber/60 bg-land-amber/10 px-5 py-2.5 text-sm font-semibold text-land-amber transition-colors hover:bg-land-amber/20 ${FOCUS}`}
          >
            Dashboard →
          </Link>
        </div>
      </section>
    </div>
  );
}
