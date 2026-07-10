// /api/mcp/call — generic вызов инструмента MCP-сервера (день 28, web P5).
// POST {tool, args?} → McpHttpClient.callTool(tool, args). args = user-input JSON, идёт
// КАК ДАННЫЕ (JSON-RPC params), не исполняется как код. zod на границе (инвариант).
// server-only: core/ (McpHttpClient) через chokepoint. error → safeMessage (без URL/токена).
import 'server-only';
import { NextRequest } from 'next/server';

import { mcpCallSchema } from '../../../../lib/shared/forms';
import { McpHttpClient } from '../../../../lib/server/challenge';
import { getMcpServerUrl } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = mcpCallSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { tool, args } = parsed.data;

  const { configured, url } = getMcpServerUrl();
  if (!configured || !url) {
    return Response.json(
      { error: 'MCP-сервер не настроен (задайте MCP_SERVER_URL в .env)' },
      { status: 400 },
    );
  }

  const client = new McpHttpClient(url);
  try {
    await client.connect();
    const result = await client.callTool(tool, args);
    return Response.json({ ok: true, result });
  } catch (e) {
    return Response.json(
      { ok: false, error: safeMessage(e instanceof Error ? e.message : 'mcp call failed') },
      { status: 502 },
    );
  } finally {
    client.disconnect();
  }
}
