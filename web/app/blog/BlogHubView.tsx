// BlogHubView — презентационный вид хаба /blog (S1 «Хаб /blog + IA»): весь
// рендер на props, БЕЗ 'use client' и без единого fetch — вид тестируется на
// чистых данных (0 моков). Пульс — переиспользованный dashboard-компонент
// BlogPulse (cross-route импорт обычного модуля); типы пропсов локальные и
// минимальные, как у BlogPulse, — страница передаёт более богатые данные БД.
import { BlogPulse } from '../dashboard/BlogPulse';
import { SectionHead } from '../components/ui/SectionHead';
import { SectionLabel } from '../components/ui/SectionLabel';
import { Card } from '../components/ui/Card';
import { statusBadge } from '../components/ui/Badge';
import { LinkButton } from '../components/ui/LinkButton';

interface HubPulseTotals {
  active: number;
  needsAttention: number;
  postsLast7Days: number;
  customPrompts: number;
}

interface HubPulseBlog {
  id: number;
  slug: string;
  name: string;
  readyForNews: boolean;
  counts: { postsLast7Days: number };
}

/** Последняя отправка TG (safe-поля outbox); error-статус ведёт к посту. */
interface HubLastSend {
  status: 'ok' | 'error';
  error: string | null;
  createdAt: string;
  postId: number | null;
}

interface HubAttention {
  draftsCount: number;
  lastSend: HubLastSend | null;
}

// Входы по задачам: primary — главный сценарий «новость → черновик → пост»,
// остальные — тихие ссылки по разделам. Подсказки — человеческим голосом,
// в словаре карты возможностей dashboard.
const HUB_ENTRIES: ReadonlyArray<{
  href: string;
  title: string;
  hint: string;
  primary?: boolean;
}> = [
  {
    href: '/blog/news',
    title: 'Новости → пост',
    hint: 'Свежие новости выбранного блога превращаются в готовый черновик голосом этого блога.',
    primary: true,
  },
  {
    href: '/blog/posts',
    title: 'Черновики и посты',
    hint: 'Все посты: правка, статусы отправки, публикация в канал из карточки.',
  },
  {
    href: '/blog/digest',
    title: 'Дайджест',
    hint: 'Подборка новостей недели одним кликом — с предпросмотром перед отправкой.',
  },
  {
    href: '/blog/pipeline',
    title: 'Полный конвейер',
    hint: 'Разведка тем и пост одним прогоном — от поиска до готового черновика.',
  },
  {
    href: '/blog/scout',
    title: 'Поиск тем',
    hint: 'Три агента ищут горячие темы по вашему запросу: RSS, форумы, Telegram.',
  },
  {
    href: '/blog/settings',
    title: 'Студия блогов',
    hint: 'Создание блогов, настройка голоса, RSS и промптов агентов.',
  },
];

export function BlogHubView({
  pulse,
  attention,
}: {
  pulse: { totals: HubPulseTotals; blogs: HubPulseBlog[] };
  attention: HubAttention;
}) {
  // «Требует внимания»: черновики без публикации, блоги без голоса/RSS и
  // последняя отправка TG (ok — просто факт; error — повод зайти в пост).
  const unready = pulse.blogs.filter((b) => !b.readyForNews);
  const { lastSend } = attention;
  const calm = attention.draftsCount === 0 && unready.length === 0 && lastSend === null;

  return (
    <div className="space-y-6">
      <SectionHead
        code="blog · пространство"
        title="Ваши блоги"
        description="Рабочее место контента: что требует внимания и откуда запускать прогоны — новость → черновик → пост канала. Настройка блогов — в студии, карта всей системы — на dashboard."
      />

      <Card label="требует внимания">
        {calm ? (
          <p className="text-sm text-dim">Всё спокойно: ничего не требует внимания.</p>
        ) : (
          <ul className="space-y-2 text-sm text-dim">
            {attention.draftsCount > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Черновики без публикации: <strong className="text-ink">{attention.draftsCount}</strong>
                </span>
                <LinkButton href="/blog/posts" variant="ghost" size="sm">
                  открыть посты →
                </LinkButton>
              </li>
            )}
            {unready.map((blog) => (
              <li key={blog.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>Блог «{blog.name}» — нужна настройка (голос или RSS)</span>
                <LinkButton
                  href={`/blog/settings/${encodeURIComponent(blog.slug)}`}
                  variant="ghost"
                  size="sm"
                >
                  настроить →
                </LinkButton>
              </li>
            ))}
            {lastSend && (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2" title={lastSend.error ?? undefined}>
                  Последняя отправка в Telegram:
                  {statusBadge(lastSend.status === 'ok' ? 'published' : 'error')}
                  <span className="font-mono text-xs tabular-nums text-dim">{lastSend.createdAt}</span>
                </span>
                {lastSend.status === 'error' && (
                  <LinkButton
                    href={lastSend.postId !== null ? `/blog/posts/${lastSend.postId}` : '/blog/posts'}
                    variant="ghost"
                    size="sm"
                  >
                    {lastSend.postId !== null ? 'к посту →' : 'к постам →'}
                  </LinkButton>
                )}
              </li>
            )}
          </ul>
        )}
      </Card>

      <section>
        <SectionLabel>входы по задачам</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {HUB_ENTRIES.map((entry) => (
            <div key={entry.href} className="flex flex-col gap-1.5">
              <LinkButton href={entry.href} variant={entry.primary ? 'primary' : 'ghost'} className="w-full">
                {entry.title}
              </LinkButton>
              <p className="text-xs leading-snug text-dim">{entry.hint}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Пульс: 0 блогов → BlogPulse сам показывает CTA «Создать блог» → /blog/settings. */}
      <BlogPulse totals={pulse.totals} blogs={pulse.blogs} />
    </div>
  );
}
