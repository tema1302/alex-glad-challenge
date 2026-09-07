// E2E: публичная RAG-страница /demo «Спроси мою базу знаний» (гость).
// Быстрые тесты — без LLM (гейт middleware + разметка + адаптив 375px).
// Медленный тест — РЕАЛЬНЫЙ прогон RAG (эмбеддинги + LLM, 10–30+ секунд):
// отключается E2E_SKIP_PRODUCT=1. Клик по чипу-примеру должен дать либо ответ
// с источниками, либо честное «не знаю» — но не ошибку.
import { expect, test } from '@playwright/test';

const SKIP = process.env.E2E_SKIP_PRODUCT === '1';

test.describe('Демо RAG (гость, /demo)', () => {
  test('гость: страница публична, форма и чипы примеров на месте, пустой вопрос заблокирован', async ({ page }) => {
    await page.goto('/demo');

    // Нет редиректа на /login — middleware открыл публичный путь.
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Спроси мою базу знаний');

    const ask = page.getByRole('button', { name: 'Спросить' });
    await expect(ask).toBeVisible();
    await expect(ask).toBeDisabled();

    const textarea = page.getByLabel('Ваш вопрос');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('maxlength', '300');

    // Чипы примеров: три из корпуса + один «вне базы».
    await expect(page.getByRole('button', { name: /крышку багажного отсека/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /подогрев передних сидений/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /высоковольтную батарею/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /чемпионат мира по футболу/ })).toBeVisible();

    // CTA подписки — единственный конверсионный элемент страницы.
    await expect(
      page.getByRole('link', { name: /Подписаться на канал/ }).first(),
    ).toHaveAttribute('href', /t\.me/);
  });

  test('375px: форма, чипы и CTA читаемы, без горизонтального скролла', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/demo');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Ваш вопрос')).toBeVisible();
    await expect(page.getByRole('button', { name: /Спросить/ })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Подписаться на канал/ }).first(),
    ).toBeVisible();
  });

  test('клик по чипу-примеру → реальный RAG-ответ или честное «не знаю»', async ({ page }) => {
    test.skip(SKIP, 'E2E_SKIP_PRODUCT=1');
    test.setTimeout(180_000);

    await page.goto('/demo');
    await page.getByRole('button', { name: /подогрев передних сидений/ }).click();

    // Кнопка ушла в loading («Отвечаю…») — форма приняла вопрос.
    await expect(page.getByRole('button', { name: /Отвечаю/ })).toBeVisible();

    // Результат: заголовок «Ответ» (с источниками) или «Честное „не знаю“».
    await expect(
      page.getByRole('heading', { name: /Ответ|Честное/ }).first(),
    ).toBeVisible({ timeout: 170_000 });

    // Прогон завершился: кнопка вернулась, человекочитаемых ошибок нет.
    await expect(page.getByRole('button', { name: 'Спросить' })).toBeEnabled();
    await expect(page.getByText('fetch failed')).toHaveCount(0);
  });
});
