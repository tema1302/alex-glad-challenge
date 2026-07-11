// 404 — любой неизвестный путь. Также покрывает будущие роуты до их реализации.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <div className="font-mono text-xs uppercase tracking-wider text-dim">// 404</div>
      <h1 className="mt-2 text-xl font-semibold text-ink">Страница не найдена</h1>
      <p className="mt-2 text-sm text-dim">
        Этот раздел ещё не реализован в web (P1+) или адрес ошибочен.
      </p>
      <Link href="/" className="mt-3 inline-block text-sm text-accent hover:underline">
        ← На главную
      </Link>
    </div>
  );
}
