// cwd-независимый резолвер путей к runtime-данным (.data/).
//
// Раньше модули считали путь от process.cwd(): работает только при запуске из
// challenge/ (CLI через tsx). Web-пакет (Next.js) запускается из web/ — старая
// схема уводила бы .data/ в неправильное место. DATA_DIR считает от расположения
// самого файла (challenge/src/core/paths.ts → challenge/.data), override через env.
//
// Не использует .js-импорты: только node:builtins.

import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// challenge/src/core/ → ../.. → challenge/ → .data
const DEFAULT_DATA_DIR = path.resolve(HERE, '../..', '.data');

export const DATA_DIR: string =
  process.env.CHALLENGE_DATA_DIR?.trim() || DEFAULT_DATA_DIR;

/** Полный путь к файлу/директории внутри .data/. Сегменты склеиваются через path.join. */
export function dataPath(...segs: string[]): string {
  return path.join(DATA_DIR, ...segs);
}
