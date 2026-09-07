// E2E: auth-гейт и вход (S4/S5 ТЗ) — 302 гостя, ошибочный пароль, успешный вход, логаут.
import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, login, logout } from './helpers';

test.describe('Auth', () => {
  test('гость на /dashboard → /login?next=%2Fdashboard (S4)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test('неверный пароль → читаемая ошибка, входа нет', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('••••••••').fill('точно-не-пароль');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('верный пароль → /dashboard с быстрыми действиями; логаут → гостевой лендинг', async ({ page }) => {
    test.skip(!ADMIN_PASSWORD, 'WEB_ADMIN_PASSWORD не найден в корневом .env');
    await login(page, '/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Новый пост в TG/ })).toBeVisible();
    await logout(page);
  });

  test('глаз-иконка переключает видимость пароля', async ({ page }) => {
    await page.goto('/login');
    const input = page.getByPlaceholder('••••••••');
    await input.fill('секрет');
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Показать пароль' }).click();
    await expect(input).toHaveAttribute('type', 'text');
  });
});
