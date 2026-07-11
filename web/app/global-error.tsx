'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // redacted: только message+digest, без stack-trace (не светить секреты/пути)
    console.error(error?.message ?? 'error', error?.digest ?? '');
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ background: '#0F1417', color: '#DCE3E8', fontFamily: 'IBM Plex Sans, system-ui, sans-serif', padding: '3rem', maxWidth: '36rem', margin: '0 auto' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#E05656' }}>// fatal error</div>
        <h1 style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '1.5rem', textTransform: 'uppercase', margin: '0.5rem 0', color: '#DCE3E8' }}>Глобальный сбой</h1>
        <p style={{ fontSize: '0.875rem', color: '#8A979E' }}>{error.message || 'Корневая ошибка приложения.'}</p>
        <button
          onClick={reset}
          style={{ marginTop: '1.5rem', background: '#3FB8AF', color: '#0A1012', border: 'none', borderRadius: '6px', padding: '0.4rem 0.9rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
        >
          Повторить
        </button>
      </body>
    </html>
  );
}
