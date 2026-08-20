// Header (server component). Админ: бренд + MobileNav + core-ссылки + статус активной
// модели + «Выйти». Гость (публичный лендинг, день 36): бренд + тихая «Войти» — БЕЗ
// core-ссылок, MobileNav и статуса модели (анти-утечка инфраструктуры на публичной
// странице; getKeysStatus в гостевой ветке не вызывается). Сервер-сайд: getKeysStatus
// отдаёт public-мету (provider/model), значения ключей NEVER не покидают lib/server/env.
import Link from 'next/link';
import { navGroups } from '../../data/nav';
import { getKeysStatus } from '../../lib/server/env';
import { MobileNav } from './MobileNav';
import { LogoutButton } from './LogoutButton';

const core = navGroups.find((g) => g.tag === 'core') ?? navGroups[0];

export default function Nav({ isAdmin = false }: { isAdmin?: boolean }) {
  const keys = isAdmin ? getKeysStatus() : null;
  const model =
    keys && keys.activeProvider && keys.activeModel
      ? { provider: keys.activeProvider, model: keys.activeModel }
      : null;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
      <div className="flex h-12 items-center justify-between px-5">
        <div className="flex items-center gap-1">
          {isAdmin && <MobileNav />}
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight text-ink">
            Артемий
            <span className="text-accent">·</span>
            <span className="text-dim">AI</span>
          </Link>
        </div>
        {isAdmin ? (
          <>
            <nav className="hidden items-center gap-1 sm:flex">
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
            <div className="flex items-center gap-3">
              <div className="hidden font-mono text-xs text-dim sm:block">
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
              <LogoutButton />
            </div>
          </>
        ) : (
          <nav>
            <Link
              href="/login"
              className="rounded-md px-2 py-1 text-sm text-dim transition-colors duration-150 hover:text-ink"
            >
              Войти
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
