// E2E студия канала /antonov (инструмент владельца, за auth). API
// /api/antonov/rewrite мокается через page.route: LLM — внешний эффект, как
// MTProto в rag-ingest (не гоняем). Проверяем: гость → /login; рендер формы;
// генерация с моком, история в localStorage переживает перезагрузку.
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const MOCK_POST = 'Ну что, спишь?\n\nПарковка станет платной. Понимаю.\n\nДержать строй!';

test.describe('Студия Антонова /antonov (админ)', () => {
  test.use({ storageState: undefined });
  test.setTimeout(120_000); // dev-компиляция страницы на 3100

  test('гость → редирект на /login (auth-middleware, роут не публичный)', async ({ page }) => {
    await page.goto('/antonov');
    await expect(page).toHaveURL(/\/login/);
  });

  test('рендер: заголовок, textarea, режимы, формат, подпись, кнопка заблокирована до ввода', async ({
    page,
  }) => {
    await login(page, '/antonov');

    await expect(page.getByRole('heading', { name: 'Антонов такой Антонов', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Канал ↗' })).toBeVisible();

    const textarea = page.getByLabel('Исходный текст');
    await expect(textarea).toBeVisible();

    const submit = page.getByRole('button', { name: 'Переписать' });
    await expect(submit).toBeDisabled();

    // Чип примера подставляет исходник → кнопка оживает.
    await page.getByRole('group', { name: 'Попробуйте на примере' }).getByRole('button').first().click();
    await expect(textarea).not.toHaveValue('');
    await expect(submit).toBeEnabled();

    // Режим грубости: radio-семантика, дефолт «Обычный».
    await expect(page.getByRole('radio', { name: 'Обычный' })).toBeChecked();
    await page.getByRole('radio', { name: 'Жёстко' }).click();
    await expect(page.getByRole('radio', { name: 'Жёстко' })).toBeChecked();

    await expect(page.getByLabel('Формат')).toBeVisible();
    await expect(page.getByLabel('С подписью «быть добру»')).toBeVisible();
  });

  test('генерация с моком: пост появляется, история переживает перезагрузку, restore и удаление', async ({
    page,
  }) => {
    await page.route('**/api/antonov/rewrite', async (route) => {
      const body = route.request().postDataJSON() as { text: string; mode: string; signature: boolean };
      expect(body.mode).toBe('hard');
      expect(body.signature).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, post: MOCK_POST }),
      });
    });
    await login(page, '/antonov');

    await page.getByLabel('Исходный текст').fill('Парковка у офиса станет платной с понедельника.');
    await page.getByRole('radio', { name: 'Жёстко' }).click();
    await page.getByLabel('С подписью «быть добру»').check();
    await page.getByRole('button', { name: 'Переписать' }).click();

    await expect(page.getByText(MOCK_POST)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'история (последние 10)' })).toBeVisible();

    // Перезагрузка: история живёт в localStorage.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'история (последние 10)' })).toBeVisible();

    // Restore: клик по записи возвращает исходник и пост.
    await page.getByTitle('Открыть в студии').click();
    await expect(page.getByLabel('Исходный текст')).toHaveValue(
      'Парковка у офиса станет платной с понедельника.',
    );
    await expect(page.getByText(MOCK_POST)).toBeVisible();

    // Удаление записи убирает карточку истории.
    await page.getByRole('button', { name: 'Удалить из истории' }).click();
    await expect(page.getByRole('heading', { name: 'история (последние 10)' })).toBeHidden();
  });
});
