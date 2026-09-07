// E2E: гостевой лендинг / — hero, орбитальные чипы-переходы (гейт), темы.
// Реальных отправок нет: чип ведёт гостя на /login?next=… (middleware).
import { expect, test } from '@playwright/test';

test.describe('Лендинг (гость)', () => {
  test('hero: заголовок, CTA подписки, метрики', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Строю AI-системы');
    await expect(
      page.getByRole('link', { name: /Подписаться на канал/ }).first(),
    ).toHaveAttribute('href', /t\.me/);
    await expect(page.getByText('82', { exact: true })).toBeVisible();
    await expect(page.getByText('0₽', { exact: true })).toBeVisible();
  });

  test('орбитальный чип ведёт гостя на /login?next=/rag/chat (S4-гейт)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /RAG-поиск/ }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Frag%2Fchat$/);
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
  });

  test('переключатель темы меняет html-класс и переживает перезагрузку', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const initial = await html.getAttribute('class');
    expect(initial).toBeTruthy();

    await page.getByRole('button', { name: /тему/i }).click();
    const after = await html.getAttribute('class');
    expect(after).not.toBe(initial);

    await page.reload();
    await expect(html).toHaveAttribute('class', new RegExp(after!));

    // вернуть как было — чтобы не влиять на соседние тесты
    await page.getByRole('button', { name: /тему/i }).click();
    await expect(html).toHaveAttribute('class', new RegExp(initial!));
  });
});
