// Парсер инвокаций бота «Фактчемпик» (M1): /команда[@BotName], reply на сообщение
// бота с командой, @упоминание бота в тексте («@bot на это сказал севенс парковка»).
// Чистый модуль — покрыт юнит-тестами.

export const BOT_COMMANDS = [
  'цитата',
  'сказал',
  'игра',
  'изобрази',
  'reindex',
  'алиас',
  'off',
  'on',
  'стат',
] as const;

export type BotCommandName = (typeof BOT_COMMANDS)[number];

export interface ParsedCommand {
  name: string;
  args: string;
}

/** '/цитата севенс' | '/сказал@BotName тема' → {name, args}; не команда → null. */
export function parseCommand(
  text: string | null | undefined,
  botUsername?: string,
): ParsedCommand | null {
  if (!text) return null;
  const m = /^\s*\/([^\s@]+)(?:@(\S+))?(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  if (botUsername && m[2] && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const name = m[1].toLowerCase().replace(/ё/g, 'е');
  // «стат»/«stat»-варианты не расширяем — фиксированный набор M1.
  if (!(BOT_COMMANDS as readonly string[]).includes(name)) return null;
  return { name, args: (m[3] ?? '').trim() };
}

/**
 * Инвокация из произвольного текста: слэш-команда; либо @упоминание бота →
 * остаток как команда, «(на это) сказал …» → сказал, «как бы …» → какбы (M3).
 * Не инвокация → null.
 */
export function extractInvocation(
  text: string | null | undefined,
  botUsername?: string,
): ParsedCommand | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) return parseCommand(trimmed, botUsername);
  if (!botUsername) return null;
  const at = `@${botUsername.toLowerCase()}`;
  if (!trimmed.toLowerCase().includes(at)) return null;
  const rest = trimmed.replaceAll(new RegExp(escapeRe(at), 'gi'), ' ').trim();
  if (!rest) return null;
  if (rest.startsWith('/')) return parseCommand(rest, botUsername);
  const said = /(?:на\s+это\s+)?сказал\s+(.+)/is.exec(rest);
  if (said) return { name: 'сказал', args: said[1].trim() };
  if (/как\s+бы/is.test(rest)) return { name: 'какбы', args: '' };
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
