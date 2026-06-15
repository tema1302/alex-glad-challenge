import type { AiChatMessage, BranchInfo, ContextStats, IContextStrategy } from './types';

interface BranchNode {
  id: string;
  label: string;
  parentId: string | null;
  messages: AiChatMessage[];
  createdAt: number;
}

let branchCounter = 0;

function generateBranchId(): string {
  branchCounter++;
  return `branch_${Date.now()}_${branchCounter}`;
}

export class BranchingStrategy implements IContextStrategy {
  private branches: Map<string, BranchNode> = new Map();
  private activeBranchId: string;
  private fullHistory: AiChatMessage[] = [];

  constructor() {
    const main: BranchNode = {
      id: 'main',
      label: 'Main',
      parentId: null,
      messages: [],
      createdAt: Date.now(),
    };
    this.branches.set('main', main);
    this.activeBranchId = 'main';
  }

  addMessage(msg: Omit<AiChatMessage, 'timestamp'>): void {
    const message: AiChatMessage = { ...msg, timestamp: Date.now() };
    const branch = this.branches.get(this.activeBranchId);
    if (branch) {
      branch.messages.push(message);
    }
    this.fullHistory.push(message);
  }

  getContext(): AiChatMessage[] {
    const branch = this.branches.get(this.activeBranchId);
    if (!branch) return [];
    return [...branch.messages];
  }

  createBranch(label?: string): string {
    const parent = this.branches.get(this.activeBranchId);
    if (!parent) return this.activeBranchId;

    const branchLabel = label || `Branch ${String.fromCharCode(65 + (this.branches.size - 1))}`;
    const newId = generateBranchId();
    const newBranch: BranchNode = {
      id: newId,
      label: branchLabel,
      parentId: parent.id,
      messages: [...parent.messages],
      createdAt: Date.now(),
    };
    this.branches.set(newId, newBranch);
    this.activeBranchId = newId;
    return newId;
  }

  switchBranch(branchId: string): void {
    if (this.branches.has(branchId)) {
      this.activeBranchId = branchId;
    }
  }

  getActiveBranchId(): string {
    return this.activeBranchId;
  }

  getBranches(): BranchInfo[] {
    return Array.from(this.branches.values()).map((b) => ({
      id: b.id,
      label: b.label,
      parentId: b.parentId,
      messageCount: b.messages.length,
      createdAt: b.createdAt,
    }));
  }

  getStats(): ContextStats {
    const active = this.getContext();
    const branchList = this.getBranches();
    const activeBranch = this.branches.get(this.activeBranchId);
    return {
      totalMessages: this.fullHistory.length,
      activeMessages: active.length,
      messagesDropped: 0,
      estimatedTokens: this.estimateTokens(active),
      details: {
        activeBranch: activeBranch?.label ?? 'Main',
        activeBranchId: this.activeBranchId,
        totalBranches: branchList.length,
        branches: branchList,
      },
    };
  }

  clear(): void {
    this.branches.clear();
    this.fullHistory = [];
    branchCounter = 0;
    const main: BranchNode = {
      id: 'main',
      label: 'Main',
      parentId: null,
      messages: [],
      createdAt: Date.now(),
    };
    this.branches.set('main', main);
    this.activeBranchId = 'main';
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
