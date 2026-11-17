// Unit-гвард депанкизации UI-текстов блога (S1): в web/app/blog/** не должно
// быть инженерных токенов, видимых владельцу (blog.sqlite, «PATCH /api»,
// имена env-переменных, «легаси»). Полные строки-комментарии (// /* и
// продолжения *) вырезаются до проверки — жаргон в комментариях для
// разработчиков допустим, гвард — про видимый UI. Провал печатает файл:токен.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKENS = ['blog.sqlite', 'PATCH /api', 'TG_CHAT_ID', 'TG_BOT_TOKEN', 'легаси'];

/** Рекурсивный список .ts/.tsx в каталоге (только файлы, без .next). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Строки-комментарии вырезаются: гвард проверяет только исполняемый UI-текст. */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

describe('депанкизация UI-текстов web/app/blog/**', () => {
  it('токены-жаргон не встречаются вне строк-комментариев', () => {
    const root = path.resolve(process.cwd(), 'app/blog');
    const files = collectTsFiles(root);
    // Каталог найден и непуст — иначе гвард молча проверял бы ничего.
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripCommentLines(readFileSync(file, 'utf8')).toLowerCase();
      for (const token of TOKENS) {
        if (code.includes(token.toLowerCase())) {
          offenders.push(`${path.relative(path.dirname(root), file)}: ${token}`);
        }
      }
    }
    expect(offenders, `жаргон в UI-тексте блога:\n${offenders.join('\n')}`).toEqual([]);
  });
});
