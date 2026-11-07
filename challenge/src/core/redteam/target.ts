// PipelineTarget (ADVANCED day-15): атака по реальным примитивам пайплайна.
//
// guardInput/guardOutput/scanSecrets/guards и evaluateSecurityReview — те же
// модули, что в проде; отличие только в LLM-вызовах: вместо gateway —
// scripted LlmCaller (офлайн, детерминированно). Порядок слоёв повторяет
// gateway: input guard → LLM → output guard.

import { guardInput } from '../gateway/inputGuard.js';
import { guardOutput } from '../gateway/outputGuard.js';
import {
  evaluateSecurityReview,
} from '../securityLoop/backstop.js';
import { extractCode, generationPrompt, securityReviewPrompt } from '../securityLoop/prompt.js';
import type { LlmCaller } from '../securityLoop/types.js';
import type { AttackTarget, GenerationVerdict, ReviewStageVerdict, ScanVerdict } from './types.js';

export class PipelineTarget implements AttackTarget {
  readonly name = 'pipeline:gateway+securityLoop (offline scripted llm)';

  scanInput(text: string): ScanVerdict {
    return this.scanInputParts([text]);
  }

  scanInputParts(parts: readonly string[]): ScanVerdict {
    const result = guardInput(parts.map((content) => ({ role: 'user', content })));
    return {
      blocked: result.action === 'blocked',
      redacted: result.action === 'masked',
      kinds: result.summary.map((s) => s.kind),
    };
  }

  scanOutput(text: string, systemPrompt?: string): ScanVerdict {
    const result = guardOutput(text, { systemPrompt });
    return {
      blocked: result.action === 'blocked',
      redacted: result.action === 'redacted',
      kinds: result.findings.map((f) => f.kind),
    };
  }

  async generateAndReview(opts: {
    task: Parameters<typeof generationPrompt>[0];
    generation: LlmCaller;
    review: LlmCaller;
    systemPrompt: string;
  }): Promise<{ generation: GenerationVerdict; review: ReviewStageVerdict | null }> {
    // 1) generation: промпт строит generationPrompt (как в loop).
    const raw = await opts.generation.chat(generationPrompt(opts.task, null, null), {
      stage: 'generation',
    });
    // 2) output guard — тот же слой, что в gateway перед выдачей loop.
    const guarded = guardOutput(raw.content, { systemPrompt: opts.systemPrompt });
    const generation: GenerationVerdict = {
      code: guarded.action === 'blocked' ? null : extractCode(guarded.text),
      blocked: guarded.action === 'blocked',
      kinds: guarded.findings.map((f) => f.kind),
    };
    if (generation.blocked || !generation.code) {
      return { generation, review: null };
    }

    // 3) security review + детерминированный evaluate (parse fail-closed,
    //    backstop, classify) — как в loop перед коммитом.
    const reviewRaw = await opts.review.chat(securityReviewPrompt(opts.task, generation.code), {
      stage: 'security_review',
      temperature: 0,
    });
    const guardedReview = guardOutput(reviewRaw.content, { systemPrompt: opts.systemPrompt });
    const evaluation = evaluateSecurityReview(guardedReview.text, generation.code);
    const review: ReviewStageVerdict = evaluation.ok
      ? {
          decision: evaluation.decision.action,
          blocking: evaluation.decision.blocking.length,
          backstop: evaluation.backstop.length,
        }
      : { decision: 'review_error', blocking: 0, backstop: 0 };
    return { generation, review };
  }
}
