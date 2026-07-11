'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // redacted: только message+digest, без stack-trace (не светить секреты/пути)
    console.error(error?.message ?? 'error', error?.digest ?? '');
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="font-mono text-xs uppercase tracking-wider text-err">// error</div>
      <h1 className="mt-2 font-mono text-2xl uppercase tracking-tight text-ink">Что-то сломалось</h1>
      <p className="mt-2 text-sm text-dim">{error.message || 'Необработанная ошибка сегмента.'}</p>
      {error.digest ? <p className="mt-1 font-mono text-xs text-dim">digest: {error.digest}</p> : null}
      <button
        onClick={reset}
        className="mt-6 inline-flex min-h-[36px] items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Повторить
      </button>
    </div>
  );
}
