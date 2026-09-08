// E2E: дайджест одним кликом (next-feature-2, П-2). Сборка — реальный LLM-вызов,
// таймаут теста 180 с (dev-компиляция + 30–120 с генерации). БЕЗОПАСНОСТЬ: публикация
// доходит только до confirm-диалога — закрываем «Отменой», в Telegram ничего не уходит.
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Дайджест (админ)', () => {
  test.use({ storageState: undefined });
  test.setTimeout(180_000); // реальный LLM

  test.beforeEach(async ({ page }) => {
    await login(page, '/blog/digest');
  });

  test('страница рендерит заголовок и кнопку сборки', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Дайджест одним кликом', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Собрать дайджест' })).toBeVisible();
  });

  test('сборка → preview-textarea с текстом от LLM; счётчик /4096 виден', async ({ page }) => {
    const textarea = page.getByPlaceholder('Текст дайджеста…');
    await page.getByRole('button', { name: 'Собрать дайджест' }).click();
    // LLM отвечает 30–120 с — ждём появления textarea с непустым текстом.
    await expect(textarea).toBeVisible({ timeout: 175_000 });
    await expect(textarea).toHaveValue(/\S/);
    await expect(page.getByText(/\/ 4096/)).toBeVisible();
  });

  test('«Отправить в TG» → confirm; «Отмена» закрывает — БЕЗ отправки', async ({ page }) => {
    const textarea = page.getByPlaceholder('Текст дайджеста…');
    await page.getByRole('button', { name: 'Собрать дайджест' }).click();
    await expect(textarea).toBeVisible({ timeout: 175_000 });
    const draft = await textarea.inputValue();

    await page.getByRole('button', { name: 'Отправить в TG' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Отправить дайджест в канал?');
    await expect(dialog).toContainText('Реальная отправка');

    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Текст не стёрт, публикации не было (onConfirm при отмене не вызывается).
    await expect(textarea).toHaveValue(draft);
  });
});

test.describe('Дайджест (гость)', () => {
  test.use({ storageState: undefined });

  test('гость на /blog/digest → редирект /login?next=…', async ({ page }) => {
    await page.goto('/blog/digest');
    await expect(page).toHaveURL(/\/login\?next=%2Fblog%2Fdigest$/);
  });
});
