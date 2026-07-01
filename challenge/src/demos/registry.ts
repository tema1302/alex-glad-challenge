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
import { demo as day11 } from './day-11.js';
import { demo as day12 } from './day-12.js';
import { demo as day13 } from './day-13.js';
import { demo as day14 } from './day-14.js';
import { demo as day15 } from './day-15.js';
import { demo as day16 } from './day-16.js';
import { demo as day17 } from './day-17.js';
import { demo as day18 } from './day-18.js';
import { demo as day20 } from './day-20.js';
import { demo as day21 } from './day-21.js';
import { demo as day22 } from './day-22.js';

export const demos: ReadonlyArray<Demo> = [
  day01, day02, day03, day04, day05,
  day06, day07, day08, day09, day10,
  day11, day12, day13, day14, day15,
  day16,
  day17,
  day18,
  day20,
  day21,
  day22,
];

export function findDemo(id: string): Demo | undefined {
  return demos.find((d) => d.id === id);
}

export function latestDemo(): Demo {
  return demos[demos.length - 1];
}
