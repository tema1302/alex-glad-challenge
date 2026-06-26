/**
 * mcpHttpServer.ts — MCP server over HTTP (Streamable HTTP transport).
 *
 * Uses ONLY node:http — no external dependencies. Implements the MCP
 * 2025-06-18 lifecycle over JSON-RPC 2.0 request/response bodies on a single
 * POST endpoint:
 *   initialize, notifications/initialized, tools/list, tools/call.
 * GET yields a small HTML status page; OPTIONS enables CORS for browsers.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { McpToolResult, McpServerTool } from './mcpServer.js';

export type { McpToolResult, McpServerTool };

const PROTOCOL_VERSION = '2025-06-18';

type McpHttpConfig = {
  name: string;
  version: string;
  tools: McpServerTool[];
  port?: number;
};

type RawMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type RequestId = number | string;

/** JSON-RPC error carrying a standard numeric error code. */
class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
  }
}

/** Collect the full request body into a single Buffer (stream data collection). */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export class McpHttpServer {
  private readonly tools = new Map<string, McpServerTool>();
  private readonly port: number;
  private readonly name: string;
  private readonly version: string;
  private server: Server | null = null;

  constructor(config: McpHttpConfig) {
    this.name = config.name;
    this.version = config.version;
    this.port = config.port ?? 3001;
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** Starts the HTTP server on the configured port (default 3001). */
  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, () => resolve());
    });
    console.error(
      `MCP server '${this.name}' listening on http://localhost:${this.port}/mcp`,
    );
  }

  /** Closes the HTTP server. */
  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // CORS preflight for browser testing.
    if (req.method === 'OPTIONS') {
      this.setCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    // GET: status page.
    if (req.method === 'GET') {
      this.setCors(res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(this.statusPage());
      return;
    }

    // Only POST carries JSON-RPC.
    if (req.method !== 'POST') {
      this.setCors(res);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const body = await readBody(req);
    let raw: RawMessage;
    try {
      raw = JSON.parse(body.toString('utf-8')) as RawMessage;
    } catch {
      this.setCors(res);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const id = raw.id;
    const isNotification =
      typeof id !== 'number' && typeof id !== 'string';

    // Notifications (no id): acknowledge with 202, empty body.
    if (isNotification) {
      this.setCors(res);
      res.statusCode = 202;
      res.end();
      return;
    }

    // Request (has id): build a JSON-RPC response.
    try {
      const result = await this.dispatch(raw.method, raw.params);
      this.setCors(res);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: id as RequestId, result }),
      );
    } catch (err) {
      this.setCors(res);
      res.setHeader('Content-Type', 'application/json');
      let code = -32603;
      let message = 'Internal error';
      if (err instanceof JsonRpcError) {
        code = err.code;
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'string') {
        message = err;
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: id as RequestId,
          error: { code, message },
        }),
      );
    }
  }

  private async dispatch(
    method: unknown,
    paramsRaw: unknown,
  ): Promise<unknown> {
    if (typeof method !== 'string') {
      throw new JsonRpcError(-32601, 'Method not found');
    }
    const params = this.coerceParams(paramsRaw);

    switch (method) {
      case 'initialize':
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: this.name, version: this.version },
        };

      case 'tools/list':
        return {
          tools: [...this.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        };

      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string') {
          throw new JsonRpcError(-32602, "Invalid params: 'name' is required");
        }
        const tool = this.tools.get(name);
        if (!tool) {
          throw new JsonRpcError(-32601, `Unknown tool: ${name}`);
        }
        const args = this.coerceParams(params.arguments);
        try {
          return await tool.handler(args);
        } catch (err) {
          // Tool failure: report as a tool result, not a transport error.
          const text = err instanceof Error ? err.message : String(err);
          const failed: McpToolResult = {
            content: [{ type: 'text', text }],
            isError: true,
          };
          return failed;
        }
      }

      default:
        throw new JsonRpcError(-32601, `Method not found: ${method}`);
    }
  }

  private coerceParams(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private setCors(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private statusPage(): string {
    const toolNames = [...this.tools.values()]
      .map((t) => `<li>${t.name}</li>`)
      .join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${this.name} — MCP</title>
</head>
<body>
  <h1>${this.name}</h1>
  <p>Version: ${this.version}</p>
  <p>Tools: ${this.tools.size}</p>
  <ul>${toolNames}</ul>
  <p>This is an MCP server (protocol ${PROTOCOL_VERSION}).
     Send JSON-RPC 2.0 requests via HTTP POST.</p>
</body>
</html>`;
  }
}
