// MCP-клиент поверх Streamable HTTP-транспорта (JSON-RPC 2.0 через POST).
// Использует только встроенный fetch (Node.js 24+), без внешних зависимостей.
// Спека: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_NAME = 'challenge-http-client';
const CLIENT_VERSION = '1.0.0';
const TIMEOUT_MS = 30_000;

// --- JSON-RPC типы ---

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

interface JsonRpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id?: number;
  result?: R;
  error?: { code: number; message: string; data?: unknown };
}

interface InitResultRaw {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
}

interface ToolsListResultRaw {
  tools: McpHttpTool[];
}

interface ToolCallResultRaw {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

/** Инструмент MCP-сервера (часть ответа tools/list). */
export interface McpHttpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Информация о сервере после handshake. */
export interface McpHttpServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
}

/**
 * Минимальный MCP-клиент поверх HTTP (Streamable HTTP transport).
 * Один экземпляр = одно соединение с одним сервером по baseUrl.
 */
export class McpHttpClient {
  private nextId = 1;

  constructor(private readonly baseUrl: string) {}

  /** Полный handshake: initialize + notifications/initialized. */
  async connect(): Promise<McpHttpServerInfo> {
    const resp = await this.request<InitResultRaw>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    });
    if (resp.error) throw new Error(`initialize failed: ${resp.error.message}`);
    if (!resp.result) throw new Error('initialize failed: пустой result');

    this.notify('notifications/initialized');

    const { protocolVersion, serverInfo } = resp.result;
    return {
      name: serverInfo.name,
      version: serverInfo.version,
      protocolVersion,
    };
  }

  /** Список инструментов сервера. */
  async listTools(): Promise<McpHttpTool[]> {
    const resp = await this.request<ToolsListResultRaw>('tools/list', {});
    if (resp.error) throw new Error(`tools/list failed: ${resp.error.message}`);
    return resp.result?.tools ?? [];
  }

  /** Вызвать инструмент по имени. Возвращает текст первого content-блока. */
  async callTool(name: string, args?: Record<string, unknown>): Promise<string> {
    const resp = await this.request<ToolCallResultRaw>('tools/call', { name, arguments: args ?? {} });
    if (resp.error) throw new Error(`tools/call "${name}" failed: ${resp.error.message}`);
    if (!resp.result) throw new Error(`tools/call "${name}" failed: пустой result`);

    const textBlock = resp.result.content?.find((c) => c.type === 'text');
    const text = textBlock?.text ?? '';

    if (resp.result.isError) throw new Error(text || `tools/call "${name}" вернул ошибку`);

    return text;
  }

  /** Отключение (no-op для HTTP, для симметрии API со stdio-клиентом). */
  disconnect(): void {
    // HTTP без сохранения состояния — закрывать нечего.
  }

  // --- низкоуровневый JSON-RPC ---

  /** Запрос с id: POST к baseUrl, ожидает JSON-RPC ответ. */
  private async request<R = unknown>(method: string, params?: unknown): Promise<JsonRpcResponse<R>> {
    const id = this.nextId++;
    const body: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const json = await this.post(body);
    return json as JsonRpcResponse<R>;
  }

  /** Уведомление без id: POST к baseUrl, ответ не разбирается. */
  private notify(method: string, params?: unknown): void {
    const body: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    // fire-and-forget; сервер отвечает 202, тело не нужно.
    this.post(body).catch(() => {
      // уведомления нельзя отменить по таймауту — молча игнорируем
    });
  }

  /** POST JSON-тела к baseUrl с таймаутом 30с и стандартными MCP-заголовками. */
  private async post(body: JsonRpcRequest | JsonRpcNotification): Promise<unknown> {
    const doFetch = fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
      },
      body: JSON.stringify(body),
    });

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Таймаут HTTP-запроса: ${body.method}`)), TIMEOUT_MS);
    });

    let resp: Response;
    try {
      resp = await Promise.race([doFetch, timeout]);
    } catch (err) {
      throw new Error(`HTTP fetch не удался: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText} для метода ${body.method}`);
    }

    return resp.json();
  }
}
