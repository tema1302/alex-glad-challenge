// Общий хук для chat-панелей (memory/branch/profile/constraints). DRY: одинаковый
// паттерн GET-snapshot на mount + POST-mutation с refresh. 'use client'.
'use client';
import { useCallback, useEffect, useState } from 'react';

export function usePanelView<T>(url: string): {
  view: T | null;
  error: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  // POST body → parsed JSON (содержит {ok, view?, ...}) или false при ошибке.
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown> | false>;
} {
  const [view, setView] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      setView((await r.json()) as T);
      setError(null);
    } catch {
      setError('network error');
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | false> => {
      setBusy(true);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await r.json()) as Record<string, unknown>;
        if (!r.ok) {
          setError(typeof data.error === 'string' ? data.error : `HTTP ${r.status}`);
          return false;
        }
        if (data.view !== undefined) setView(data.view as T);
        else await refresh();
        setError(null);
        return data;
      } catch {
        setError('network error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, url],
  );

  return { view, error, busy, refresh, post };
}
