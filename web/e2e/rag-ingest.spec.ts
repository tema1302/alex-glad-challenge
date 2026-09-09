// E2E «База знаний» /rag/ingest (rag-ingest, П-3). Требует оба пакета: роуты П-2
// (/api/rag/notes POST/DELETE/GET) + UI П-3 — гонять на интеграции.
// БЕЗОПАСНОСТЬ (инвариант playwright.config): e2e удаляют ТОЛЬКО те заметки, которые
// сами создали (уникальный title с меткой времени); Telegram-вкладку НЕ гоняем —
// MTProto-сбор это внешний эффект, проверяем только рендер вкладки.
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const stamp = Date.now();
const NOTE_TITLE = `e2e-заметка: тестовая заметка про виджеты ${stamp}`;
const NOTE_TEXT = `Тестовая заметка про виджеты. Маркер-псевдослово: виджетоборг. Создана e2e и удаляется в конце прогона.`;
const FILE_NAME = `e2e-marker-${stamp}.txt`;
const FILE_BASE = FILE_NAME.replace(/\.txt$/, ''); // сервер берёт title = имя файла без расширения
const FILE_TEXT = `Файловая заметка e2e. Маркер-псевдослово: виджетоборг.`;

async function notesCount(page: Page): Promise<number> {
  const raw = await page.getByTestId('notes-count').textContent();
  return Number((raw ?? '').trim()) || 0;
}

test.describe('База знаний /rag/ingest (админ)', () => {
  test.use({ storageState: undefined });
  test.setTimeout(180_000); // dev-компиляция страницы + эмбеддинги заметки

  test.beforeEach(async ({ page }) => {
    await login(page, '/rag/ingest');
  });

  test('рендер: 3 таба, полоса «Что в базе», блок «Обслуживание»', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'База знаний', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Заметка' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Файл' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Telegram' })).toBeVisible();

    // Полоса «Что в базе» загрузила счётчики партиций (якорим регэкспом: слово
    // «Telegram»/«руководство» встречается ещё и в табах/ссылках «Обслуживания»)
    await expect(page.getByRole('heading', { name: /что в базе/i })).toBeVisible();
    await expect(page.getByTestId('notes-count')).toBeVisible();
    await expect(page.getByText(/^Руководство\s*\d+$/)).toBeVisible();
    await expect(page.getByText(/^Заметки\s*\d+$/)).toBeVisible();
    await expect(page.getByText(/^Telegram\s*\d+$/)).toBeVisible();

    // Старые страницы живы: ссылки «Обслуживания» на месте
    await expect(page.getByText('Обслуживание')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Пересборка встроенного руководства' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Индексация Telegram — расширенная' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Сбор чатов MTProto' })).toBeVisible();
  });

  test('заметка: добавление → «Добавлено N фрагментов» → счётчик вырос → удаление возвращает', async ({
    page,
  }) => {
    const before = await notesCount(page);

    await page.getByLabel('Название').fill(NOTE_TITLE);
    await page.getByLabel('Текст заметки').fill(NOTE_TEXT);
    await page.getByRole('button', { name: 'Добавить в базу' }).click();

    // Форма очищена, зелёная карточка с числом фрагментов (N ≥ 1)
    await expect(page.getByText(/Добавлено \d+ фрагмент/).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByLabel('Название')).toHaveValue('');

    // Счётчик «Заметки» увеличился
    await expect.poll(() => notesCount(page)).toBeGreaterThan(before);

    // Заметка появилась в списке «Что в базе»
    const row = page.getByRole('listitem').filter({ hasText: NOTE_TITLE });
    await expect(row).toBeVisible();

    // Удаление: confirm-диалог (danger) → строка исчезла, счётчик вернулся
    await row.getByRole('button', { name: `Удалить ${NOTE_TITLE}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Удалить заметку из базы?');
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();

    await expect(page.getByRole('listitem').filter({ hasText: NOTE_TITLE })).toHaveCount(0);
    await expect.poll(() => notesCount(page)).toBe(before);
  });

  test('файл .txt: setInputFiles → «Добавлено N фрагментов» → своя заметка удалена', async ({
    page,
  }) => {
    const before = await notesCount(page);

    await page.getByRole('tab', { name: 'Файл' }).click();
    await page
      .getByLabel('Файл')
      .setInputFiles({ name: FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(FILE_TEXT, 'utf8') });
    await page.getByRole('button', { name: 'Добавить в базу' }).click();

    await expect(page.getByText(/Добавлено \d+ фрагмент/).first()).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => notesCount(page)).toBeGreaterThan(before);

    // cleanup: удаляем только свою заметку (инвариант «e2e не удаляют данные»)
    const row = page.getByRole('listitem').filter({ hasText: FILE_BASE });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Удалить ${FILE_BASE}` }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await expect(page.getByRole('listitem').filter({ hasText: FILE_BASE })).toHaveCount(0);
    await expect.poll(() => notesCount(page)).toBe(before);
  });

  test('вкладка Telegram рендерится (MTProto-сбор e2e НЕ запускает)', async ({ page }) => {
    await page.getByRole('tab', { name: 'Telegram' }).click();
    await expect(page.getByLabel('Чат')).toBeVisible();
    await expect(page.getByPlaceholder('@канал или ссылка t.me…')).toBeVisible();
    await expect(page.getByText('Расширенные настройки')).toBeVisible();
    // Пустая форма — кнопка недоступна; «Стоп» неактивен вне прогона. Клик по «Добавить чат» не делаем.
    await expect(page.getByRole('button', { name: 'Добавить чат' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Стоп' })).toBeDisabled();
  });
});

test.describe('База знаний (гость)', () => {
  test.use({ storageState: undefined });

  test('гость на /rag/ingest → редирект /login?next=…', async ({ page }) => {
    await page.goto('/rag/ingest');
    await expect(page).toHaveURL(/\/login\?next=%2Frag%2Fingest$/);
  });
});
