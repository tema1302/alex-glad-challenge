'use client';

// useTimeoutQueue — очередь setTimeout с гарантированной очисткой: все таймеры
// гаснут при размонтировании (забыть cleanup невозможно) и по clearAll()
// (пауза/перезапуск). Закрывает ревью-риск «перезаписанного timerRef».
import { useCallback, useEffect, useRef } from 'react';

export function useTimeoutQueue(): {
  set: (fn: () => void, ms: number) => void;
  clearAll: () => void;
} {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const arr = timers.current;
    return () => {
      for (const t of arr) clearTimeout(t);
    };
  }, []);

  const set = useCallback((fn: () => void, ms: number): void => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const clearAll = useCallback((): void => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  return { set, clearAll } as const;
}
