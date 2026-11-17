// E2E: S2 «Back&scroll» (консилиум personal-space-S2-01) — мгновенный возврат
// из детальной страницы и точная высота списка.
// Инварианты спека:
//  - счётчик повторных GET строго по pathname (например '/api/blog/posts';
//    карточка поста ходит в /api/blog/posts/<id> и НЕ считается; POST create
//    в кейсе №5 — тоже: хелпер фильтрует по методу GET);
//  - допуск scroll-restore ±50px (expect.poll), grace 500 мс на поздний refetch;
//  - адаптивная глубина Math.min(1200, scrollHeight − innerHeight − 8),
//    кейсы со скроллом скипаются, если страница короче 400px;
//  - БЕЗОПАСНОСТЬ (инвариант playwright.config): ничего не публикуем в
//    Telegram и не удаляем — только навигация по существующим данным.
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** Счётчик GET-запросов к списку по точному pathname (POST create не считается). */
function listGetCounter(page: Page, pathname: string): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === pathname && r.method() === 'GET') n += 1;
  });
  return () => n;
}

/** Адаптивная глубина скролла: не выше реальной прокручиваемой части − 8px. */
function scrollTarget(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.min(1200, document.documentElement.scrollHeight - window.innerHeight - 8),
  );
}

/**
 * Ждёт данные списка постов (dev-компиляция + fetch медленные): ссылки постов
 * ИЛИ честное EmptyState. isVisible() без ожидания здесь дал бы ложный skip.
 * true — посты есть.
 */
async function hasPosts(page: Page): Promise<boolean> {
  await expect(
    page.locator('a[href^="/blog/posts/"]').first().or(page.getByText('Постов пока нет')),
  ).toBeVisible({ timeout: 60_000 });
  return page.locator('a[href^="/blog/posts/"]').first().isVisible();
}

/** Аналог для хаба блогов: карточка с ссылкой «Посты» ИЛИ пустое состояние. */
async function hasBlogCards(page: Page): Promise<boolean> {
  await expect(
    page
      .locator('a[href^="/blog/posts?blog="]')
      .first()
      .or(page.getByText(/блогов нет/i)),
  ).toBeVisible({ timeout: 60_000 });
  return page.locator('a[href^="/blog/posts?blog="]').first().isVisible();
}

test.describe('Навигация Back&scroll (S2)', () => {
  test('браузерный back: список → пост → назад — та же высота и 0 повторных GET', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, '/blog/posts');
    const counter = listGetCounter(page, '/api/blog/posts');

    // Данные загружены (fetch успешен → снапшот сохранён).
    if (!(await hasPosts(page))) {
      test.skip(true, 'нет постов — кейс не воспроизводится');
    }

    const target = await scrollTarget(page);
    test.skip(target < 400, `страница короче 400px (target=${target}px) — скролл-кейс не воспроизводится`);
    await page.evaluate((y) => window.scrollTo(0, y), target);
    await page.waitForTimeout(300); // throttled saveScroll успел записать якорь

    const before = counter();
    // Клик по ссылке, УЖЕ видимой в вьюпорте: scroll-into-view Playwright не
    // должен сдвинуть сохранённый якорь (иначе сравниваем не ту высоту).
    await page.evaluate(() => {
      const vh = window.innerHeight;
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href^="/blog/posts/"]'),
      ).filter((a) => a.getBoundingClientRect().height > 0);
      const inView =
        links.find((a) => {
          const r = a.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= vh;
        }) ?? links[links.length - 1];
      inView.click();
    });
    await page.waitForURL(/\/blog\/posts\/\d+/);
    await expect(page.getByRole('heading', { name: /Пост #\d+/ })).toBeVisible();

    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/blog/posts');
    // Список вернулся из снапшота: данные отрисованы, высота восстановлена
    // после коммита данных (не по skeleton — нативный restore клампится).
    await expect(page.locator('a[href^="/blog/posts/"]').first()).toBeVisible();
    await expect
      .poll(async () => Math.abs(await page.evaluate(() => Math.round(window.scrollY)) - target), {
        timeout: 15_000,
      })
      .toBeLessThanOrEqual(50);

    // grace 500 мс: поздний refetch тоже должен быть пойман.
    await page.waitForTimeout(500);
    expect(counter() - before).toBe(0);
  });

  test('кнопка «← назад»: возврат в список без повторного GET', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, '/blog/posts');
    if (!(await hasPosts(page))) {
      test.skip(true, 'нет постов — кейс не воспроизводится');
    }

    await page.locator('a[href^="/blog/posts/"]').first().click();
    await page.waitForURL(/\/blog\/posts\/\d+/);
    await expect(page.getByRole('heading', { name: /Пост #\d+/ })).toBeVisible();

    const counter = listGetCounter(page, '/api/blog/posts');
    const before = counter();
    await page.getByRole('button', { name: '← назад' }).click();
    await page.waitForURL((u) => u.pathname === '/blog/posts');
    await expect(page.locator('a[href^="/blog/posts/"]').first()).toBeVisible();

    await page.waitForTimeout(500);
    expect(counter() - before).toBe(0);
  });

  test('контекст ?blog=: возврат сохраняет URL и фильтр, без повторного GET', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, '/blog/settings');

    if (!(await hasBlogCards(page))) {
      test.skip(true, 'нет блогов — контекст ?blog= не воспроизводится');
    }
    // Реальный вход в отфильтрованный список — ссылка «Посты» с карточки блога.
    await page.locator('a[href^="/blog/posts?blog="]').first().click();
    await page.waitForURL((u) => u.pathname === '/blog/posts' && u.searchParams.has('blog'));
    const slug = new URL(page.url()).searchParams.get('blog') ?? '';

    if (!(await hasPosts(page))) {
      test.skip(true, 'в этом блоге нет постов — кейс не воспроизводится');
    }

    const counter = listGetCounter(page, '/api/blog/posts');
    const before = counter();
    await page.locator('a[href^="/blog/posts/"]').first().click();
    await page.waitForURL(/\/blog\/posts\/\d+/);
    await expect(page.getByRole('heading', { name: /Пост #\d+/ })).toBeVisible();

    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/blog/posts' && u.searchParams.get('blog') === slug);
    // Контекст на месте: ?blog= в URL и тот же фильтр в селекте.
    await expect(page.getByLabel('Фильтр по блогу')).toHaveValue(slug);
    await expect(page.locator('a[href^="/blog/posts/"]').first()).toBeVisible();

    await page.waitForTimeout(500);
    expect(counter() - before).toBe(0);
  });

  test('глубокая ссылка на пост: «← назад» уходит в /blog/posts, НЕ в /login', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, '/blog/posts');
    if (!(await hasPosts(page))) {
      test.skip(true, 'нет постов — кейс не воспроизводится');
    }
    const href = (await page.locator('a[href^="/blog/posts/"]').first().getAttribute('href')) ?? '';

    // «Глубокая ссылка»: полная загрузка карточки — JS-модуль стартует с нуля,
    // in-app истории нет → кнопка обязана уйти в fallback-push списка.
    await page.goto(href);
    await expect(page.getByRole('heading', { name: /Пост #\d+/ })).toBeVisible();

    await page.getByRole('button', { name: '← назад' }).click();
    await page.waitForURL((u) => u.pathname === '/blog/posts');
    // Контекст ?blog= — если пост принадлежит блогу; обязательное — НЕ /login.
    expect(page.url()).not.toContain('/login');
    await expect(page.getByRole('heading', { name: 'Посты блога' })).toBeVisible();
  });

  test('создание чата → «← назад» → список содержит новый чат (снапшот инвалидирован)', async ({ page }) => {
    test.setTimeout(180_000);
    // /rag/chat: create-POST — чистая запись в dialog.sqlite, LLM не зовётся.
    await login(page, '/rag/chat');
    const counter = listGetCounter(page, '/api/rag/chat');

    // Список загружен (снапшот сохранён): карточки чатов ИЛИ пустое состояние.
    await expect(
      page.locator('a[href^="/rag/chat/"]').first().or(page.getByText('Нет чатов.')),
    ).toBeVisible({ timeout: 60_000 });
    const before = counter();

    const title = `e2e-навигация: чат ${Date.now()}`;
    await page.getByLabel(/Заголовок/).fill(title);
    await page.getByRole('button', { name: 'Создать и открыть' }).click();
    await page.waitForURL(/\/rag\/chat\/[0-9a-f-]{8,}/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    // BackButton детальной (лейбл «чаты»): in-app возврат. Снапшот чистится
    // create'ом → список обязан рефетчить и показать только что созданный чат
    // (регресс на инвалидацию: до фикса mount брал свежий снапшот без чата).
    await page.getByRole('button', { name: 'чаты' }).click();
    await page.waitForURL((u) => u.pathname === '/rag/chat');
    await expect(page.getByText(title)).toBeVisible();

    await page.waitForTimeout(500);
    expect(counter() - before).toBeGreaterThanOrEqual(1);
  });
});
