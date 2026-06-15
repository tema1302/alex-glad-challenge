export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ContextStats {
  totalMessages: number;
  activeMessages: number;
  messagesDropped: number;
  estimatedTokens: number;
  details: Record<string, unknown>;
}

export interface BranchInfo {
  id: string;
  label: string;
  parentId: string | null;
  messageCount: number;
  createdAt: number;
}

export interface IContextStrategy {
  addMessage(msg: Omit<AiChatMessage, 'timestamp'>): void;
  getContext(): AiChatMessage[];
  getStats(): ContextStats;
  clear(): void;
  estimateTokens(messages: AiChatMessage[]): number;
}

export type StrategyType = 'sliding' | 'sticky' | 'branching';
