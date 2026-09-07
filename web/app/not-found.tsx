// 404 — любой неизвестный путь (ТЗ §8.8). Стиль системы: mono-заголовок,
// ссылка «На главную».
import Link from 'next/link';
import { Button } from './components/ui/Button';
import { IconWarning } from './components/ui/icons';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-panel">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-warn">
          <IconWarning />
          {'// 404'}
        </div>
        <h1 className="mt-3 font-mono text-2xl font-semibold uppercase tracking-tight text-ink">
          Страница не найдена
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Адрес ошибочен — раздела с таким маршрутом нет.
        </p>
        <Link href="/" className="mt-5 inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim">
          <Button variant="primary">← На главную</Button>
        </Link>
      </div>
    </div>
  );
}
