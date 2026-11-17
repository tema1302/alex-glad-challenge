// S2 «Back&scroll»: SPA-история и scroll-якорь для возврата «← назад» без
// потерянной высоты. Клиентская механика детальных страниц и списков:
//  - отметка «in-app история есть» (markEnter/hasInAppHistory/clearInAppMark) —
//    BackButton решает back() vs fallback-push;
//  - scroll-якорь per pathname (saveScroll/readScroll) + флаг возврата
//    (notePopstate/consumeReturnFlag) — списки восстанавливают высоту после
//    коммита данных, страховка от клампинга по skeleton;
//  - снапшот списка per pathname с TTL (saveListSnapshot/readListSnapshot) —
//    мгновенный рендер на mount и «0 повторных GET» на возврате.
// Модуль client-safe БЕЗ server-only: импортируется только из client-компонентов,
// но SSR-безопасен — все обращения к window/sessionStorage под typeof-гардом и
// try/catch (приватный режим/квота — канон DigestComposer.tsx:134,154: молча
// деградируем к честному refetch/fallback, UI не ломаем).

const MARK_KEY = 'spa:mark';
const SCROLL_KEY = 'spa:scroll:';
const SNAP_KEY = 'spa:snap:';

// prevPath — module-level: живёт только с момента загрузки JS-модуля. Full
// reload (прямая ссылка, login-redirect) обнуляет его → первая mount после
// загрузки отметки НЕ даёт и затирает возможную устаревшую отметку из
// предыдущей SPA-сессии. Отметка = «с последней полной загрузки были
// SPA-переходы» → router.back() вернёт внутрь приложения, а не наружу.
let prevPath: string | null = null;

export function markEnter(pathname: string): void {
  if (typeof window === 'undefined') return;
  if (prevPath === pathname) return; // StrictMode double-mount той же страницы
  try {
    if (prevPath !== null) {
      // SPA-переход: в этом табе есть in-app история.
      window.sessionStorage.setItem(MARK_KEY, '1');
    } else {
      // Первая mount после full load — прямой заход/login-redirect: отметки нет.
      window.sessionStorage.removeItem(MARK_KEY);
    }
  } catch {
    /* приватный режим — без отметки, BackButton уйдёт в честный fallback-push */
  }
  prevPath = pathname;
}

export function hasInAppHistory(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(MARK_KEY) === '1';
  } catch {
    return false;
  }
}

/** После fallback-push: пользователь пришёл извне — отметка неактуальна. */
export function clearInAppMark(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(MARK_KEY);
  } catch {
    /* приватный режим — отметки и так нет */
  }
}

// --- Scroll-якорь per pathname ---

export function saveScroll(pathname: string, y: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SCROLL_KEY + pathname, String(y));
  } catch {
    /* приватный режим — высота не сохранится, возврат будет к верху */
  }
}

export function readScroll(pathname: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SCROLL_KEY + pathname);
    if (raw === null) return null;
    const y = Number(raw);
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

// --- Флаг «возврат через popstate» (один window-listener на модуль) ---

let returnFlag = false;
let popstateListening = false;

/** Идемпотентно вешает единственный popstate-listener модуля. */
export function notePopstate(): void {
  if (popstateListening || typeof window === 'undefined') return;
  popstateListening = true;
  window.addEventListener('popstate', () => {
    returnFlag = true;
  });
}

/** Читает и сбрасывает флаг возврата (страница-получатель popstate). */
export function consumeReturnFlag(): boolean {
  const was = returnFlag;
  returnFlag = false;
  return was;
}

// --- Снапшот списка per pathname (TTL, инвалидация мутациями) ---

interface ListSnapshot {
  readonly ts: number;
  readonly data: unknown;
}

export function saveListSnapshot(pathname: string, data: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    const snap: ListSnapshot = { ts: Date.now(), data };
    window.sessionStorage.setItem(SNAP_KEY + pathname, JSON.stringify(snap));
  } catch {
    /* приватный режим/квота — без снапшота, список просто рефетчится */
  }
}

/**
 * Возвращает данные снапшота, если он свежее ttlMs, иначе null.
 * Граница JSON→тип: структура data не валидируется (страница-владелец знает
 * свой формат и обязана проверить форму — как DigestComposer с черновиком).
 */
export function readListSnapshot<T>(pathname: string, ttlMs = 60_000): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SNAP_KEY + pathname);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ListSnapshot>;
    if (typeof parsed.ts !== 'number' || typeof parsed.data !== 'object' || parsed.data === null) {
      return null;
    }
    if (Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}

export function clearListSnapshot(pathname: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SNAP_KEY + pathname);
  } catch {
    /* приватный режим — снапшота и так нет */
  }
}

/**
 * Сброс module-состояния между ui-тестами: один vitest-воркер держит один
 * экземпляр модуля, prevPath/returnFlag протекали бы между кейсами.
 * popstateListening сознательно НЕ сбрасываем: window в jsdom один на воркер,
 * повторный listener только повторно ставит булев флаг.
 */
export function __testReset(): void {
  prevPath = null;
  returnFlag = false;
}
