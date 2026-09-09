// Unit: safeMessage — redact секретов (Bearer, sk-ключи, Authorization, URL,
// Windows-пути) из текстов ошибок.
import { describe, expect, it } from 'vitest';
import { safeMessage } from '../../lib/server/safe-message';

describe('safeMessage', () => {
  it('маскирует Bearer-токены', () => {
    expect(safeMessage('auth failed: Bearer sk-abc123')).toBe('auth failed: Bearer ***');
    // Регистр совпадения глушится (gi), но замена — литеральная строка 'Bearer ***'
    expect(safeMessage('bearer lowercase-token')).toBe('Bearer ***');
  });

  it('маскирует «голый» sk-ключ без Bearer (тела ошибок провайдера эхоят ключ)', () => {
    expect(safeMessage('invalid api key: sk-abcdef1234567890')).toBe('invalid api key: sk-***');
    // Короткое 'sk-1' и слово с -sk внутри ('task-12345') — не ключи, не трогаем.
    expect(safeMessage('task-12345 и sk-1 не ключи')).toBe('task-12345 и sk-1 не ключи');
  });

  it('маскирует Authorization-заголовок с любой схемой', () => {
    expect(safeMessage('POST failed: Authorization: Basic dXNlcjpwYXNz')).toBe(
      'POST failed: Authorization: ***',
    );
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
