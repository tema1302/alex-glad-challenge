// E2E: гостевой лендинг / — hero, орбитальные чипы-переходы, темы.
// Чип «RAG-поиск» ведёт гостя на публичную /demo (без логина); остальные
// чипы — защищённые маршруты, middleware отдаёт 302 → /login?next=… .
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

  test('орбитальный чип ведёт гостя на публичную /demo (RAG-демо без логина)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /RAG-поиск/ }).click();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Спроси мою базу знаний');
    await expect(page.getByLabel('Ваш вопрос')).toBeVisible();
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
