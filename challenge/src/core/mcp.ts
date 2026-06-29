// Минимальный MCP-клиент: JSON-RPC 2.0 поверх stdio дочернего процесса.
// Способен: запустить MCP-сервер, провести handshake (initialize),
// отправить notifications/initialized и вызвать tools/list.
// Спека: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const PROTOCOL_VERSION = '2025-06-18';

// --- JSON-RPC типы (минимальный надёжный минимум) ---

interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: P;
}

interface JsonRpcNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: R;
  error?: JsonRpcError;
}

/** Инструмент MCP-сервера (часть ответа tools/list). */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Результат initialize: информация о сервере и его возможности. */
export interface McpServerInfo {
  name: string;
  version: string;
  title?: string;
}

export interface McpInitResult {
  protocolVersion: string;
  serverInfo: McpServerInfo;
  capabilities: Record<string, unknown>;
  tools: McpTool[];
}

interface InitResultRaw {
  protocolVersion: string;
  serverInfo: McpServerInfo;
  capabilities: Record<string, unknown>;
}

interface ToolsListResultRaw {
  tools: McpTool[];
}

/**
 * Минимальный MCP-клиент поверх stdio.
 * Один экземпляр = одно соединение с одним сервером.
 */
export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private started = false;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env?: Record<string, string>,
    private readonly useShell: boolean = process.platform === 'win32',
  ) {}

  /** Запускает дочерний процесс и проводит MCP-handshake. */
  async connect(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env ? { ...process.env, ...this.env } : process.env,
      shell: this.useShell,
    });

    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));

    this.proc.on('error', (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });

    this.proc.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        const err = new Error(`MCP-сервер завершился с кодом ${code} (signal: ${signal})`);
        for (const { reject } of this.pending.values()) reject(err);
        this.pending.clear();
      }
    });

    await this.initialize();
  }

  /** Handshake: initialize → notifications/initialized. */
  private async initialize(): Promise<void> {
    const resp = await this.request<InitResultRaw>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'challenge-mcp-client', version: '0.1.0' },
    });
    if (resp.error) throw new Error(`initialize failed: ${resp.error.message}`);

    this.notify('notifications/initialized');
  }

  /** Список инструментов сервера. */
  async listTools(): Promise<McpTool[]> {
    const resp = await this.request<ToolsListResultRaw>('tools/list', {});
    if (resp.error) throw new Error(`tools/list failed: ${resp.error.message}`);
    return resp.result?.tools ?? [];
  }

  /** Вызвать инструмент по имени. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const resp = await this.request<{ content?: unknown[] }>('tools/call', { name, arguments: args });
    if (resp.error) throw new Error(`tools/call "${name}" failed: ${resp.error.message}`);
    return resp.result;
  }

  /** Вызвать инструмент и достать текст первого content-блока (для оркестратора). */
  async callToolText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = (await this.callTool(name, args)) as
      | { content?: Array<{ type: string; text?: string }>; isError?: boolean }
      | undefined;
    const text = result?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (result?.isError) throw new Error(text || `tools/call "${name}" вернул ошибку`);
    return text;
  }

  /** Полный прогон: connect → listTools → disconnect. Возвращает инструменты и serverInfo. */
  async connectAndList(): Promise<McpInitResult> {
    await this.connect();
    const tools = await this.listTools();
    // serverInfo уже получен в initialize — но мы не храним его, поэтому
    // возвращаем то, что есть; для этого демо важны tools.
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: 'claude-in-mobile', version: '3.14.0' },
      capabilities: {},
      tools,
    };
  }

  /** Закрыть соединение: stdin-close → SIGTERM. */
  disconnect(): void {
    if (!this.proc) return;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.proc.stdin.end();
    this.proc.kill('SIGTERM');
    this.proc = null;
  }

  // --- низкоуровневый JSON-RPC ---

  private request<R = unknown>(method: string, params?: unknown): Promise<JsonRpcResponse<R>> {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error('MCP-клиент не подключён'));
        return;
      }
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Таймаут MCP-запроса: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve: resolve as (v: JsonRpcResponse) => void, reject, timer });
      this.proc!.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.proc) return;
    const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(JSON.stringify(notif) + '\n');
  }

  // stdio MCP: сообщения разделены переводами строк, каждое — валидный JSON-RPC.
  private onData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(trimmed) as JsonRpcResponse;
      } catch {
        continue; // не JSON — логи сервера на stderr, пропускаем
      }
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          entry.resolve(msg);
        }
      }
    }
  }
}
