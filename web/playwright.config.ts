// Playwright E2E для web/. Запуск: pnpm --filter web test:e2e
// Сервер: dev-режим на 3100 (production build на этой машине падает на
// standalone-symlink EPERM — средовое, не связано с кодом). Первые загрузки
// страниц включают dev-компиляцию — таймауты увеличены.
// БЕЗОПАСНОСТЬ: e2e не отправляют ничего в Telegram и не удаляют данные —
// публикация доходит только до confirm-диалога (Esc/Отмена), удаление — до confirm.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false, // общая БД + админ-cookie — сериализуем
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    navigationTimeout: 90_000,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm run dev:test',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
