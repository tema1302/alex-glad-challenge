import { create } from 'zustand';
import { sendChatMessage } from '@/lib/chat-engine';
import { getBuiltinAIConfig, type AIConfig } from '@/lib/zai';
import { useSettingsStore } from '@/stores/useSettingsStore';
import {
  createStrategy,
  type IContextStrategy,
  type StrategyType,
  type BranchInfo,
} from '@/lib/strategies';

const WINDOW_SIZE = 10;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StrategyInstanceState {
  instance: IContextStrategy;
  messages: ChatMessage[];
  totalTokens: number;
}

function createStrategyInstance(strategy: StrategyType): StrategyInstanceState {
  return {
    instance: createStrategy(strategy, WINDOW_SIZE),
    messages: [],
    totalTokens: 0,
  };
}

export interface AiChatState {
  activeStrategy: StrategyType;
  isLoading: boolean;
  strategyInstances: Record<StrategyType, StrategyInstanceState>;
  recallMode: boolean;

  setStrategy: (s: StrategyType) => void;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  loadScenario: (messages: ChatMessage[]) => void;
  createBranch: (label?: string) => void;
  switchBranch: (branchId: string) => void;
  getBranches: () => BranchInfo[];
}

function getAIConfig(): AIConfig {
  const builtin = getBuiltinAIConfig('deepseek') || getBuiltinAIConfig('openrouter');
  if (builtin) return builtin;

  const s = useSettingsStore.getState();
  const provider = s.aiProvider;
  if (provider === 'deepseek') {
    return {
      provider: 'deepseek',
      apiKey: s.deepseekKey || process.env.NEXT_PUBLIC_DEEPSEEK_KEY || '',
      model: 'deepseek-chat',
    };
  }
  if (provider === 'openrouter') {
    return {
      provider: 'openrouter',
      apiKey: s.openrouterKey || process.env.NEXT_PUBLIC_OPENROUTER_KEY || '',
      model: s.openrouterModel || process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
    };
  }
  return {
    provider: 'custom',
    apiKey: s.customApiKey,
    model: s.customModel,
    apiUrl: s.customApiUrl,
  };
}

export const useAiChatStore = create<AiChatState>()((set, get) => ({
  activeStrategy: 'sliding',
  isLoading: false,
  recallMode: false,
  strategyInstances: {
    sliding: createStrategyInstance('sliding'),
    sticky: createStrategyInstance('sticky'),
    branching: createStrategyInstance('branching'),
  },

  setStrategy: (s) => set({ activeStrategy: s }),

  sendMessage: async (text: string) => {
    const state = get();
    if (state.isLoading) return;

    const config = getAIConfig();
    if (!config.apiKey) return;

    const lowerText = text.toLowerCase().trim();
    const isRecall = lowerText.startsWith('/recall');
    const isFacts = lowerText.startsWith('/facts');
    const isDemo = lowerText.startsWith('/demo');

    if (isDemo) {
      const { DEMO_SCENARIO } = await import('@/lib/demo-scenario');
      get().loadScenario(DEMO_SCENARIO);
      return;
    }

    let actualPrompt = text;
    if (isRecall) {
      const customQuestion = text.slice(7).trim();
      actualPrompt = customQuestion ||
        'Вспомни всё что мы обсуждали ранее в этом диалоге. Перечисли ключевые темы, факты и решения. Если ничего не помнишь — так и скажи "не помню".';
    }
    if (isFacts) {
      actualPrompt = 'Перечисли все ключевые факты, договорённости и решения из нашего диалога в виде списка. Если нечего — скажи "контекст пуст".';
    }

    const { activeStrategy, strategyInstances } = state;
    const stratState = strategyInstances[activeStrategy];

    set((s) => ({
      isLoading: true,
      strategyInstances: {
        ...s.strategyInstances,
        [activeStrategy]: {
          ...s.strategyInstances[activeStrategy],
          messages: [...s.strategyInstances[activeStrategy].messages, { role: 'user' as const, content: text }],
        },
      },
    }));

    stratState.instance.addMessage({ role: 'user', content: actualPrompt });

    try {
      const context = stratState.instance.getContext();
      const result = await sendChatMessage(config, context, actualPrompt);

      stratState.instance.addMessage({ role: 'assistant', content: result.content });

      set((s) => ({
        isLoading: false,
        strategyInstances: {
          ...s.strategyInstances,
          [activeStrategy]: {
            ...s.strategyInstances[activeStrategy],
            messages: [...s.strategyInstances[activeStrategy].messages, { role: 'assistant' as const, content: result.content }],
            totalTokens: s.strategyInstances[activeStrategy].totalTokens + result.totalTokens,
          },
        },
      }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      set((s) => ({
        isLoading: false,
        strategyInstances: {
          ...s.strategyInstances,
          [activeStrategy]: {
            ...s.strategyInstances[activeStrategy],
            messages: [...s.strategyInstances[activeStrategy].messages, { role: 'assistant' as const, content: `[Ошибка: ${message}]` }],
          },
        },
      }));
    }
  },

  clearChat: () => {
    set({
      strategyInstances: {
        sliding: createStrategyInstance('sliding'),
        sticky: createStrategyInstance('sticky'),
        branching: createStrategyInstance('branching'),
      },
      isLoading: false,
    });
  },

  loadScenario: (messages: ChatMessage[]) => {
    const freshInstances = {
      sliding: createStrategyInstance('sliding'),
      sticky: createStrategyInstance('sticky'),
      branching: createStrategyInstance('branching'),
    };

    for (const msg of messages) {
      for (const strat of ['sliding', 'sticky', 'branching'] as StrategyType[]) {
        freshInstances[strat].instance.addMessage({ role: msg.role, content: msg.content });
        freshInstances[strat].messages.push({ role: msg.role, content: msg.content });
      }
    }

    set({
      strategyInstances: freshInstances,
      isLoading: false,
    });
  },

  createBranch: (label?: string) => {
    const { strategyInstances } = get();
    const branching = strategyInstances.branching.instance as import('@/lib/strategies/branching').BranchingStrategy;
    branching.createBranch(label);
    set((s) => ({
      strategyInstances: {
        ...s.strategyInstances,
        branching: {
          ...s.strategyInstances.branching,
          messages: branching.getContext().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        },
      },
    }));
  },

  switchBranch: (branchId: string) => {
    const { strategyInstances } = get();
    const branching = strategyInstances.branching.instance as import('@/lib/strategies/branching').BranchingStrategy;
    branching.switchBranch(branchId);
    set((s) => ({
      strategyInstances: {
        ...s.strategyInstances,
        branching: {
          ...s.strategyInstances.branching,
          messages: branching.getContext().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        },
      },
    }));
  },

  getBranches: () => {
    const { strategyInstances } = get();
    const branching = strategyInstances.branching.instance as import('@/lib/strategies/branching').BranchingStrategy;
    return branching.getBranches();
  },
}));
