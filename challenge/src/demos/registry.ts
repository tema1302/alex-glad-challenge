// Реестр всех демо. При добавлении нового дня — добавьте строку сюда.
// CLI читает этот список; расширение новыми днями делается в ветке day-NN.

import type { Demo } from './types.js';
import { demo as day01 } from './day-01.js';
import { demo as day02 } from './day-02.js';
import { demo as day03 } from './day-03.js';
import { demo as day04 } from './day-04.js';
import { demo as day05 } from './day-05.js';
import { demo as day06 } from './day-06.js';
import { demo as day07 } from './day-07.js';
import { demo as day08 } from './day-08.js';
import { demo as day09 } from './day-09.js';
import { demo as day10 } from './day-10.js';

export const demos: ReadonlyArray<Demo> = [
  day01, day02, day03, day04, day05,
  day06, day07, day08, day09, day10,
];

export function findDemo(id: string): Demo | undefined {
  return demos.find((d) => d.id === id);
}

export function latestDemo(): Demo {
  return demos[demos.length - 1];
}
