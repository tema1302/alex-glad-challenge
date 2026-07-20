// Bento-лендинг стэка alex-glad-challenge (day 35).
// Server Component, static. Метрики — статика из Research. 0 импортов @challenge/core/*.
import Link from 'next/link';
import { type CSSProperties } from 'react';
import { SectionLabel } from './components/ui/SectionLabel';
import { Card } from './components/ui/Card';
import { BentoCard } from './components/ui/BentoCard';
import {
  IconDatabase,
  IconSparkles,
  IconPlug,
  IconSend,
  IconRss,
  IconMessages,
  IconCpu,
} from './components/ui/icons';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const BENTO_MODULES = [
  { badge: '/rag/chat', title: 'RAG-движок', desc: 'local-embed → rerank → цитаты; guard «не знаю». Ollama native.', href: '/rag/chat', icon: IconDatabase },
  { badge: '/joker', title: 'Кино-Шутник', desc: 'CINE-PUN чат; локальная qwen3.5:4b; факты 8с + shuffle.', href: '/joker', icon: IconSparkles },
  { badge: '/mcp/tools', title: 'MCP round-trip', desc: 'Свои MCP-серверы (crm/files); deterministic, no LLM-loop.', href: '/mcp/tools', icon: IconPlug },
  { badge: '/tg/top', title: 'TG MTProto', desc: 'Userbot; forum-топики → индекс. RSS sports.ru/championat.', href: '/tg/top', icon: IconSend },
  { badge: '/blog/pipeline', title: 'Blog pipeline', desc: 'RSS → sanitize → БД → дашборд. FSM plan/execute/validate.', href: '/blog/pipeline', icon: IconRss },
  { badge: '/chat', title: 'Dialog memory', desc: '3 слоя памяти · ветвление · профили · cross-chat past-Q&A.', href: '/chat', icon: IconMessages },
] as const;

const CORE = [
  { t: 'RAG pipeline', d: 'embed → cosine → rerank → guard. 5 партиций: fixed, structure, telegram, docs, faq.', icon: IconDatabase },
  { t: 'MCP round-trip', d: 'HTTP/STDIO-server-конструктор + client + orchestrator. 7 запускаемых серверов in-repo.', icon: IconPlug },
  { t: 'LLM-gateway', d: '3 провайдера: DeepSeek (cloud), OpenRouter (Claude/Gemini), Ollama (local qwen3.5:4b).', icon: IconCpu },
  { t: 'TG MTProto', d: 'Userbot через telegram lib. RSS sports.ru/championat.com → БД → индекс → дашборд.', icon: IconSend },
] as const;

const METRICS = [
  { v: '35', l: 'дней челленджа' },
  { v: '7', l: 'MCP-серверов in-repo' },
  { v: '3', l: 'LLM-провайдера' },
  { v: '5', l: 'RAG-партиций' },
] as const;

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* 1. Hero */}
      <section className="bento-enter" style={{ '--i': '0' } as CSSProperties}>
        <SectionLabel>stack · alex-glad-challenge</SectionLabel>
        <h1 className="font-mono text-4xl font-semibold uppercase leading-[0.95] tracking-tight text-ink sm:text-5xl md:text-6xl">
          Локальный
          <br />
          AI-dev-стэк
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-dim md:text-base">
          LLM-агенты, RAG, MCP и TG-автоматизация на одном ноутбуке. 35 дней, 26 демо, 7 MCP-серверов.
          DeepSeek + OpenRouter + Ollama. Без облака, без ключей наружу.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className={`bento-enter inline-flex min-h-[40px] items-center rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-filter hover:brightness-110 ${FOCUS}`}
            style={{ '--i': '1' } as CSSProperties}
          >
            Открыть Dashboard →
          </Link>
          <Link
            href="/joker"
            className={`bento-enter inline-flex min-h-[40px] items-center rounded-md border border-line-strong px-5 py-2 text-sm font-semibold text-ink transition-colors hover:border-accent ${FOCUS}`}
            style={{ '--i': '2' } as CSSProperties}
          >
            Смотреть демо
          </Link>
        </div>
      </section>

      {/* 2. Bento: модули (6 live плиток-ссылок) */}
      <section>
        <SectionLabel>modules · live</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-5">
          {BENTO_MODULES.map((m, i) => (
            <BentoCard
              key={m.href}
              href={m.href}
              badge={m.badge}
              title={m.title}
              desc={m.desc}
              icon={<m.icon />}
              index={i + 1}
            />
          ))}
        </div>
      </section>

      {/* 3. Bento: ядро (2×2, не кликабельные — обзор архитектуры) */}
      <section>
        <SectionLabel>core · architecture</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CORE.map((c, i) => (
            <Card key={c.t}>
              <div
                className="bento-enter flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent"
                style={{ '--i': String(i) } as CSSProperties}
              >
                <c.icon /> <span>core</span>
              </div>
              <h3 className="mt-3 font-sans text-lg font-semibold text-ink">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">{c.d}</p>
            </Card>
          ))}
        </div>
        <p className="mt-3 font-mono text-xs text-dim">
          Полный обзор архитектуры —{' '}
          <Link href="/showcase" className="text-accent hover:underline">
            /showcase
          </Link>
          .
        </p>
      </section>

      {/* 4. Метрики */}
      <section>
        <SectionLabel>metrics · stack</SectionLabel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {METRICS.map((m, i) => (
            <div
              key={m.l}
              className="bento-enter rounded-2xl border border-line bg-surface p-5"
              style={{ '--i': String(i) } as CSSProperties}
            >
              <div className="font-mono text-4xl font-semibold tabular-nums text-accent">{m.v}</div>
              <div className="mt-2 font-mono text-xs uppercase tracking-wider text-dim">{m.l}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-xs text-dim">26 демо в registry · 81 коммит в main · 23 live-раздела.</p>
      </section>
    </div>
  );
}
