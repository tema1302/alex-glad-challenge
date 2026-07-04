// День 24. Цитаты + guard «не знаю» в RAG.
//
// Расширение контракта RAG-ответа: (1) детерминированные цитаты из найденных чанков
// (extractQuotes — без LLM), (2) guard — детерминированный короткий возврат
// «не знаю» БЕЗ вызова LLM при пустом/слабом контексте (decideGuard + GUARD_ANSWER).
//
// ВАЖНО: демо СТАТИЧЕСКОЕ. Не зовёт ни LLM, ни embedder, ни индекс. Индекс READ-ONLY.
// makeLocalLlmClient / RagStore / Retriever НЕ импортируются — гарантия offline-smoke.
// Упражняет чистые функции (extractQuotes, decideGuard, computeDay24Metrics) и
// показывает контракт RagAnswer на синтетических данных.
//
// Запуск:
//   pnpm --filter challenge start -- day-24

import path from 'node:path';

import {
  extractQuotes,
  decideGuard,
  GUARD_ANSWER,
  computeDay24Metrics,
  loadEval,
} from '../core/rag/index.js';
import type {
  ScoredChunk,
  Chunk,
  ChunkMetadata,
  RagAnswer,
  RagDebug,
  Day24Metrics,
} from '../core/rag/index.js';
import type { Demo } from './types.js';

const EVAL_FILE = path.join(process.cwd(), 'src', 'data', 'rag-eval-day24.json');

function truncate(s: string, max = 320): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

// Компактный конструктор RagDebug для синтетических строк (все обязательные поля).
function mkDebug(gaveUp: boolean): RagDebug {
  return {
    poolSize: 0,
    filteredSize: gaveUp ? 0 : 1,
    threshold: 0.5,
    rerankApplied: false,
    fallback: false,
    rankDelta: 0,
    rewritten: false,
    gaveUp,
  };
}

// Конструктор синтетического чанка (фрагмент мануала EVOLUTE i-SPACE).
function chunk(source: string, section: string, chunkId: string, text: string): Chunk {
  const metadata: ChunkMetadata = { source, title: source, section, chunkId };
  return { text, metadata };
}

function scored(chunkData: Chunk, score: number): ScoredChunk {
  return { chunk: chunkData, score };
}

const SRC = 'evolute-i-space-2025.md';

// Синтетические чанки для extractQuotes (реальные темы мануала).
const CHARGING_TEXT =
  'Домашняя зарядная станция переменного тока мощностью 7 кВт рекомендуется для ' +
  'повседневной зарядки. Портативное зарядное устройство имеет мощность менее 3 кВт. ' +
  'Перед зарядкой при низкой температуре батарею необходимо прогреть.';

const TIRES_TEXT =
  'Давление в холодных шинах рекомендуется проверять утром. Показания манометра на ' +
  'горячих шинах примерно на 30–40 кПа выше, чем на холодных — это нормально. ' +
  'Давление можно отображать в кПа или psi на выбор.';

function printHeader(title: string): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log(title);
  console.log('='.repeat(72));
}

// Этап 1: контракт RagAnswer — состав ответа RAG после расширения дня 24.
function stage1Contract(): void {
  printHeader('Этап 1: контракт RagAnswer (ответ + источники + цитаты + debug.gaveUp)');
  const synthetic: RagAnswer = {
    answer: 'Для повседневной зарядки рекомендуется домашняя станция переменного тока мощностью 7 кВт [1].',
    sources: [scored(chunk(SRC, 'Зарядка > Домашняя станция', 'evolute-i-space-2025.md::42', CHARGING_TEXT), 0.612)],
    quotes: extractQuotes(
      [scored(chunk(SRC, 'Зарядка > Домашняя станция', 'evolute-i-space-2025.md::42', CHARGING_TEXT), 0.612)],
      'Какая мощность рекомендуется для домашней зарядной станции переменного тока?',
    ),
    debug: mkDebug(false),
  };
  console.log(`answer:  ${truncate(synthetic.answer, 100)}`);
  console.log(`sources: ${synthetic.sources.length} chunk(s), top score=${synthetic.sources[0].score.toFixed(3)}`);
  console.log(`quotes:  ${synthetic.quotes?.length ?? 0} quote(s)`);
  console.log(`  → [${synthetic.quotes?.[0].chunkId}] ${truncate(synthetic.quotes?.[0].snippet ?? '', 90)}`);
  console.log(`debug:   gaveUp=${synthetic.debug?.gaveUp}, filteredSize=${synthetic.debug?.filteredSize}`);
}

// Этап 2: extractQuotes — term-match ветка и fallback ветка (оба snippet непустые).
function stage2ExtractQuotes(): void {
  printHeader('Этап 2: extractQuotes (детерминированно, без LLM)');
  const question = 'Какая мощность рекомендуется для домашней зарядной станции переменного тока?';
  const ranked: ScoredChunk[] = [
    scored(chunk(SRC, 'Зарядка > Домашняя станция', 'evolute-i-space-2025.md::42', CHARGING_TEXT), 0.612),
    scored(chunk(SRC, 'Шины > Давление', 'evolute-i-space-2025.md::58', TIRES_TEXT), 0.341),
  ];
  const quotes = extractQuotes(ranked, question);
  console.log(`Вопрос: ${question}`);
  console.log(`Цитат извлечено: ${quotes.length} (по одной на чанк)`);
  let i = 1;
  for (const q of quotes) {
    console.log(`  [${i}] ${q.chunkId} (score=${ranked[i - 1].score.toFixed(3)})`);
    console.log(`      section: ${q.section}`);
    console.log(`      snippet: ${truncate(q.snippet, 110)}`);
    i++;
  }
  console.log('  → чанк 1: term-match (мощность/зарядной/станции) → предложение про 7 кВт;');
  console.log('  → чанк 2: 0 попаданий → fallback на начало текста (давление).');
}

// Этап 3: decideGuard — 4 случая; при gaveUp печатаем GUARD_ANSWER (LLM не зовётся).
function stage3Guard(): void {
  printHeader('Этап 3: decideGuard — шорт-кёркт «не знаю» без вызова LLM');
  const floor = 0.5;
  const cases: { label: string; filtered: ScoredChunk[]; minScore?: number }[] = [
    { label: 'empty (filtered=[])', filtered: [], minScore: undefined },
    { label: 'floor (maxScore<minScore)', filtered: [scored(chunk(SRC, 'X', 'c::1', 'текст'), 0.3)], minScore: floor },
    { label: 'pass (maxScore≥minScore)', filtered: [scored(chunk(SRC, 'X', 'c::1', 'текст'), 0.6)], minScore: floor },
    { label: 'pass (minScore не задан)', filtered: [scored(chunk(SRC, 'X', 'c::1', 'текст'), 0.55)], minScore: undefined },
  ];
  for (const c of cases) {
    const g = decideGuard(c.filtered, c.minScore);
    const tag = g.gaveUp ? `GAVE UP (${g.reason})` : `pass (maxScore=${g.maxScore.toFixed(3)})`;
    console.log(`  ${c.label.padEnd(28)} → ${tag}`);
    if (g.gaveUp) {
      console.log(`    → ответ БЕЗ LLM: ${truncate(GUARD_ANSWER, 90)}`);
    }
  }
}

// Этап 4: 10 вопросов broad→narrow из rag-eval-day24.json; q10 = expectedGuard.
async function stage4Questions(): Promise<void> {
  printHeader('Этап 4: 10 вопросов broad→narrow (offline-инспекция, LLM НЕ зовётся)');
  const questions = await loadEval(EVAL_FILE);
  console.log(`Загружено: ${questions.length} вопросов из ${path.basename(EVAL_FILE)}`);
  console.log('');
  console.log('  id | level         | expectedGuard | вопрос');
  console.log('  ---|---------------|---------------|--------');
  for (const q of questions) {
    const level = (q.level ?? '-').padEnd(13);
    const guard = q.expectedGuard ? 'true ' : 'false';
    console.log(`  ${String(q.id).padStart(2)} | ${level} | ${guard}         | ${truncate(q.q, 60)}`);
  }
  const guardQs = questions.filter((q) => q.expectedGuard).map((q) => q.id);
  console.log(`\n  → expectedGuard=true у вопросов: ${guardQs.join(', ')}`);
}

// Этап 5: computeDay24Metrics на синтетическом RagAnswer[] (3 строки).
function stage5Metrics(): void {
  printHeader('Этап 5: computeDay24Metrics (pure, без LLM-judge)');
  const rows: { answer: RagAnswer }[] = [
    {
      // Полный ответ: sources + quotes + [1] маркер.
      answer: {
        answer: 'Рекомендуется станция переменного тока мощностью 7 кВт [1].',
        sources: [scored(chunk(SRC, 'Зарядка', 'c::42', CHARGING_TEXT), 0.6)],
        quotes: extractQuotes(
          [scored(chunk(SRC, 'Зарядка', 'c::42', CHARGING_TEXT), 0.6)],
          'Какая мощность рекомендуется для зарядной станции?',
        ),
        debug: mkDebug(false),
      },
    },
    {
      // Guard: sources=[], quotes=undefined, gaveUp=true, ответ без [n].
      answer: { answer: GUARD_ANSWER, sources: [], debug: mkDebug(true) },
    },
    {
      // Ответ есть, но без маркера [n] (LLM забыла сослаться).
      answer: {
        answer: 'Давление в горячих шинах выше на 30–40 кПа.',
        sources: [scored(chunk(SRC, 'Шины', 'c::58', TIRES_TEXT), 0.55)],
        debug: mkDebug(false),
      },
    },
  ];
  const m: Day24Metrics = computeDay24Metrics(rows);
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  console.log(`Строк: ${m.questions}`);
  console.log(`  sourcesCoverage:        ${pct(m.sourcesCoverage)} (доля с sources.length>0)`);
  console.log(`  quotesCoverage:         ${pct(m.quotesCoverage)} (доля с quotes.length>0)`);
  console.log(`  guardTriggered:         ${pct(m.guardTriggered)} (доля с debug.gaveUp=true)`);
  console.log(`  answerHasCitationMarker ${pct(m.answerHasCitationMarker)} (доля ответов с [n])`);
  console.log('  → «смысл = цитаты» сверяется вручную в финальном Report (не автоматика).');
}

async function run(): Promise<void> {
  console.log('▶ День 24: цитаты + guard «не знаю» в RAG');
  console.log('  режим:     статический smoke (LLM/индекс НЕ задействуются)');
  console.log('  индекс:    read-only (не реиндексируем)');
  console.log('  вопросы:   ' + path.basename(EVAL_FILE) + ' (offline-инспекция)');
  console.log('  операции:  extractQuotes, decideGuard, computeDay24Metrics (pure)');

  stage1Contract();
  stage2ExtractQuotes();
  stage3Guard();
  await stage4Questions();
  stage5Metrics();

  console.log(`\n${'='.repeat(72)}`);
  console.log('Готово: день 24, LLM не вызвана, индекс не изменён.');
}

export const demo: Demo = {
  id: 'day-24',
  title: 'Цитаты и guard «не знаю» в RAG (extractQuotes, decideGuard, метрики)',
  run,
};
