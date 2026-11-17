// Unit: web env-мост — статусы чата «ЧЕЛСИ черновик» (TG_APK_CHAT_ID,
// fallback TG_CHAT_ID) и бота «Медиум» (TG_BOT_*, fail-closed без allow-list).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  getTgApkDeliveryConfig: vi.fn(),
  getTgBotRuntimeConfig: vi.fn(),
}));

vi.mock('@challenge/core/env', () => ({
  loadEnvUpward: () => undefined,
  getLlmProviderConfig: () => {
    throw new Error('not configured');
  },
  getLocalLlmConfig: () => {
    throw new Error('not configured');
  },
  getEmbedConfig: () => {
    throw new Error('not configured');
  },
  getTgScanConfig: () => null,
  getTgBotConfig: () => null,
  getTgApkDeliveryConfig: core.getTgApkDeliveryConfig,
  getTgBotRuntimeConfig: core.getTgBotRuntimeConfig,
  getGoogleCalendarConfig: () => null,
}));

let getKeysStatus: typeof import('../../lib/server/env').getKeysStatus;

beforeEach(async () => {
  core.getTgApkDeliveryConfig.mockReset().mockReturnValue(null);
  core.getTgBotRuntimeConfig.mockReset().mockReturnValue(null);
  ({ getKeysStatus } = await import('../../lib/server/env'));
});

describe('web env: apkChat / mediumBot', () => {
  it('не настроены → configured:false, наружу только нули/null', () => {
    const status = getKeysStatus();
    expect(status.apkChat).toEqual({ configured: false, channelLabel: null });
    expect(status.mediumBot).toEqual({
      configured: false,
      allowChats: 0,
      ownerConfigured: false,
    });
  });

  it('APK-чат: маскирует chat_id, не отдаёт полное значение', () => {
    core.getTgApkDeliveryConfig.mockReturnValue({
      botToken: 'secret-token',
      chatId: '-1001736860345',
    });
    const status = getKeysStatus();
    expect(status.apkChat).toEqual({ configured: true, channelLabel: '-100…0345' });
    expect(JSON.stringify(status)).not.toContain('1736860345');
  });

  it('«Медиум»: fail-closed без allow-list, owner только флагом', () => {
    core.getTgBotRuntimeConfig.mockReturnValue({
      botToken: 'secret-token',
      allowChats: new Set<string>(),
      ownerChatId: '514816799',
      pollTimeoutSec: 25,
    });
    expect(getKeysStatus().mediumBot).toEqual({
      configured: false,
      allowChats: 0,
      ownerConfigured: true,
    });

    core.getTgBotRuntimeConfig.mockReturnValue({
      botToken: 'secret-token',
      allowChats: new Set(['-1001736860345']),
      ownerChatId: null,
      pollTimeoutSec: 25,
    });
    expect(getKeysStatus().mediumBot).toEqual({
      configured: true,
      allowChats: 1,
      ownerConfigured: false,
    });
  });
});
