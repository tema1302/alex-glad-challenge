// /evolute — «Evolute Club | Эволют Чат»: полезный топ сообщений + RAG-агент по чату.
// Авторизованная поверхность: роут не в PUBLIC_PATHS (middleware) — гейтится сессией.
// Данные: challenge/classify-evolute-top.ts → web/data/evolute-top-informative.json
// (>=5 реакций, отфильтровано хвастовство/поздравления с покупкой на локальной модели).
// Агент: SSE /api/evolute/agent, поиск жёстко скоупирован на этот chatKey в партиции
// telegram (история в памяти страницы, без DialogDb).
import dataRaw from '../../data/evolute-top-informative.json';
import { SectionHead } from '../components/ui/SectionHead';
import { SectionLabel } from '../components/ui/SectionLabel';
import { EvoluteAgent } from './EvoluteAgent';

interface TopItem {
  msgId: number;
  likes: number;
  reactions: Record<string, number>;
  date: string;
  author: string;
  text: string;
  url: string;
}

interface TopData {
  generatedAt: string;
  chatTitle: string;
  period: { from: string; to: string };
  totalCandidates: number;
  kept: number;
  dropped: number;
  items: TopItem[];
}

const data = dataRaw as unknown as TopData;

function reactionBadge(r: Record<string, number>): string {
  return Object.entries(r)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([e, n]) => `${e}${n}`)
    .join(' ');
}

export default function EvolutePage() {
  return (
    <div className="space-y-8">
      <SectionHead
        code="evolute · telegram"
        title="Evolute i-Space — полезное из чата"
        description={`${data.chatTitle}: из ${data.totalCandidates} сообщений с ≥5 реакциями отобрано ${data.kept} информационных — поломки, эксплуатация, цены, советы. Хвастовство и поздравления с покупкой (${data.dropped}) отфильтрованы. Полный неотфильтрованный список — challenge/evolute-top-messages.md.`}
      />

      <EvoluteAgent />

      <section className="space-y-3">
        <SectionLabel>{`информационный топ · ${data.items.length}`}</SectionLabel>
        {data.items.length === 0 ? (
          <p className="text-sm text-dim">
            Пока пусто — прогоните challenge/classify-evolute-top.ts.
          </p>
        ) : (
          <ol className="space-y-2">
            {data.items.map((item, i) => (
              <li key={item.msgId}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-line bg-surface p-4 shadow-panel transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-accent-dim hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-dim">
                    <span className="text-accent">#{i + 1}</span>
                    <span>♥{item.likes}</span>
                    <span>{reactionBadge(item.reactions)}</span>
                    <span>{item.date}</span>
                    <span className="truncate">{item.author}</span>
                    <span className="ml-auto">msg {item.msgId} ↗</span>
                  </div>
                  {item.text && (
                    <p className="mt-2 whitespace-pre-line text-sm text-ink">{item.text}</p>
                  )}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
