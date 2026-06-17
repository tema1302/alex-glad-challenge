// core: общая библиотека для всех дней челленджа.
// LLM-клиент с OpenAI-совместимым Chat Completions API + типы + стратегии контекста.

export type { ChatMessage, Role, LlmRequest, LlmResponse, Usage, ChatParams } from './types.js';
export { msg } from './types.js';
export { LlmClient } from './client.js';
export type { ProviderConfig } from './client.js';
export type { ContextStrategy, ContextStats } from './strategy.js';
export { FullHistory, SlidingWindow, StickyFacts, Branching } from './strategy.js';
