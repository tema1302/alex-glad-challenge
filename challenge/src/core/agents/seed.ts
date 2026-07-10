// Seed: загружает образцы стиля канала «Иди на факты глянь» в БД.
// Запуск: pnpm --filter challenge start -- seed-style
//
// Образцы хранятся в src/data/style-samples.json (13 постов).
// Идемпотентно: повторный запуск не дублирует (UNIQUE на text).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BlogDb } from '../db.js';

// seed.ts лежит в src/core/agents/, до src/data/ — два уровня вверх.
// fileURLToPath(import.meta.url) + path.dirname ≡ import.meta.dirname, но резолвится
// webpack (Next dev-компиляция web/), в отличие от import.meta.dirname на top-level.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_PATH = path.join(HERE, '..', '..', 'data', 'style-samples.json');

export async function seedStyleSamples(_db: BlogDb): Promise<number> {
  const raw = readFileSync(SAMPLES_PATH, 'utf8');
  const samples = JSON.parse(raw) as string[];
  let added = 0;
  for (const text of samples) {
    if (_db.addStyleSample(text)) added++;
  }
  return added;
}
