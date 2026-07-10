// /api/settings — display серверной конфигурации + preference (день 28, web P5).
// GET → {model, provider, mcpUrl:{configured,host?}, localLlm:{configured,model?}, modelPref}.
//   БЕЗ значений ключей: только имена провайдера/модели + configured-флаги + host MCP.
//   MCP_URL — read-only (§8 SSRF): host scheme://host, без path/query; смене через UI не подлежит.
// POST {modelPref?: 'local'|'cloud'} → persist в cookie model_pref (1 год). Тема — next-themes
//   на клиенте (client-local, НЕ серверный секрет). MCP_URL НЕ принимается (read-only).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { settingsSchema } from '../../../lib/shared/forms';
import { getKeysStatus, getMcpServerUrl } from '../../../lib/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL_PREF_COOKIE = 'model_pref';
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function GET(req: NextRequest): Promise<Response> {
  const keys = getKeysStatus();
  const mcp = getMcpServerUrl();

  let mcpHost: string | null = null;
  if (mcp.url) {
    try {
      const u = new URL(mcp.url);
      mcpHost = `${u.protocol}//${u.host}`;
    } catch {
      mcpHost = null;
    }
  }

  const modelPref = req.cookies.get(MODEL_PREF_COOKIE)?.value === 'local' ? 'local'
    : req.cookies.get(MODEL_PREF_COOKIE)?.value === 'cloud' ? 'cloud'
    : null;

  return Response.json({
    model: keys.activeModel,
    provider: keys.activeProvider,
    mcpUrl: { configured: mcp.configured, host: mcpHost },
    cloud: keys.cloud,
    localLlm: { configured: keys.local.configured, model: keys.local.model },
    modelPref,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = settingsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { modelPref } = parsed.data;

  const res = NextResponse.json({ ok: true, modelPref: modelPref ?? null });
  if (modelPref) {
    res.cookies.set(MODEL_PREF_COOKIE, modelPref, {
      maxAge: ONE_YEAR,
      sameSite: 'lax',
      httpOnly: true,
      path: '/',
    });
  }
  return res;
}
