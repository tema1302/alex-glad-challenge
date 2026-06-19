// День 12. Персонализация поверх модели памяти.
//
// Задание:
//   Создайте профиль пользователя, опишите предпочтения (стиль, формат,
//   ограничения), подключите профиль к каждому запросу. Автоматизируйте
//   создание постов с учётом профиля.
//
// Реализация: core/profile.ts (класс ProfileManager).
//   Много профилей в .data/profiles/<name>.json, активный один.
//   Редактирование естественным языком: /profile-edit <текст>.
//
// Демо:
//   1. Создаём два профиля: 'default' (Челси) и 'arsenal' (копия + изменения).
//   2. Редактируем 'arsenal' через LLM: "сделай стиль аналитическим".
//   3. Прогон pipeline с каждым профилем — сравниваем посты.

import path from 'node:path';

import { LlmClient, ProfileManager } from '../core/index.js';
import { BlogDb } from '../core/db.js';
import { runNewsPipeline } from '../core/agents/pipeline.js';

export const demo = {
  id: 'day-12',
  title: 'Персонализация: мульти-профили + LLM-редактирование',
  run: async (): Promise<void> => {
    const client = new LlmClient();
    const dbPath = path.join(process.cwd(), '.data', 'blog.sqlite');
    const profilesDir = path.join(process.cwd(), '.data', 'profiles');
    const db = new BlogDb(dbPath);
    const mgr = new ProfileManager(profilesDir);

    console.log('=== День 12. Персонализация поверх модели памяти ===\n');

    // 1. Профиль по умолчанию.
    console.log('1. Создаём профиль "default":');
    mgr.create('default');
    printProfileBlock(mgr);

    // 2. Копируем и редактируем через LLM.
    console.log('\n2. Копируем в "arsenal" и редактируем через LLM...');
    mgr.copy('arsenal');
    mgr.load('arsenal');
    console.log('   LLM: "смени клуб на Арсенал, стиль сделай аналитическим и спокойным, убери эмодзи"');
    const diff = await mgr.editViaLLM(
      'смени клуб на Арсенал, стиль сделай аналитическим и спокойным, убери эмодзи',
      client,
    );
    console.log('   Изменения:\n' + diff);

    // 3. Прогон pipeline с профилем 'default'.
    console.log('\n3. Прогон pipeline с профилем "default" (Челси, ироничный)...\n');
    mgr.load('default');
    const result1 = await runNewsPipeline(db, client, {
      maxAgeHours: 48, topK: 2, writeForIndex: 0, profile: mgr,
    });
    if (result1.post) {
      console.log('\n--- Пост (default) ---');
      console.log(result1.post.content.slice(0, 300) + '...');
    }

    // 4. Прогон pipeline с профилем 'arsenal'.
    console.log('\n\n4. Прогон pipeline с профилем "arsenal"...\n');
    mgr.load('arsenal');
    const result2 = await runNewsPipeline(db, client, {
      maxAgeHours: 48, topK: 2, writeForIndex: 0, profile: mgr,
    });
    if (result2.post) {
      console.log('\n--- Пост (arsenal) ---');
      console.log(result2.post.content.slice(0, 300) + '...');
    }

    // 5. Список профилей.
    console.log('\n\n5. Профили в системе:');
    for (const name of mgr.list()) {
      const marker = name === mgr.activeName ? ' *' : '  ';
      console.log(`${marker} ${name}`);
    }

    db.close();

    console.log('\n=== Вывод ===');
    console.log('Профили: мульти, каждый в .data/profiles/<name>.json.');
    console.log('Активный один, переключение: /profile-use <name>.');
    console.log('Редактирование через LLM: /profile-edit <естественный текст>.');
    console.log('Каждый запрос PostWriter работает в рамках активного профиля.');
  },
};

function printProfileBlock(mgr: ProfileManager): void {
  if (!mgr.active) return;
  const snap = mgr.snapshot();
  for (const key of mgr.fields) {
    console.log(`  ${key}: ${snap[key]}`);
  }
}
