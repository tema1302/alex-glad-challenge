// Barrel модуля TG-топик-коллектора ( НЕ день челленджа — standalone-фича).
// Сырые сообщения → .data/tg.sqlite (tgStore) → RAG-индекс strategy='telegram'.

export { TgStore } from './tgStore.js';
export type { TgMessageRow, CollectStateRow, TgStats } from './tgStore.js';

export {
  summarizeReactions,
  parseChatTopicInput,
  resolveChatTopic,
  resolveChatKey,
  listForumTopicIds,
  probeTopic,
  probeTopicViaSearch,
  collectTopic,
  messageToChunk,
  buildTopicChunks,
  assertDimCompatible,
} from './topicCollector.js';
export type {
  ReactionSummary,
  ChatTopicRef,
  ProbeMessage,
  CollectOpts,
  CollectResult,
  TgBuiltChunk,
  TopicChunkOpts,
} from './topicCollector.js';
