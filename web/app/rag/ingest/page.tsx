// /rag/ingest — «База знаний» (rag-ingest, П-3). Server-обёртка по образцу
// /blog/digest: SectionHead + клиентский остров IngestTabs (формы добавления) +
// блок «Обслуживание» со ссылками на СТАРЫЕ служебные страницы (они живы).
// Админ-only: middleware сам гейтит путь (нет в PUBLIC_PATHS → гость → 302 /login?next=…).
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '../../components/ui/Card';
import { SectionHead } from '../../components/ui/SectionHead';
import { SectionLabel } from '../../components/ui/SectionLabel';
import { IngestTabs } from './IngestTabs';

export const metadata: Metadata = { title: 'База знаний' };

// Служебные страницы — прежние пути, ничего не сломано; заметкам они не страшны
// (пересборка /rag/index трогает только fixed/structure, не партицию заметок).
const MAINTENANCE_LINKS: Array<{ href: string; label: string }> = [
  { href: '/rag/index', label: 'Пересборка встроенного руководства' },
  { href: '/rag/index-tg', label: 'Индексация Telegram — расширенная' },
  { href: '/tg/collect', label: 'Сбор чатов MTProto' },
];

export default function RagIngestPage() {
  return (
    <div className="space-y-6">
      <SectionHead
        code="rag · ingest"
        title="База знаний"
        description="Добавляйте заметки, файлы и чаты Telegram — они сразу попадают в ответы чата базы знаний."
      />
      <IngestTabs />
      <section>
        <SectionLabel>Обслуживание</SectionLabel>
        <Card>
          <ul className="space-y-2 text-sm">
            {MAINTENANCE_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-accent transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-dim">
            Служебные страницы — расширенные режимы, ваши заметки они не трогают.
          </p>
        </Card>
      </section>
    </div>
  );
}
