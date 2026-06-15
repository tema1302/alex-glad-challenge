import type { AiChatMessage, ContextStats, IContextStrategy } from './types';

interface FactPattern {
  key: string;
  patterns: RegExp[];
}

const FACT_PATTERNS: FactPattern[] = [
  {
    key: 'цель',
    patterns: [
      /(?:цель|задача|мне нужно|я хочу|необходимо)[\s:]+([^\n.!?]{5,120})/gi,
      /(?:goal|task|I need|I want|we need)[\s:]+([^\n.!?]{5,120})/gi,
    ],
  },
  {
    key: 'стек',
    patterns: [
      /(?:используем|стек|технологи\w*|фреймворк|язык)[\s:]+([^\n.!?]{3,100})/gi,
      /(?:using|stack|tech|framework|language)[\s:]+([^\n.!?]{3,100})/gi,
    ],
  },
  {
    key: 'бюджет',
    patterns: [
      /(?:бюджет|стоимость|цена|бюджет)[\s:]+([^\n.!?]{3,80})/gi,
      /(?:budget|cost|price)[\s:]+([^\n.!?]{3,80})/gi,
    ],
  },
  {
    key: 'срок',
    patterns: [
      /(?:дедлайн|срок|до|крайний|время на)[\s:]+([^\n.!?]{3,80})/gi,
      /(?:deadline|due by|timeline|timeframe)[\s:]+([^\n.!?]{3,80})/gi,
    ],
  },
  {
    key: 'аудитория',
    patterns: [
      /(?:пользовател\w*|аудитори\w*|клиент\w*|заказчик)[\s:]+([^\n.!?]{3,100})/gi,
      /(?:users?|audience|clients?|customers?)[\s:]+([^\n.!?]{3,100})/gi,
    ],
  },
  {
    key: 'ограничение',
    patterns: [
      /(?:ограничени\w*|нельзя|не используем|не надо|избегаем)[\s:]+([^\n.!?]{3,100})/gi,
      /(?:constraint|cannot|don't use|avoid|limitation)[\s:]+([^\n.!?]{3,100})/gi,
    ],
  },
  {
    key: 'решение',
    patterns: [
      /(?:решили|договорились|давай|итак|окей[,\s]+значит|хорошо[,\s]+тогда)[\s:]+([^\n.!?]{5,120})/gi,
      /(?:decided|agreed|let's|so[,\s]+we'll|alright[,\s]+then)[\s:]+([^\n.!?]{5,120})/gi,
    ],
  },
  {
    key: 'предпочтение',
    patterns: [
      /(?:предпочита\w*|лучше использовать|важно что|приоритет)[\s:]+([^\n.!?]{3,100})/gi,
      /(?:prefer|better to use|important that|priority)[\s:]+([^\n.!?]{3,100})/gi,
    ],
  },
];

function extractFacts(text: string, existingFacts: Map<string, string>): Map<string, string> {
  const facts = new Map(existingFacts);

  for (const { key, patterns } of FACT_PATTERNS) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = pattern.exec(text)) !== null && count < 3) {
        const value = match[1].trim();
        if (value.length < 3) continue;

        const factKey = count === 0 ? key : `${key}_${count + 1}`;
        facts.set(factKey, value);
        count++;
      }
    }
  }

  return facts;
}

function formatFactsBlock(facts: Map<string, string>): string {
  if (facts.size === 0) return '';
  const lines = Array.from(facts.entries()).map(([k, v]) => `- ${k}: ${v}`);
  return `[Ключевые факты из диалога]\n${lines.join('\n')}`;
}

export class StickyFactsStrategy implements IContextStrategy {
  private messages: AiChatMessage[] = [];
  private facts = new Map<string, string>();
  private windowSize: number;

  constructor(windowSize = 10) {
    this.windowSize = windowSize;
  }

  addMessage(msg: Omit<AiChatMessage, 'timestamp'>): void {
    const message: AiChatMessage = { ...msg, timestamp: Date.now() };
    this.messages.push(message);

    if (msg.role === 'user') {
      this.facts = extractFacts(msg.content, this.facts);
    }
  }

  getContext(): AiChatMessage[] {
    const context: AiChatMessage[] = [];
    const factsBlock = formatFactsBlock(this.facts);
    if (factsBlock) {
      context.push({ role: 'system', content: factsBlock, timestamp: 0 });
    }
    context.push(...this.messages.slice(-this.windowSize));
    return context;
  }

  getStats(): ContextStats {
    const active = this.getContext();
    const factsBlock = formatFactsBlock(this.facts);
    return {
      totalMessages: this.messages.length,
      activeMessages: active.length,
      messagesDropped: Math.max(0, this.messages.length - this.windowSize),
      estimatedTokens: this.estimateTokens(active),
      details: {
        factsCount: this.facts.size,
        factsTokens: factsBlock ? Math.ceil(factsBlock.length / 4) : 0,
        windowSize: this.windowSize,
        facts: Object.fromEntries(this.facts),
      },
    };
  }

  clear(): void {
    this.messages = [];
    this.facts.clear();
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
