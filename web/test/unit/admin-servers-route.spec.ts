// Unit: GET /api/admin/servers — статусы «ЧЕЛСИ черновик» и бота «Медиум»
// проходят из env-моста наружу только флагами/маской, без токенов и chat_id.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getKeysStatus: vi.fn(),
  getMcpServerUrl: vi.fn(),
  isMcpAuthConfigured: vi.fn(),
}));

vi.mock('../../lib/server/env', () => ({
  getKeysStatus: mocks.getKeysStatus,
  getMcpServerUrl: mocks.getMcpServerUrl,
  isMcpAuthConfigured: mocks.isMcpAuthConfigured,
}));

let GET: () => Promise<Response>;

beforeAll(async () => {
  ({ GET } = await import('../../app/api/admin/servers/route'));
});

beforeEach(() => {
  mocks.getKeysStatus.mockReset().mockReturnValue({
    cloud: { configured: false },
    local: { configured: false },
    embed: { configured: false },
    mtproto: { configured: false },
    botApi: { configured: true, channelLabel: '-100…1111' },
    apkChat: { configured: true, channelLabel: '-100…0345' },
    mediumBot: { configured: true, allowChats: 2, ownerConfigured: true },
    activeModel: null,
    activeProvider: null,
  });
  mocks.getMcpServerUrl.mockReset().mockReturnValue({ configured: false, url: null });
  mocks.isMcpAuthConfigured.mockReset().mockReturnValue(false);
});

describe('GET /api/admin/servers', () => {
  it('отдаёт apkChat/mediumBot без секретов', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.apkChat).toEqual({ configured: true, channelLabel: '-100…0345' });
    expect(body.mediumBot).toEqual({ configured: true, allowChats: 2, ownerConfigured: true });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('1736860345');
  });
});
