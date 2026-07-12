'use client';

// Performance instrumentation — dev-only. Пишет в консоль браузера:
//   • Web Vitals на каждый роут (TTFB/FCP/LCP/CLS/INP) — через useReportWebVitals.
//   • Route-transition: длительность client-side перехода + Navigation Timing нового
//     документа (server/compile-штраф on-demand-компиляции Next dev — холодный визит
//     даёт всплеск server time, тёплый → ~0; это и есть диагноз «медленные переходы»).
// В production <PerfProbe/> рендерит null → внутренний модуль с хуками не монтируется:
// instrumentation не выполняется. Код остаётся в client bundle, но мёртв при runtime.
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';

// Teal — палитра C (Graphite+Teal), чтобы строки [perf] визуально отделять в DevTools.
const TAG = '%c[perf]';
const TAG_STYLE = 'color:#0ea5b7;font-weight:600';

function PerfProbeInner() {
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);
  const clickStart = useRef<number | null>(null);

  // 1) Web Vitals — регистрация одна; колбэк вызывается по мере появления метрик
  //    (TTFB/FCP — рано, LCP/CLS/INP — после взаимодействий).
  useReportWebVitals((metric) => {
    console.info(
      TAG,
      TAG_STYLE,
      `${pathname}  vitals  ${metric.name}=${Math.round(metric.value)}ms (${metric.rating}) [id=${metric.id}]`,
    );
  });

  // 2) Старт client-side навигации: Next App Router не даёт публичного onTransitionStart,
  //    поэтому аппроксимируем capture-listener по клику в <a>/<button> (covers next/link).
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (target && target.closest('a,button')) {
        clickStart.current = performance.now();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // 3) На смене pathname: total = клик→отрисовка нового роута; Navigation Timing —
  //    осмыслен для hard navigation (Playwright-бенчмарк cold/warm). При client-side
  //    nav Next не создаёт новый document, поэтому entry остаётся от первой загрузки —
  //    в логе это видно как стабильные server/TTFB; всплеск total = on-demand compile.
  useEffect(() => {
    const from = prevPath.current;
    if (from !== null && from !== pathname) {
      const now = performance.now();
      const total = clickStart.current != null ? Math.round(now - clickStart.current) : null;
      const nav = performance
        .getEntriesByType('navigation')
        .find((e): e is PerformanceNavigationTiming => e instanceof PerformanceNavigationTiming);
      if (nav) {
        const server = Math.max(0, Math.round(nav.responseEnd - nav.requestStart));
        const ttfb = Math.max(0, Math.round(nav.responseStart - nav.requestStart));
        const dcl = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
        const load = Math.round(nav.loadEventEnd - nav.startTime);
        console.info(
          TAG,
          TAG_STYLE,
          `transition ${from} → ${pathname}: total=${total ?? '?'}ms | server(compile)=${server}ms | TTFB=${ttfb}ms | DCL=${dcl}ms | load=${load}ms`,
        );
      } else {
        console.info(
          TAG,
          TAG_STYLE,
          `transition ${from} → ${pathname}: total=${total ?? '?'}ms | Navigation Timing unavailable`,
        );
      }
      clickStart.current = null;
    }
    prevPath.current = pathname;
  }, [pathname]);

  return null;
}

// Public gate: dev-only. В production рендерим null → inner с хуками не монтируется.
export function PerfProbe() {
  if (process.env.NODE_ENV === 'production') return null;
  return <PerfProbeInner />;
}
