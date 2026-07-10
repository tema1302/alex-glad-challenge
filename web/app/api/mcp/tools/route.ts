// /api/mcp/tools — список инструментов настроенного MCP-сервера (день 28, web P5).
// GET → McpHttpClient.connect() + listTools(). URL из env (getMcpServerUrl); если
// MCP_SERVER_URL не задан — graceful «не настроен» (НЕ ходим на внешний дефолт, §8 SSRF).
// server-only: core/ (McpHttpClient) через chokepoint. error → safeMessage (без URL/токена).
import 'server-only';

import { McpHttpClient } from '../../../../lib/server/challenge';
import { getMcpServerUrl } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { configured, url } = getMcpServerUrl();
  if (!configured || !url) {
    return Response.json({
      configured: false,
      tools: [],
      error: 'MCP-сервер не настроен (задайте MCP_SERVER_URL в .env)',
    });
  }

  const client = new McpHttpClient(url);
  try {
    await client.connect();
    const tools = await client.listTools();
    return Response.json({ configured: true, tools });
  } catch (e) {
    return Response.json(
      { configured: true, tools: [], error: safeMessage(e instanceof Error ? e.message : 'mcp tools failed') },
      { status: 502 },
    );
  } finally {
    client.disconnect();
  }
}
