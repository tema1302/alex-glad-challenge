// День 13. Конечный автомат pipeline + агент 4 (Reviser).
//
// Задание:
//   Добавить 4-го агента, который переписывает пост по вердикту фактчекера.
//   Реализовать состояние задачи как конечный автомат:
//     planning → execution → validation → revision → done
//   Проверить паузу на любом этапе и продолжение без повторных объяснений.
//
// Реализация:
//   - stateMachine.ts: FSM с сериализацией в .data/pipeline-state.json.
//   - reviser.ts: агент 4, переписывает пост или рекомендует смену новости.
//   - statefulPipeline.ts: orchestrator с пошаговым управлением.
//   - REPL команда /pipeline с подкомандами: run, pick, next, edit, retry,
//     accept, publish, status, resume, reset.
//
// Демо: запускает pipeline, показывает переходы FSM и работу ревизора.

import path from 'node:path';

import { LlmClient, ProfileManager } from '../core/index.js';
import { BlogDb } from '../core/db.js';
import { StatefulPipeline } from '../core/agents/statefulPipeline.js';
import { expectedActionFor } from '../core/agents/stateMachine.js';

export const demo = {
  id: 'day-13',
  title: 'FSM pipeline + агент 4 (Reviser): планирование → исполнение → проверка → правка → done',
  run: async (): Promise<void> => {
    const client = new LlmClient();
    const dbPath = path.join(process.cwd(), '.data', 'blog.sqlite');
    const profilesDir = path.join(process.cwd(), '.data', 'profiles');
    const statePath = path.join(process.cwd(), '.data', 'pipeline-state.json');
    const db = new BlogDb(dbPath);
    const profile = new ProfileManager(profilesDir);
    const profiles = profile.list();
    if (profiles.length > 0) {
      profile.load(profiles.includes('default') ? 'default' : profiles[0]);
    } else {
      profile.create('default');
    }

    const fsm = new StatefulPipeline(db, client, profile, statePath);

    console.log('=== День 13. FSM pipeline + агент 4 (Reviser) ===\n');

    // 1. Planning.
    console.log('1. Запуск FSM: planning (RSS + агент 1)...\n');
    const r1 = await fsm.run(48, 2);
    console.log(r1.output);
    printFsm(fsm);

    // 2. Execution (pick + auto execution + validation).
    console.log('\n2. Pick новости №0 → execution → validation...\n');
    const r2 = await fsm.pick(0);
    console.log(r2.output);
    printFsm(fsm);

    // 3. Проверка результата.
    console.log('\n3. Текущее состояние:\n');
    console.log(fsm.status());

    // 4. Если needs_revision — пробуем ревизора.
    if (fsm.current.stage === 'revision') {
      console.log('\n4. Агент 4 (Reviser): авто-правка...\n');
      const r4 = await fsm.autoRevise();
      console.log(r4.output);
      printFsm(fsm);
    }

    // 5. Если всё ещё needs_revision — ручная правка.
    if (fsm.current.stage === 'revision') {
      console.log('\n5. Ручная правка: "сделай короче и убери лишнее"...\n');
      const r5 = await fsm.manualEdit('сделай короче и убери лишнее');
      console.log(r5.output);
      printFsm(fsm);
    }

    // 6. Финализация.
    if (fsm.current.stage === 'done') {
      console.log('\n6. Финал:\n');
      fsm.finalize();
      printFsm(fsm);
    }

    // 7. Демонстрация паузы/возобновления.
    console.log('\n7. Демонстрация паузы:\n');
    fsm.reset();
    console.log('   reset →', fsm.current.stage);
    console.log('   ожидается:', expectedActionFor(fsm.current.stage));

    db.close();

    console.log('\n=== Вывод ===');
    console.log('FSM: idle → planning → execution → validation → revision → done');
    console.log('Агент 4 (Reviser): переписывает пост по issues фактчекера');
    console.log('Состояние сериализуется в .data/pipeline-state.json');
    console.log('Пауза: на любом этапе. Возобновление: /pipeline resume');
    console.log('Команда: /pipeline <run|pick|next|edit|retry|accept|publish|status|resume|reset>');
  },
};

function printFsm(fsm: StatefulPipeline): void {
  const s = fsm.current;
  console.log(`  [FSM] stage=${s.stage}, step="${s.step}", revisions=${s.revisionCount}`);
}
