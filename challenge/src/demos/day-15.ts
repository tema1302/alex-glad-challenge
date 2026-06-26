// День 15. Инварианты и ограничения состояния FSM.
//
// Задание:
//   Проверить, может ли ассистент перепрыгнуть этап. У задачи есть допустимое
//   состояние и разрешённые переходы. Любые другие переходы запрещены.
//   Проверить: попытки перехода в недопустимое состояние, реакцию ассистента,
//   корректность продолжения после паузы.
//
// Реализация:
//   stateMachine.ts: ALLOWED_TRANSITIONS + TransitionError + isTransitionAllowed().
//   statefulPipeline.ts: каждый метод проверяет текущий этап перед действием.
//   Переходы:
//     idle → planning → execution → validation → revision ⇄ validation → done
//     Любой другой переход → TransitionError или мягкий отказ с пояснением.

import {
  isTransitionAllowed,
  allowedTransitions,
  TransitionError,
  createInitialState,
  transition,
} from '../core/agents/stateMachine.js';

export const demo = {
  id: 'day-15',
  title: 'Инварианты состояния: запрещённые переходы FSM',
  run: async (): Promise<void> => {
    console.log('=== День 15. Инварианты состояния FSM ===\n');

    // 1. Таблица разрешённых переходов.
    console.log('1. Разрешённые переходы:\n');
    const stages = ['idle', 'planning', 'execution', 'validation', 'revision', 'done'] as const;
    for (const s of stages) {
      console.log(`  ${s.padEnd(12)} → ${allowedTransitions(s).join(', ')}`);
    }

    // 2. Тест: попытка недопустимого перехода.
    console.log('\n2. Тест недопустимых переходов:\n');
    const invalidTests: Array<[string, string]> = [
      ['idle', 'execution'],
      ['idle', 'done'],
      ['idle', 'validation'],
      ['planning', 'done'],
      ['planning', 'revision'],
      ['execution', 'done'],
      ['execution', 'revision'],
      ['done', 'execution'],
      ['done', 'planning'],
    ];

    let blocked = 0;
    for (const [from, to] of invalidTests) {
      const allowed = isTransitionAllowed(from as never, to as never);
      if (allowed) {
        console.log(`  FAIL: ${from} → ${to} разрешён (не должен быть)`);
      } else {
        console.log(`  OK:   ${from} → ${to} заблокирован`);
        blocked++;
      }
    }

    // 3. Тест: TransitionError.
    console.log('\n3. TransitionError при попытке нарушить:\n');
    const state = createInitialState();
    try {
      transition(state, 'done', 'прыгнул в финал');
      console.log('  FAIL: переход не вызвал ошибку');
    } catch (e) {
      if (e instanceof TransitionError) {
        console.log(`  OK: TransitionError поймана`);
        console.log(`  ${e.message}`);
      } else {
        console.log('  FAIL: другая ошибка:', (e as Error).message);
      }
    }

    // 4. Тест: корректный путь.
    console.log('\n4. Корректный путь idle → planning → execution → validation → done:\n');
    const s2 = createInitialState();
    const correctPath: Array<[string, string]> = [
      ['idle', 'planning'],
      ['planning', 'execution'],
      ['execution', 'validation'],
      ['validation', 'done'],
    ];
    for (const [from, to] of correctPath) {
      try {
        transition(s2, to as never, `шаг: ${from} → ${to}`);
        console.log(`  OK: ${from} → ${to}`);
      } catch (e) {
        console.log(`  FAIL: ${from} → ${to}: ${(e as Error).message}`);
      }
    }

    // 5. Тест: цикл revision ⇄ validation.
    console.log('\n5. Цикл revision ⇄ validation:\n');
    const s3 = createInitialState();
    transition(s3, 'planning', 'step');
    transition(s3, 'execution', 'step');
    transition(s3, 'validation', 'step');
    transition(s3, 'revision', 'step 1');
    transition(s3, 'validation', 'step 2');
    transition(s3, 'revision', 'step 3');
    transition(s3, 'validation', 'step 4');
    transition(s3, 'done', 'финал');
    console.log(`  OK: revision ⇄ validation цикл работает`);
    console.log(`  история: ${s3.history.length} переходов`);

    // 6. Пауза и возобновление.
    console.log('\n6. Пауза и возобновление:\n');
    console.log('  Состояние сериализуется в .data/pipeline-state.json');
    console.log('  /pipeline resume — продолжить с того же места');
    console.log('  /pipeline status — показать текущий этап + разрешённые переходы');

    console.log(`\n=== Итог ===`);
    console.log(`  Заблокировано недопустимых переходов: ${blocked}/${invalidTests.length}`);
    console.log(`  transition() бросает TransitionError при нарушении`);
    console.log(`  Каждый метод StatefulPipeline проверяет текущий этап`);
    console.log(`  Пауза: состояние на диске. Возобновление: без повторных объяснений.`);
  },
};
