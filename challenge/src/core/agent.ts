// Агент: хранит system + историю, инкапсулирует вызов LLM.
// Используется в демо 6, 7, 8, 9 — везде, где нужен stateful диалог.

import type { ChatMessage } from './types.js';
import { msg } from './types.js';
import { LlmClient } from './client.js';

export class Agent {
  private systemMessage: ChatMessage;
  private history: ChatMessage[] = [];
  private llm: LlmClient;

  constructor(client: LlmClient, systemPrompt: string) {
    this.llm = client;
    this.systemMessage = msg.system(systemPrompt);
  }

  get system(): ChatMessage {
    return this.systemMessage;
  }

  get messages(): ChatMessage[] {
    return [...this.history];
  }

  async say(userText: string): Promise<string> {
    this.history.push(msg.user(userText));
    const answer = await this.llm.chat([this.systemMessage, ...this.history]);
    this.history.push(msg.assistant(answer));
    return answer;
  }

  // Для day-08/09: прямой доступ к chatWithUsage с произвольным контекстом.
  async chatWithUsage(): Promise<{ content: string; usage: import('./types.js').Usage }> {
    return this.llm.chatWithUsage([this.systemMessage, ...this.history]);
  }

  reset(): void {
    this.history = [];
  }
}
