// Смоук RAG-поиска по telegram-партиции после доклейки чанков Evolute
// (локальный Ollama qwen3-embedding). Запуск:
//   challenge/node_modules/.bin/tsx smoke-rag-evolute.ts "запрос"
import { loadEnvUpward } from './src/core/env.js';
loadEnvUpward();

import { RagStore } from './src/core/rag/store.js';
import { makeEmbedder } from './src/core/rag/embedder.js';
import { dataPath } from './src/core/paths.js';

const CHAT_KEY = '-1001508192874';
const query = process.argv[2] ?? 'новые сообщения за лето';

  const rag = new RagStore(dataPath('rag.sqlite'));
const embedder = makeEmbedder();
try {
  const [vec] = await embedder.embed([query]);
  console.log(`▶ query: «${query}» | dim=${vec.length}`);
  const hits = rag.search('telegram', vec, 5, { chatKey: CHAT_KEY });
  for (const h of hits) {
    console.log(
      `  ${h.score.toFixed(4)} | ${h.chunk.metadata.section} | ${h.chunk.metadata.chunkId}`,
    );
    console.log(`    ${h.chunk.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
} finally {
  rag.close();
}
