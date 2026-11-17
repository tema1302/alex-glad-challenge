'use client';

import { useEffect, useState } from 'react';

import { claimChunkReload, isChunkLoadError } from '../lib/shared/chunkRecovery';

// global-error рендерит собственный <html>/<body> — CSS-бандл не грузится,
// поэтому стили inline и повторяют дизайн-токены (bg #0F1417, accent #3FB8AF).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloadBlocked, setReloadBlocked] = useState(false);

  useEffect(() => {
    // redacted: только message+digest, без stack-trace (не светить секреты/пути)
    console.error(error?.message ?? 'error', error?.digest ?? '');
    if (!isChunkLoadError(error)) return;
    if (claimChunkReload(error, window.sessionStorage)) {
      window.location.reload();
      return;
    }
    // Замок уже занят: второй reload подряд не поможет — показываем понятный fallback.
    setReloadBlocked(true);
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ background: '#0F1417', color: '#DCE3E8', fontFamily: 'IBM Plex Sans, system-ui, sans-serif', padding: '3rem 1.25rem', maxWidth: '36rem', margin: '0 auto' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#E05656' }}>// fatal error</div>
        <h1 style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '1.5rem', textTransform: 'uppercase', margin: '0.5rem 0', color: '#DCE3E8' }}>Глобальный сбой</h1>
        <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#8A979E' }}>
          {reloadBlocked
            ? 'Часть интерфейса не загрузилась. Обновите страницу позже или нажмите «Обновить».'
            : error.message || 'Корневая ошибка приложения.'}
        </p>
        {error.digest ? <p style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: '11px', color: '#8A979E' }}>digest: {error.digest}</p> : null}
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={reloadBlocked ? () => window.location.reload() : reset}
            style={{ background: '#3FB8AF', color: '#0A1012', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            {reloadBlocked ? 'Обновить' : 'Повторить'}
          </button>
          <a
            href="/"
            style={{ border: '1px solid #303C42', borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#8A979E', textDecoration: 'none' }}
          >
            На главную
          </a>
        </div>
      </body>
    </html>
  );
}
