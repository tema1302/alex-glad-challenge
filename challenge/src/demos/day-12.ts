// День 12. Персонализация поверх модели памяти.
//
// Задание:
//   Создайте профиль пользователя, опишите предпочтения (стиль, формат,
//   ограничения), подключите профиль к каждому запросу. Автоматизируйте
//   создание постов с учётом профиля.
//
// Реализация: core/profile.ts (класс Profile).
//   Профиль хранится в .data/profile.json, переживает перезапуск.
//   Подключается к PostWriter (агент 2) и к REPL (каждый запрос).
//
// Демо: два прогона блог-pipeline с разным профилем.
//   1. Профиль "по умолчанию" (Челси, ироничный стиль).
//   2. Меняем профиль: любимый клуб = Арсенал, стиль = аналитический.
//   Сравниваем посты — они должны отличаться по тону и углу повествования.

import path from 'node:path';

import { LlmClient, Profile } from '../core/index.js';
import { BlogDb } from '../core/db.js';
import { runNewsPipeline } from '../core/agents/pipeline.js';

export const demo = {
  id: 'day-12',
  title: 'Персонализация: профиль пользователя в каждом запросе',
  run: async (): Promise<void> => {
    const client = new LlmClient();
    const dbPath = path.join(process.cwd(), '.data', 'blog.sqlite');
    const profilePath = path.join(process.cwd(), '.data', 'profile.json');
    const db = new BlogDb(dbPath);
    const profile = new Profile(profilePath);
    profile.load();

    console.log('=== День 12. Персонализация поверх модели памяти ===\n');

    // 1. Показываем профиль по умолчанию.
    console.log('1. Профиль по умолчанию:');
    printProfileBlock(profile);

    // 2. Прогон pipeline с профилем по умолчанию.
    console.log('\n2. Прогон #1: блог-pipeline с профилем по умолчанию...\n');
    const result1 = await runNewsPipeline(db, client, {
      maxAgeHours: 48,
      topK: 2,
      writeForIndex: 0,
      profile,
    });

    if (result1.post) {
      console.log('\n--- Пост (профиль: Челси, ироничный) ---');
      console.log(result1.post.content);
    }

    // 3. Меняем профиль.
    console.log('\n\n3. Меняем профиль: клуб = Арсенал, стиль = аналитический...');
    profile.set('любимый_клуб', 'Арсенал');
    profile.set('стиль', 'аналитический, спокойный, с цифрами');
    profile.set('подпись', '@gunnersfacts');
    profile.save();
    printProfileBlock(profile);

    // 4. Прогон pipeline с новым профилем.
    console.log('\n4. Прогон #2: блог-pipeline с новым профилем...\n');
    const result2 = await runNewsPipeline(db, client, {
      maxAgeHours: 48,
      topK: 2,
      writeForIndex: 0,
      profile,
    });

    if (result2.post) {
      console.log('\n--- Пост (профиль: Арсенал, аналитический) ---');
      console.log(result2.post.content);
    }

    // 5. Восстанавливаем профиль по умолчанию.
    console.log('\n\n5. Восстанавливаем профиль по умолчанию...');
    profile.reset();
    profile.save();
    printProfileBlock(profile);

    db.close();

    console.log('\n=== Вывод ===');
    console.log('Профиль подключается к каждому запросу PostWriter.');
    console.log('При смене клуба/стила посты меняют угол повествования и тон.');
    console.log('Профиль хранится в .data/profile.json (переживает перезапуск).');
    console.log('Управление через REPL: /profile, /profile-set, /profile-reset.');
  },
};

function printProfileBlock(profile: Profile): void {
  const snap = profile.snapshot();
  for (const key of profile.fields) {
    console.log(`  ${key}: ${snap[key]}`);
  }
}
