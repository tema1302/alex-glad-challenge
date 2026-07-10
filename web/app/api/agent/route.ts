// /api/agent — single-shot ответ LLM через core/Agent (день 28, web P5).
// POST {prompt, llm?} → new Agent(pickLlmClient(llm), SYSTEM).say(prompt). Stateless:
// каждый запрос — свежий Agent (без истории; для диалога есть /chat, P2). LLM-вызов server-side.
// server-only: core/ (Agent) + pickLlmClient через chokepoint. error → safeMessage.
import 'server-only';
import { NextRequest } from 'next/server';

import { agentSchema } from '../../../lib/shared/forms';
import { Agent } from '../../../lib/server/challenge';
import { pickLlmClient } from '../../../lib/server/llm';
import { safeMessage } from '../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = 'Ты — ассистент. Отвечай кратко и по делу.';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = agentSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { prompt, llm = 'cloud' } = parsed.data;

  try {
    const agent = new Agent(pickLlmClient(llm), SYSTEM_PROMPT);
    const answer = await agent.say(prompt);
    return Response.json({ ok: true, answer });
  } catch (e) {
    return Response.json(
      { ok: false, error: safeMessage(e instanceof Error ? e.message : 'agent failed') },
      { status: 502 },
    );
  }
}
