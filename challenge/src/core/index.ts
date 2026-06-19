// core: общая библиотека монолита.
// LLM-клиент с OpenAI-совместимым Chat Completions API + типы + стратегии контекста + блог-агенты.

export type { ChatMessage, Role, LlmRequest, LlmResponse, Usage, ChatParams } from './types.js';
export { msg } from './types.js';
export { LlmClient } from './client.js';
export type { ProviderConfig } from './client.js';
export { Agent } from './agent.js';
export type { ContextStrategy, ContextStats } from './strategy.js';
export { FullHistory, SlidingWindow, StickyFacts, Branching } from './strategy.js';
export { loadEnvUpward } from './env.js';
export { Memory } from './memory.js';
export type { LongTermEntry, MemorySnapshot } from './memory.js';

export { BlogDb } from './db.js';
export type { NewsRow, PostRow, StyleSampleRow } from './db.js';
export * as agents from './agents/index.js';
