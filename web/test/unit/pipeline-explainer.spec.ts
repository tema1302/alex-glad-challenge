// Пояснения FSM конвейера: покрытие всех стадий схемы, связность текстов.
// Карта PIPELINE_STAGE_EXPLAINER должна зеркалить pipelineStageSchema —
// рассинхрон ловим здесь (typecheck сам не сравнит Record с enum runtime).
import { describe, expect, it } from 'vitest';
import { pipelineStageSchema, type PipelineStageInput } from '../../lib/shared/forms';
import {
  PIPELINE_STAGE_EXPLAINER,
  PIPELINE_INTRO,
} from '../../lib/shared/pipeline-explainer';

const STAGES = pipelineStageSchema.options;

describe('PIPELINE_STAGE_EXPLAINER — зеркало FSM', () => {
  it('покрывает все стадии схемы без лишних', () => {
    expect(Object.keys(PIPELINE_STAGE_EXPLAINER).sort()).toEqual([...STAGES].sort());
  });

  it('у каждой стадии заполнены все три поля человеческим текстом', () => {
    for (const stage of STAGES) {
      const e = PIPELINE_STAGE_EXPLAINER[stage as PipelineStageInput];
      expect(e.what.length, `what у ${stage}`).toBeGreaterThan(10);
      expect(e.inputExample.length, `inputExample у ${stage}`).toBeGreaterThan(5);
      expect(e.outputExample.length, `outputExample у ${stage}`).toBeGreaterThan(5);
    }
  });

  it('порядок ключей соответствует жизненному циклу конвейера', () => {
    expect(Object.keys(PIPELINE_STAGE_EXPLAINER)).toEqual([...STAGES]);
  });
});

describe('PIPELINE_INTRO', () => {
  it('заголовок непустой', () => {
    expect(PIPELINE_INTRO.headline.length).toBeGreaterThan(3);
  });
});
