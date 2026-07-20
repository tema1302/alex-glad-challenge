// Кураторский корпус dev-assistant: явный allow-list .md файлов репозитория.
// НЕ использует loadDocs (loader.ts) — тот рекурсивно обходит корень и берёт
// CODE_EXT (.ts/.js), что зашумляет retrieve структурных вопросов. Явный список
// = surgical и сужается одной правкой массива. Стратегия 'docs' → chunkDoc
// роутится в chunkStructured (chunker.ts тернарник :265, markdown section-aware),
// индексируется через indexDocuments (НЕ runIndexing) — партиции fixed/structure/
// telegram в rag.sqlite не затрагиваются.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Chunk, ChunkingStrategy } from './types.js';
import type { LoadedDoc } from './loader.js';
import { chunkDoc } from './chunker.js';

export const DOCS_STRATEGY: ChunkingStrategy = 'docs';

// Allow-list корпусов dev-assistant. Пути относительно repoRoot (корень
// alex-glad-challenge, НЕ challenge/). Первый рычаг тюнинга retrieve.
const CURATED_REL: readonly string[] = [
  'README.md',
  'AGENTS.md',
  'challenge/README.md',
  'docs/HERMES-DEPLOY-RUNBOOK.md',
  'docs/superpowers/plans/2026-07-11-web-product-redesign.md',
  'docs/superpowers/specs/2026-07-11-web-product-redesign-design.md',
  'challenge/docs/UD33768B_Baseline_Network-Video-Recorder-I-and-M-Series_User-Manual_V4.63.010_20230609.md',
];

export function curatedDocsFiles(): readonly string[] {
  return CURATED_REL;
}

// Поиск корня репозитория вверх от cwd по маркеру AGENTS.md (лежит в корне
// alex-glad-challenge). dev-assistant запускается из challenge/ (cwd), а корпусы
// в корне репо — нужно подняться. Аналогично loadEnvUpward. Fallback — cwd.
export function findRepoRoot(from: string = process.cwd()): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

// Загрузка только allow-list файлов. Пропуск ENOENT (файл переименован/удалён):
// логируем в stderr и пропускаем — корпус устойчив к дрейфу, не падаем.
export async function loadDocsCorpus(repoRoot: string): Promise<LoadedDoc[]> {
  const docs: LoadedDoc[] = [];
  for (const rel of CURATED_REL) {
    const full = path.join(repoRoot, rel);
    let raw: string;
    try {
      raw = await readFile(full, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        process.stderr.write(`[dev-assistant] пропуск: ${rel} (нет файла)\n`);
        continue;
      }
      throw e;
    }
    docs.push({ source: rel, text: raw });
  }
  return docs;
}

// Сборка чанков корпуса через chunkDoc(strategy='docs') → chunkStructured
// (markdown section-aware: один чанк на секцию с заголовком).
export async function buildDocsChunks(repoRoot: string): Promise<Chunk[]> {
  const docs = await loadDocsCorpus(repoRoot);
  const chunks: Chunk[] = [];
  for (const doc of docs) {
    chunks.push(...chunkDoc(doc, DOCS_STRATEGY, {}));
  }
  return chunks;
}
