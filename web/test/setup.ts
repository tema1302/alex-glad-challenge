// Глобальный сетап vitest: jest-dom матчеры + стабы браузерных API,
// которых нет в jsdom (matchMedia, IntersectionObserver).
import '@testing-library/jest-dom/vitest';

// CountUp/ScrollSpin/Toast опрашивают prefers-reduced-motion; в тестах считаем
// «reduce» активным — анимации/отсчёты сворачиваются в мгновенный результат.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// CountUp наблюдает за появлением элемента — стаб сразу сообщает «виден».
class IntersectionObserverStub implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
  Object.assign(window, { IntersectionObserver: IntersectionObserverStub });
}
