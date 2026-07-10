// /api/admin/servers — статусы серверов/сервисов (день 28, web P5).
// GET → только статичные индикаторы configured on/off из env accessors (БЕЗ spawn).
// Решение п.5 критика: spawn mcp-server/scheduler/day-20 из UI НЕ делается в P5 —
// только индикация наличия конфигурации. server-only: web/lib/server/env bridge (без значений).
import 'server-only';

import { getKeysStatus, getMcpServerUrl, isMcpAuthConfigured } from '../../../../lib/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const keys = getKeysStatus();
  const mcp = getMcpServerUrl();

  // host MCP-сервера — scheme://host (без path/query, секретов там нет, но консервативно).
  let mcpHost: string | null = null;
  if (mcp.url) {
    try {
      const u = new URL(mcp.url);
      mcpHost = `${u.protocol}//${u.host}`;
    } catch {
      mcpHost = null;
    }
  }

  return Response.json({
    mcp: { configured: mcp.configured, host: mcpHost, authConfigured: isMcpAuthConfigured() },
    cloud: keys.cloud,
    local: keys.local,
    embed: keys.embed,
    mtproto: keys.mtproto,
    botApi: keys.botApi,
    activeModel: keys.activeModel,
    activeProvider: keys.activeProvider,
  });
}
