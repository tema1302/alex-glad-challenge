'use client';

import { useEffect, useState } from 'react';
import { claimChunkReload, isChunkLoadError } from '../lib/shared/chunkRecovery';
import { Button } from './components/ui/Button';
import { IconWarning } from './components/ui/icons';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloadBlocked, setReloadBlocked] = useState(false);

  useEffect(() => {
    // redacted: только message+digest, без stack-trace (не светить секреты/пути)
    console.error(error?.message ?? 'error', error?.digest ?? '');
    if (!isChunkLoadError(error)) return;
    if (claimChunkReload(error, window.sessionStorage)) {
      window.location.reload();
      return;
    }
    setReloadBlocked(true);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="rounded-lg border border-err/40 bg-surface p-6 shadow-panel">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-err">
          <IconWarning />
          {'// error'}
        </div>
        <h1 className="mt-3 font-mono text-2xl font-semibold uppercase tracking-tight text-ink">
          Что-то сломалось
        </h1>
        <p className="mt-2 break-words text-sm leading-relaxed text-dim">
          {reloadBlocked
            ? 'Часть интерфейса не загрузилась. Обновите страницу позже или нажмите «Обновить».'
            : error.message || 'Необработанная ошибка сегмента.'}
        </p>
        {error.digest ? <p className="mt-1 font-mono text-xs text-dim">digest: {error.digest}</p> : null}
        <div className="mt-5">
          <Button variant="primary" onClick={reloadBlocked ? () => window.location.reload() : reset}>
            {reloadBlocked ? 'Обновить' : 'Повторить'}
          </Button>
        </div>
      </div>
    </div>
  );
}
