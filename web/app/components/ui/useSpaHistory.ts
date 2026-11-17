// useSpaHistory (S2 «Back&scroll»): подключает страницу к SPA-истории.
//  - markEnter + notePopstate — на каждой mount (layout-effect до paint,
//    чтобы BackButton на этой же странице уже видел актуальную отметку);
//  - режим 'detail': дополнительно «гасит» флаг возврата — popstate пришёл в
//    детальную, восстановления высоты не будет, флаг не должен протекать в
//    следующий push-mount списка;
//  - режим 'list': throttled-сохранение window.scrollY per pathname
//    (ведущая + хвостовая граница 200 мс) + pagehide и финальная позиция на
//    unmount, чтобы последний скролл не потерялся при SPA-уходе.
// Восстановление высоты и снапшот списка — в самих страницах: они знают,
// когда данные закоммитились (см. списковые page.tsx).
'use client';

import { useEffect, useLayoutEffect } from 'react';

import {
  consumeReturnFlag,
  markEnter,
  notePopstate,
  saveScroll,
} from '../../../lib/shared/spaHistory';

// Isomorphic-паттерн: useLayoutEffect на клиенте (снапшот/отметка до paint —
// без мигания skeleton), useEffect на сервере (React-предупреждение про
// layout-effect-в-SSR не словим).
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const SCROLL_SAVE_MS = 200;

export interface SpaHistoryOptions {
  /** list: сохранять scroll-якорь (списки); detail: гасить флаг возврата. */
  readonly list?: boolean;
}

export function useSpaHistory(pathname: string, opts: SpaHistoryOptions = {}): void {
  const isList = opts.list === true;

  useIsomorphicLayoutEffect(() => {
    markEnter(pathname);
    notePopstate();
    if (!isList) {
      // popstate привёл в детальную: его флаг никому не нужен — гасим, чтобы
      // он не сработал в следующем push-mount списка как ложный «возврат».
      consumeReturnFlag();
    }
  }, [pathname, isList]);

  useEffect(() => {
    if (!isList) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      timer = undefined;
      last = Date.now();
      saveScroll(pathname, window.scrollY);
    };
    const onScroll = (): void => {
      const now = Date.now();
      if (now - last >= SCROLL_SAVE_MS) {
        flush();
        return;
      }
      // хвостовая граница: последний скролл до навигации тоже попадёт в якорь
      if (timer === undefined) timer = setTimeout(flush, SCROLL_SAVE_MS - (now - last));
    };
    // full unload (закрытие/переход наружу) — тоже фиксируем позицию
    const onPageHide = (): void => {
      saveScroll(pathname, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
      if (timer !== undefined) clearTimeout(timer);
      // финальная позиция при SPA-уходе: unmount-момент — последний шанс
      // записать высоту, иначе якорь отстанет на один «квадрат» скролла.
      saveScroll(pathname, window.scrollY);
    };
  }, [pathname, isList]);
}
