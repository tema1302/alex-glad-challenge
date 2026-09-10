// E2E витрины /showcase: симулятор «Один день редакции» (полный прогон),
// мини-демо карточки (фраза → ответ → доказательства) и аркадная викторина.
// Ничего внешнего не трогает: симуляция и демо — учебные, LLM/Telegram не вызываются.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Витрина /showcase (админ)', () => {
  test('симулятор: полный день — лента → выбор темы → пост → публикация с метриками', async ({ page }) => {
    await login(page, '/showcase');

    // герой: CTA ведёт к симулятору
    await expect(page.getByRole('link', { name: '▶ Запустить выпуск' })).toBeVisible();

    // полный день: старт → разведка → решение редактора
    await page.getByRole('button', { name: '▶ Запустить день' }).click();
    await page.getByText('ваш ход: выберите тему выпуска').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Локальная LLM обгоняет облако' }).click();

    // написание: черновик печатается, потом появляется публикация
    await expect(page.getByText('черновик поста')).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать в канал' }).click({ timeout: 20_000 });

    // выпуск: метрики финала
    await expect(page.getByText('Выпуск № 42 опубликован.')).toBeVisible();
    await expect(page.getByText('12 480')).toBeVisible();
    await expect(page.getByText('86')).toBeVisible();

    // перезапуск возвращает в исходное состояние
    await page.getByRole('button', { name: 'Провести ещё один день' }).click();
    await expect(page.getByRole('button', { name: '▶ Запустить день' })).toBeVisible();
  });

  test('мини-демо базы знаний: ответ с источниками и честное «Не знаю»', async ({ page }) => {
    await login(page, '/showcase');

    // первый бит: вопрос с цитатой и чипами-источниками
    await page.getByRole('button', { name: 'Где чек-лист по промпт-инъекциям?' }).click();
    await expect(page.getByText('Чек-лист из 7 пунктов', { exact: false })).toBeVisible();
    await expect(page.getByText('[1] заметка · Безопасность ботов')).toBeVisible();

    // второй бит: вопрос вне базы → guard-отказ без выдумок
    await page.getByRole('button', { name: 'А что по квантовым вычислениям?' }).click();
    await expect(page.getByText('Не знаю — в базе нет материалов', { exact: false })).toBeVisible();
    await expect(page.getByText('guard · отказ без выдумок')).toBeVisible();
  });

  test('аркада: викторина принимает ответ, фидбек и переход к следующему вопросу', async ({ page }) => {
    await login(page, '/showcase');

    // аркада — вкладка «Угадай модуль» активна по умолчанию; отвечаем первым вариантом
    const options = page.locator('section:has-text("аркада") button').filter({ hasText: /База знаний|Чат с памятью|Редакция новостей|Постинг в Telegram|Руки у агента|Память на вашей машине/ });
    await options.first().click();

    // фидбек называет модуль; переход работает
    await expect(page.getByText(/Верно — это|Это «/)).toBeVisible();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await expect(page.getByText(/вопрос 2\//)).toBeVisible();
  });
});
