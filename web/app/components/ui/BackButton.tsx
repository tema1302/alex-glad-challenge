// BackButton (S2 «Back&scroll»): умный «← назад» для детальных страниц.
// Есть in-app история (SPA-переходы с последней полной загрузки) → router.back()
// — мгновенный возврат по клиентскому Router Cache; прямой заход/login-redirect →
// честный fallback-push на список (адрес задаёт страница: контекст ?blog= и т.п.).
// Стили — один в один с бывшей ссылкой «← к списку» (posts/[id]:203):
// визуально не меняется ни на пиксель; focus-ring — как в ui/Button.tsx.
'use client';

import { useRouter } from 'next/navigation';

import { clearInAppMark, hasInAppHistory } from '../../../lib/shared/spaHistory';

export function BackButton({
  fallbackHref,
  label = '← назад',
}: {
  /** Куда уйти, когда in-app истории нет (прямой заход/deep link). */
  fallbackHref: string;
  /** Текст кнопки; SectionHead-слоты с адресом-названием («чаты») сохраняют его. */
  label?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (hasInAppHistory()) {
          router.back();
        } else {
          // Пришли извне: затираем возможную устаревшую отметку, чтобы
          // fallback-push не выдавал себя за in-app историю.
          clearInAppMark();
          router.push(fallbackHref);
        }
      }}
      className="inline-flex min-h-[36px] items-center rounded-md px-2 text-sm text-dim transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {label}
    </button>
  );
}
