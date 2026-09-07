// E2E «рабочий продукт»: успешные запуски боевых пайплайнов.
// Это РЕАЛЬНЫЕ прогоны: RSS-сети + облачный LLM (DeepSeek) — медленные (минуты)
// и тратят токены. Отключаются E2E_SKIP_PRODUCT=1. Telegram намеренно не трогаем:
// единственный канал из TG_CHAT_ID — реальная отправка в e2e небезопасна
// (confirm-флоу покрыт в composer.spec.ts).
import { expect, test } from '@playwright/test';
import { navGroups } from '../data/nav';
import { ADMIN_PASSWORD, login } from './helpers';

// Все маршруты навигации — «продукт поднялся и каждый раздел отвечает».
const ROUTES = navGroups.flatMap((g) => g.items.map((i) => i.href));

test.describe.configure({ mode: 'serial' });

const SKIP = process.env.E2E_SKIP_PRODUCT === '1';

test.describe('Рабочий продукт — успешные прогоны', () => {
  test('boot: все 23 раздела отвечают 200 (админ)', async ({ request }) => {
    test.setTimeout(300_000);

    const loginRes = await request.post('/api/auth/login', {
      data: { password: ADMIN_PASSWORD },
    });
    expect(loginRes.status()).toBe(200);

    for (const route of ROUTES) {
      const res = await request.get(route);
      expect(res.status(), `GET ${route}`).toBe(200);
    }
  });

  test('scout: source-агенты + оркестратор → топ тем (реальный LLM)', async ({ page }) => {
    test.skip(SKIP, 'E2E_SKIP_PRODUCT=1');
    test.setTimeout(240_000);

    await login(page, '/blog/scout');
    await page.getByRole('button', { name: 'Запустить' }).click();

    // Оркестратор отдал топ → карточка «Топ оркестратора (N)», N ≥ 1
    await expect(page.getByText(/Топ оркестратора \([1-9]/)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByRole('button', { name: 'Запустить' })).toBeEnabled();
    // Ошибок источника не показано (netFetch-фолбэк отработал)
    await expect(page.getByText('fetch failed')).toHaveCount(0);
  });

  test('news: RSS → 3 агента → пост сохранён и виден в списке (реальный LLM)', async ({ page }) => {
    test.skip(SKIP, 'E2E_SKIP_PRODUCT=1');
    test.setTimeout(300_000);

    await login(page, '/blog/news');
    // Окно свежести 72ч — чтобы у прогона были кандидаты даже без свежего RSS
    await page.getByLabel('Часов (hours)').fill('72');
    await page.getByLabel('Топ (top)').fill('3');
    await page.getByRole('button', { name: 'Запустить' }).click();

    // Прогон завершился: кнопка снова активна, пустого состояния нет
    await expect(page.getByRole('button', { name: 'Запустить' })).toBeEnabled({
      timeout: 240_000,
    });
    await expect(page.getByText(/Настройте параметры и нажмите/)).toHaveCount(0);
    await expect(page.getByText('fetch failed')).toHaveCount(0);

    // Ранжирование отработало → топ-новости отрисованы
    await expect(page.getByText(/Топ-новости \([1-9]/)).toBeVisible();

    // Пост действительно сохранён: появился в списке блога
    await page.goto('/blog/posts');
    await expect(page.getByRole('heading', { name: 'Посты блога' })).toBeVisible();
    await expect(page.locator('a[href^="/blog/posts/"]').first()).toBeVisible();
  });

  test('pipeline: «Запустить весь конвейер» — scout → news → done', async ({ page }) => {
    test.skip(SKIP, 'E2E_SKIP_PRODUCT=1');
    test.setTimeout(360_000);

    await login(page, '/blog/pipeline');
    await page.getByRole('button', { name: 'Запустить весь конвейер' }).click();

    // Обе фазы отработали: карточка «Прогон по фазам» отрисована, кнопка вернулась
    await expect(page.getByText('Прогон по фазам')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByRole('button', { name: 'Запустить весь конвейер' })).toBeEnabled({
      timeout: 300_000,
    });
    await expect(page.getByText('fetch failed')).toHaveCount(0);
  });
});
