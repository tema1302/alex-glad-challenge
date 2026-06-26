/**
 * mcpServer.ts — Minimal spec-compliant MCP server over stdio (JSON-RPC 2.0).
 *
 * Implements the MCP 2025-06-18 lifecycle:
 *   1. Client sends `initialize`; server replies with protocolVersion,
 *      serverInfo and capabilities.tools.
 *   2. Client sends `notifications/initialized` notification (no reply).
 *   3. Normal operation: `tools/list` and `tools/call`.
 *
 * Transport is line-delimited JSON-RPC over stdio: exactly one JSON object per
 * line. Only JSON-RPC responses are ever written to stdout; diagnostics go to
 * stderr, keeping the stdout channel clean for the protocol.
 */
import * as readline from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type McpServerTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
};

export type McpServerConfig = {
  name: string;
  version: string;
  tools: McpServerTool[];
};

/** JSON-RPC error carrying a standard numeric error code. */
class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

type RawMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type RequestId = number | string;

export class McpStdioServer {
  private readonly tools = new Map<string, McpServerTool>();

  constructor(private readonly config: McpServerConfig) {
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** Read stdin line-by-line and dispatch each JSON-RPC message. */
  async start(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });
    return new Promise<void>((resolve) => {
      rl.on('line', (line) => {
        // handleLine async, but we don't await here — events fire in order.
        void this.handleLine(line);
      });
      rl.on('close', () => resolve());
    });
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let raw: RawMessage;
    try {
      raw = JSON.parse(trimmed) as RawMessage;
    } catch {
      // Malformed JSON line: ignore silently (possible client noise).
      return;
    }

    const method = raw.method;
    if (raw.jsonrpc !== '2.0' || typeof method !== 'string') {
      return;
    }

    const id = raw.id;
    const isNotification = typeof id !== 'number' && typeof id !== 'string';
    const params = this.coerceParams(raw.params);

    try {
      const result = await this.dispatch(method, params);
      if (!isNotification) {
        this.sendResult(id as RequestId, result);
      }
    } catch (err) {
      if (!isNotification) {
        this.sendError(id as RequestId, err);
      }
    }
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: this.config.name, version: this.config.version },
        };

      case 'notifications/initialized':
        return {};

      case 'tools/list':
        return {
          tools: this.config.tools.map((tool) => ({
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
          // Tool execution failure: report as a tool result, not a transport error.
          const text = err instanceof Error ? err.message : String(err);
          this.log(`tool '${name}' threw: ${text}`);
          return {
            content: [{ type: 'text' as const, text }],
            isError: true,
          };
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

  private sendResult(id: RequestId, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  private sendError(id: RequestId, err: unknown): void {
    let code = -32603;
    let message = 'Internal error';
    let data: unknown;
    if (err instanceof JsonRpcError) {
      code = err.code;
      message = err.message;
      data = err.data;
    } else if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === 'string') {
      message = err;
    }
    this.send({ jsonrpc: '2.0', id, error: { code, message, data } });
  }

  private send(message: object): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  private log(message: string): void {
    process.stderr.write(`[${this.config.name}] ${message}\n`);
  }
}
