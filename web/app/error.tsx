'use client';

import { useEffect } from 'react';
import { Button } from './components/ui/Button';
import { IconWarning } from './components/ui/icons';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // redacted: только message+digest, без stack-trace (не светить секреты/пути)
    console.error(error?.message ?? 'error', error?.digest ?? '');
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
          {error.message || 'Необработанная ошибка сегмента.'}
        </p>
        {error.digest ? <p className="mt-1 font-mono text-xs text-dim">digest: {error.digest}</p> : null}
        <div className="mt-5">
          <Button variant="primary" onClick={reset}>
            Повторить
          </Button>
        </div>
      </div>
    </div>
  );
}
