import type { IContextStrategy, StrategyType } from './types';
import { SlidingWindowStrategy } from './sliding-window';
import { StickyFactsStrategy } from './sticky-facts';
import { BranchingStrategy } from './branching';

export function createStrategy(type: StrategyType, windowSize = 10): IContextStrategy {
  switch (type) {
    case 'sliding':
      return new SlidingWindowStrategy(windowSize);
    case 'sticky':
      return new StickyFactsStrategy(windowSize);
    case 'branching':
      return new BranchingStrategy();
    default:
      return new SlidingWindowStrategy(windowSize);
  }
}

export { SlidingWindowStrategy, StickyFactsStrategy, BranchingStrategy };
export type { IContextStrategy, StrategyType, AiChatMessage, ContextStats, BranchInfo } from './types';
