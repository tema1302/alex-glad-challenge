// E2E командной палитры (⌘K): открытие с клавиатуры и кнопкой в шапке, поиск,
// гостевой набор vs админский, переходы по Enter и клику, закрытие по Esc.
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const DIALOG = '[role="dialog"][aria-label="Быстрая навигация"]';
const INPUT = '[role="combobox"][aria-label="Поиск раздела"]';

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.locator(DIALOG)).toBeVisible();
}

test.describe('Командная палитра — гость', () => {
  test('Ctrl+K открывает палитру; поиск ведёт на публичную /demo', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);

    await page.locator(INPUT).fill('база');
    const option = page.getByRole('option', { name: /Спросить базу знаний/ });
    await expect(option).toBeVisible();
    await option.click();

    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.locator(DIALOG)).toHaveCount(0); // палитра закрылась после перехода
  });

  test('админские разделы гостю не видны; Esc закрывает палитру', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);

    await page.locator(INPUT).fill('дайджест');
    await expect(page.getByText('Ничего не нашлось — попробуйте другое слово.')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
  });
});

test.describe('Командная палитра — админ', () => {
  test('кнопка «Поиск» в шапке открывает палитру, Enter ведёт на раздел', async ({ page }) => {
    await login(page, '/dashboard');

    // Клик до гидрации ничего не делает (dev-компиляция идёт десятки секунд) —
    // ретраим быстро: короткий внутренний таймаут не съедает бюджет toPass.
    await expect(async () => {
      await page.getByRole('button', { name: 'Открыть быструю навигацию' }).click();
      await expect(page.locator(DIALOG)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 90_000 });

    await page.locator(INPUT).fill('дайджест');
    await expect(page.getByRole('option', { name: /дайджест/ })).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/blog\/digest$/);
  });

  test('полный каталог доступен поиском, стрелки управляют выбором', async ({ page }) => {
    await login(page, '/showcase');
    await openPalette(page);

    // Админ видит защищённые разделы, которых нет у гостя
    await page.locator(INPUT).fill('постинг');
    await expect(page.getByRole('option', { name: /TG-постинг/ })).toBeVisible();

    // Сброс запроса → весь список; стрелки двигают активный пункт
    await page.locator(INPUT).fill('');
    await page.locator(INPUT).press('ArrowDown');
    await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  });
});
