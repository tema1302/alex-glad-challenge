// FSM pipeline-state блог-агентов (день 28, web P4b).
// GET  → тек. состояние + метаданные стадии (label/expectedAction/allowed transitions).
// POST → {action:'transition', to, detail?} | {action:'reset'}.
//   transition: loadState ?? createInitialState → transition(state,to,detail) (бросает
//     TransitionError при недопустимом переходе → 400) → saveState → вернуть обновлённое.
//   reset: clearState (перезаписывает initial) → вернуть initial.
// runtime=nodejs, force-dynamic, server-only. Состояние в challenge/.data/pipeline-state.json.
//
// Контракт ответа (GET и POST-ok):
//   { stage, step, expectedAction, allowed: PipelineStage[], revisionCount, history, labels }
// `labels` — статический мапа 6 стадий → русский label (для кнопок клиента, без core/).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { pipelineActionSchema } from '../../../../lib/shared/forms';
import type { PipelineStage } from '../../../../lib/server/challenge';
import {
  STAGE_INFO,
  createInitialState,
  transition,
  saveState,
  loadState,
  clearState,
  allowedTransitions,
  expectedActionFor,
  TransitionError,
  dataPath,
} from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_FILE = dataPath('pipeline-state.json');

function project(state: ReturnType<typeof createInitialState>) {
  return {
    stage: state.stage,
    step: state.step,
    expectedAction: expectedActionFor(state.stage),
    allowed: allowedTransitions(state.stage),
    revisionCount: state.revisionCount,
    history: state.history,
    labels: Object.fromEntries(
      (Object.keys(STAGE_INFO) as PipelineStage[]).map((s) => [s, STAGE_INFO[s].label]),
    ) as Record<PipelineStage, string>,
  };
}

export function GET(): NextResponse {
  const state = loadState(STATE_FILE) ?? createInitialState();
  return NextResponse.json(project(state));
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = pipelineActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }

  if (parsed.data.action === 'reset') {
    clearState(STATE_FILE);
    return NextResponse.json(project(createInitialState()));
  }

  // action === 'transition' (refine гарантирует presence of `to`).
  const to = parsed.data.to as PipelineStage;
  try {
    const state = loadState(STATE_FILE) ?? createInitialState();
    const next = transition(state, to, parsed.data.detail ?? '');
    saveState(next, STATE_FILE);
    return NextResponse.json(project(next));
  } catch (e) {
    if (e instanceof TransitionError) {
      return NextResponse.json({ error: safeMessage(e.message) }, { status: 400 });
    }
    return NextResponse.json(
      { error: safeMessage(e instanceof Error ? e.message : 'internal error') },
      { status: 500 },
    );
  }
}
