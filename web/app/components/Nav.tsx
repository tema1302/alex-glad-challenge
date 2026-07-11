// Header (server component). Persistent nav: brand + core-ссылки + status активной
// модели. C-палитра (Graphite + Teal). Сервер-сайд: getKeysStatus отдаёт public-мету
// (provider/model), значения ключей NEVER не покидают lib/server/env.
import Link from 'next/link';
import { navGroups } from '../../data/nav';
import { getKeysStatus } from '../../lib/server/env';

const core = navGroups.find((g) => g.tag === 'core') ?? navGroups[0];

export default function Nav() {
  const keys = getKeysStatus();
  const model =
    keys.activeProvider && keys.activeModel
      ? { provider: keys.activeProvider, model: keys.activeModel }
      : null;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
      <div className="flex h-12 items-center justify-between px-5">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight text-ink">
          Артемий
          <span className="text-accent">·</span>
          <span className="text-dim">AI</span>
        </Link>
        <nav className="flex items-center gap-1">
          {core.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="rounded-md px-2 py-1 text-sm text-dim transition-colors duration-150 hover:text-ink"
            >
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="font-mono text-xs text-dim">
          {model ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-ok" />
              {model.provider} · {model.model}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-dim" />
              no-key
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
