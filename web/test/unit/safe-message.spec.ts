// Unit: safeMessage — redact секретов (Bearer, URL, Windows-пути) из текстов ошибок.
import { describe, expect, it } from 'vitest';
import { safeMessage } from '../../lib/server/safe-message';

describe('safeMessage', () => {
  it('маскирует Bearer-токены', () => {
    expect(safeMessage('auth failed: Bearer sk-abc123')).toBe('auth failed: Bearer ***');
    // Регистр совпадения глушится (gi), но замена — литеральная строка 'Bearer ***'
    expect(safeMessage('bearer lowercase-token')).toBe('Bearer ***');
  });

  it('маскирует http(s) URL (там живёт TG_BOT_TOKEN в пути)', () => {
    expect(safeMessage('POST https://api.telegram.org/bot123:secret/sendMessage failed')).toBe(
      'POST <url> failed',
    );
    expect(safeMessage('connect https://x.ru?a=1 boom')).toBe('connect <url> boom');
  });

  it('маскирует Windows-пути', () => {
    expect(safeMessage('cannot read E:\\IT\\secret\\key.pem')).toBe('cannot read <path>');
  });

  it('чистый текст не трогает', () => {
    expect(safeMessage('Токен бота недействителен. Проверьте TG_BOT_TOKEN')).toBe(
      'Токен бота недействителен. Проверьте TG_BOT_TOKEN',
    );
  });
});
