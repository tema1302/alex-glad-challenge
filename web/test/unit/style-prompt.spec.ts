// Unit: style-prompt — контракты промпта «Антоновайзера» (общий модуль для
// публичного /style и студии /antonov). Регрессия на «коверканье смысла»
// (фактологические тексты — футбольные отчёты, аналитика): смысловые инварианты
// обязаны жить в system-промпте. При рефакторинге промпта тест падает и
// заставляет ПЕРЕНЕСТИ инвариант, а не потерять. server-only застаблен
// в vitest-конфиге (общий стаб с route-тестами).
import { describe, expect, it } from 'vitest';

import { STYLE_SYSTEM_PROMPT, buildStyleUserPrompt } from '../../lib/server/style-prompt';

describe('STYLE_SYSTEM_PROMPT — инварианты смысла', () => {
  it('объявляет смысл неприкосновенным и важнее стиля', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(/СМЫСЛ НЕПРИКОСНОВЕНЕН/);
    expect(STYLE_SYSTEM_PROMPT).toMatch(/важнее стиля/);
  });

  it('запрещает переставлять, кто кому что сделал (победа не мигрирует между командами)', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(/Не переставляй, кто кому что сделал/);
  });

  it('направляет иронию и панч только в мишени критики автора', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(/Ирония и панч бьют ТОЛЬКО туда, куда бьёт автор/);
    expect(STYLE_SYSTEM_PROMPT).toMatch(/Позиция автора по каждому объекту — твоя позиция/);
  });

  it('запрещает клички и иронические титулы для реальных людей и команд', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(
      /а не для реальных людей, команд и компаний из исходника/,
    );
  });

  it('не даёт натягивать «кому выгодно» на темы без выгоды', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(/а не догма/);
  });

  it('при конфликте стиля и точности выбирает точность', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(/в пользу точности/);
  });

  it('самопроверка требует сверять факты и мишень иронии с исходником', () => {
    expect(STYLE_SYSTEM_PROMPT).toMatch(/Сверь с исходником по фактам/);
    expect(STYLE_SYSTEM_PROMPT).toMatch(/Мишень иронии совпадает с мишенью критики автора/);
  });
});

describe('buildStyleUserPrompt', () => {
  it('передаёт режим, формат, подпись и исходный текст', () => {
    const p = buildStyleUserPrompt({
      text: 'Исходный текст статьи',
      mode: 'hard',
      format: 'post',
      signature: true,
      llm: 'cloud',
    });
    expect(p).toContain('ЖЁСТКО');
    expect(p).toContain('ПОСТ-РАЗБОР');
    expect(p).toContain('быть добру');
    expect(p).toContain('ТЕКСТ:\nИсходный текст статьи');
  });

  it('без подписи — ритуала в конце нет', () => {
    const p = buildStyleUserPrompt({
      text: 'х',
      mode: 'soft',
      format: 'auto',
      signature: false,
      llm: 'local',
    });
    expect(p).toContain('без ритуальной подписи');
  });

  it('digest: включает дайджест-инструкцию и отменяет «±30% от исходника»', () => {
    const p = buildStyleUserPrompt(
      { text: 'длинная статья', mode: 'normal', format: 'auto', signature: false, llm: 'cloud' },
      { digest: true },
    );
    expect(p).toContain('РЕЖИМ ДАЙДЖЕСТА');
    expect(p).toMatch(/НЕ действует/); // отмена правила «длина сопоставима с исходником»
    expect(p).toContain('~4000 знаков');
    // сжатие разрешено только выбрасыванием второстепенного, оставленное — 1:1
    expect(p).toMatch(/фактическим 1:1/);
  });

  it('без digest: дайджест-инструкции нет (публичный /style не меняется)', () => {
    const p = buildStyleUserPrompt({
      text: 'короткий пост',
      mode: 'normal',
      format: 'auto',
      signature: false,
      llm: 'cloud',
    });
    expect(p).not.toContain('РЕЖИМ ДАЙДЖЕСТА');
  });
});
