'use client';

// Error boundary для роут-сегмента (перехватывает throw из server components).
import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Без stacktrace-секрета в лог — только сообщение (digest помогает корреляции).
    console.error('[web] render error:', error.message, error.digest ?? '');
  }, [error]);

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">Что-то пошло не так</h2>
      <p className="mt-2 text-sm text-red-800 dark:text-red-200">
        {error.message || 'Непредвиденная ошибка рендеринга страницы.'}
      </p>
      {error.digest ? (
        <p className="mt-1 text-xs text-red-500">код: {error.digest}</p>
      ) : null}
      <button
        onClick={reset}
        className="mt-3 rounded border border-red-300 px-3 py-1 text-sm hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
      >
        Повторить
      </button>
    </div>
  );
}
