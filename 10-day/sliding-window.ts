import type { AiChatMessage, ContextStats, IContextStrategy } from './types';

export class SlidingWindowStrategy implements IContextStrategy {
  private fullHistory: AiChatMessage[] = [];
  private windowSize: number;

  constructor(windowSize = 10) {
    this.windowSize = windowSize;
  }

  addMessage(msg: Omit<AiChatMessage, 'timestamp'>): void {
    this.fullHistory.push({ ...msg, timestamp: Date.now() });
  }

  getContext(): AiChatMessage[] {
    return this.fullHistory.slice(-this.windowSize);
  }

  getStats(): ContextStats {
    const active = this.getContext();
    return {
      totalMessages: this.fullHistory.length,
      activeMessages: active.length,
      messagesDropped: Math.max(0, this.fullHistory.length - this.windowSize),
      estimatedTokens: this.estimateTokens(active),
      details: {
        windowSize: this.windowSize,
      },
    };
  }

  clear(): void {
    this.fullHistory = [];
  }

  estimateTokens(messages: AiChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);
      total += 4;
    }
    return total;
  }
}
