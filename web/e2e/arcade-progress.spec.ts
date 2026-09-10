// E2E прогресса аркады: XP и достижения живее после решённого пазла,
// переживают перезагрузку (localStorage), кнопка «Поделиться» ведёт в t.me/share.
// window.open подменяется до загрузки страницы — наружу e2e не ходит.
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** Подменяет window.open до загрузки страницы: попапы копятся в window.__popups. */
async function trackPopups(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.open = ((url?: string | URL) => {
      const w = window as unknown as { __popups?: string[] };
      (w.__popups ??= []).push(String(url));
      return null;
    }) as typeof window.open;
  });
}

test.describe('Прогресс аркады /showcase (админ)', () => {
  test('пазл решён → XP и достижения начислены, переживают перезагрузку', async ({ page }) => {
    await login(page, '/showcase');
    // Чистый лист: чужой прогресс из прошлых сессий браузера не должен мешать.
    await page.evaluate(() => window.localStorage.removeItem('arcade.progress.v1'));
    await page.reload();

    // Панель прогресса: стартовый уровень
    await expect(page.getByText('ур. 1')).toBeVisible();
    await expect(page.getByText('Достижения 0/7')).toBeVisible();

    // Решаем пазл «Собери архитектуру» детерминированно: слои в правильном порядке
    await page.getByRole('tab', { name: 'Собери архитектуру' }).click();
    for (const layer of ['Поверхности', 'Ядро core/*', 'Хранилище']) {
      await page.getByRole('button', { name: new RegExp(layer) }).click();
    }
    await page.getByRole('button', { name: 'Проверить' }).click();
    await expect(page.getByText('Идеально — ни одной ошибки.')).toBeVisible();

    // Панель ожила: 25 XP (20 за пазл + 5 «с первой попытки»), 2 достижения
    await expect(page.getByText(/25 XP/)).toBeVisible();
    await expect(page.getByText('Достижения 2/7')).toBeVisible();

    // Перезагрузка — прогресс персистентен
    await page.reload();
    await expect(page.getByText(/25 XP/)).toBeVisible();
    await expect(page.getByText('Достижения 2/7')).toBeVisible();
  });

  test('список достижений раскрывается: открытые и закрытые различимы', async ({ page }) => {
    await login(page, '/showcase');
    await page.evaluate(() => window.localStorage.removeItem('arcade.progress.v1'));
    await page.reload();

    await page.getByRole('button', { name: /Достижения/ }).click();
    await expect(page.getByText('Главред')).toBeVisible();
    await expect(page.getByText('Выпустите номер в симуляторе редакции')).toBeVisible();

    // Решаем пазл — панель обновится и в раскрытом виде
    await page.getByRole('tab', { name: 'Собери архитектуру' }).click();
    for (const layer of ['Поверхности', 'Ядро core/*', 'Хранилище']) {
      await page.getByRole('button', { name: new RegExp(layer) }).click();
    }
    await page.getByRole('button', { name: 'Проверить' }).click();
    await expect(page.getByText('открыто')).toHaveCount(2);
  });

  test('«Поделиться» открывает t.me/share с текстом профиля (попап перехвачен)', async ({ page }) => {
    await trackPopups(page);
    await login(page, '/showcase');
    await page.evaluate(() => window.localStorage.removeItem('arcade.progress.v1'));
    await page.reload();

    await page.getByRole('button', { name: 'Поделиться' }).click();

    const popups = await page.evaluate(() => (window as unknown as { __popups?: string[] }).__popups ?? []);
    expect(popups).toHaveLength(1);
    expect(popups[0]).toContain('https://t.me/share/url?');
    expect(popups[0]).toContain(encodeURIComponent('Мой уровень в аркаде витрины'));
  });
});
