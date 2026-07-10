// 404 — любой неизвестный путь. Также покрывает будущие роуты до их реализации.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-xl font-semibold">404 — страница не найдена</h2>
      <p className="mt-2 text-sm text-neutral-500">
        Этот раздел ещё не реализован в web (P1+) или адрес ошибочен.
      </p>
      <Link href="/" className="mt-3 inline-block text-sm text-accent hover:underline">
        ← На главную
      </Link>
    </div>
  );
}
