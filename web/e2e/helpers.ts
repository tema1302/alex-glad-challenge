// Хелперы e2e: пароль админа из корневого .env (локальный запуск, наружу не логируем)
// и UI-логин через реальную форму (полная навигация window.location.assign).
import { type Page, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function rootEnvValue(key: string): string {
  // cwd при прогоне — web/; корневой .env — уровнем выше (import.meta в CJS-транспиле недоступен).
  const text = readFileSync(path.resolve(process.cwd(), '../.env'), 'utf8');
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || rootEnvValue('WEB_ADMIN_PASSWORD');

/** Логин через UI; next — куда попасть после входа. */
export async function login(page: Page, next = '/dashboard'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByPlaceholder('••••••••').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(next);
}

/** Логаут через кнопку в шапке (полная навигация на гостевой лендинг). */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Выйти' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible();
}
