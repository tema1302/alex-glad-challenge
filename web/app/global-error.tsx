'use client';

// Глобальный boundary (перехватывает ошибки root layout). Обязан сам рендерить
// <html>/<body>, т.к. корневой layout при ошибке не используется.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Критическая ошибка приложения</h2>
        <p style={{ color: '#666' }}>{error.message || 'Непредвиденная ошибка.'}</p>
        {error.digest ? <p style={{ color: '#999', fontSize: '0.8rem' }}>код: {error.digest}</p> : null}
      </body>
    </html>
  );
}
