// Пульс контента на dashboard: компактная сводка по активным блогам.
// Server component (данные приходят из readBlogPulse), без клиентского JS.
import Link from 'next/link';

import { SectionLabel } from '../components/ui/SectionLabel';

interface PulseItem {
  id: number;
  slug: string;
  name: string;
  readyForNews: boolean;
  counts: { postsLast7Days: number };
}

interface PulseTotals {
  active: number;
  needsAttention: number;
  postsLast7Days: number;
  customPrompts: number;
}

export function BlogPulse({ totals, blogs }: { totals: PulseTotals; blogs: PulseItem[] }) {
  return (
    <section data-testid="blog-pulse">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SectionLabel>пульс контента</SectionLabel>
        <Link href="/blog/settings" className="text-xs text-accent hover:underline">
          Все блоги →
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'активных блогов', value: totals.active },
          { label: 'готовы к news', value: totals.active - totals.needsAttention },
          { label: 'постов за неделю', value: totals.postsLast7Days },
          { label: 'кастомных промптов', value: totals.customPrompts },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="font-mono text-xl font-semibold tabular-nums text-ink">{item.value}</div>
            <div className="text-[11px] leading-tight text-dim">{item.label}</div>
          </div>
        ))}
      </div>

      {blogs.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-line bg-surface/50 p-4">
          <p className="text-sm text-ink">Блогов пока нет</p>
          <p className="mt-1 text-xs text-dim">Создайте первый блог — и здесь появится его пульс.</p>
          <Link
            href="/blog/settings"
            className="mt-3 inline-flex min-h-[36px] items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:bg-accent/90"
          >
            Создать блог
          </Link>
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {blogs.slice(0, 4).map((blog) => (
            <Link
              key={blog.id}
              href={`/blog/settings/${encodeURIComponent(blog.slug)}`}
              className="group rounded-xl border border-line bg-surface p-3 shadow-panel transition-all duration-base ease-system hover:-translate-y-0.5 hover:border-accent-dim hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-sans text-sm font-semibold text-ink">{blog.name}</span>
                  <span className="block truncate font-mono text-[11px] text-dim">{blog.slug}</span>
                </span>
                <span
                  className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                    blog.readyForNews ? 'bg-ok' : 'bg-warn'
                  }`}
                  aria-label={blog.readyForNews ? 'готов к news' : 'требует настройки'}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-dim">
                <span>
                  постов за 7д: <span className="font-mono text-ink">{blog.counts.postsLast7Days}</span>
                </span>
                <span>{blog.readyForNews ? 'готов' : 'нужна настройка'}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full ${blog.readyForNews ? 'bg-ok' : 'bg-warn'}`}
                  style={{ width: blog.readyForNews ? '100%' : '35%' }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
