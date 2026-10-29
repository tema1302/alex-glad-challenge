// Данные командной палитры: гость видит только публичные маршруты,
// админ — весь каталог navGroups + публичные дополнения без дублей.
import { describe, expect, it } from 'vitest';
import { buildPaletteItems } from '../../app/components/palette/palette-items';
import { navGroups } from '../../data/nav';
import { channel } from '../../data/landing';

// Публичные страницы — зеркало PUBLIC_PATHS из middleware.ts (только страницы,
// без /api). Гостевая палитра не должна содержать ничего вне этого множества.
const PUBLIC_PAGES = new Set(['/', '/login', '/harness', '/jira', '/demo', '/blog/pipeline']);

describe('buildPaletteItems — гость', () => {
  const guest = buildPaletteItems(false);

  it('содержит все публичные поверхности', () => {
    const hrefs = guest.map((i) => i.href);
    for (const href of ['/', '/demo', '/harness', '/jira', '/blog/pipeline', '/login']) {
      expect(hrefs).toContain(href);
    }
  });

  it('ничего не знает о защищённых маршрутах', () => {
    for (const item of guest) {
      if (item.external) continue;
      expect(PUBLIC_PAGES.has(item.href), `внезапно защищённый: ${item.href}`).toBe(true);
    }
  });

  it('ведёт в канал внешней ссылкой', () => {
    const ch = guest.find((i) => i.id === 'channel');
    expect(ch).toBeDefined();
    expect(ch!.external).toBe(true);
    expect(ch!.href).toBe(channel.url);
  });

  it('у каждого пункта непустой label и корректный href', () => {
    for (const item of guest) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.href.startsWith('/') || item.href.startsWith('https://')).toBe(true);
    }
  });
});

describe('buildPaletteItems — админ', () => {
  const admin = buildPaletteItems(true);

  it('покрывает весь каталог navGroups с группой в подзаголовке', () => {
    for (const g of navGroups) {
      for (const it of g.items) {
        const found = admin.find((i) => i.href === it.href);
        expect(found, `нет пункта для ${it.href}`).toBeDefined();
        expect(found!.hint).toBe(g.tag);
      }
    }
  });

  it('дубли по href исключены, публичные дополнения добавлены', () => {
    const hrefs = admin.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of ['/demo', '/harness', '/jira']) {
      expect(hrefs.filter((h) => h === href)).toHaveLength(1);
    }
  });

  it('гостевой набор — подмножество админского по href', () => {
    const adminHrefs = new Set(admin.map((i) => i.href));
    for (const item of buildPaletteItems(false)) {
      expect(adminHrefs.has(item.href)).toBe(true);
    }
  });

  it('id уникальны (ключи React в списке)', () => {
    const ids = admin.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
