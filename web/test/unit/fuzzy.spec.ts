// Fuzzy-ранжировщик командной палитры: подпоследовательности, бонусы за
// префикс/границу слова, стабильность сортировки.
import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankByQuery } from '../../lib/shared/fuzzy';

describe('fuzzyScore', () => {
  it('точный префикс сильнее совпадения внутри слова', () => {
    const prefix = fuzzyScore('баз', 'база знаний');
    const infix = fuzzyScore('баз', 'супербаза');
    expect(prefix).not.toBeNull();
    expect(infix).not.toBeNull();
    expect(prefix!).toBeGreaterThan(infix!);
  });

  it('регистр не важен — и латиница, и кириллица', () => {
    expect(fuzzyScore('БАЗА', 'база знаний')).not.toBeNull();
    expect(fuzzyScore('база', 'БАЗА знаний')).not.toBeNull();
    expect(fuzzyScore('RAG', 'rag-демо')).not.toBeNull();
    expect(fuzzyScore('ДЕМО', 'RAG-Демо')).not.toBeNull();
  });

  it('подпоследовательность находится даже с разрывами', () => {
    expect(fuzzyScore('бзн', 'база знаний')).not.toBeNull();
    expect(fuzzyScore('сзн', 'спросить базу знаний')).not.toBeNull();
  });

  it('нет совпадения → null', () => {
    expect(fuzzyScore('xyz', 'база знаний')).toBeNull();
    expect(fuzzyScore('база квант', 'база знаний')).toBeNull(); // второй токен не найден
  });

  it('мульти-токен: все токены обязаны найтись', () => {
    expect(fuzzyScore('база знаний', 'база знаний')).not.toBeNull();
    expect(fuzzyScore('знаний база', 'база знаний')).not.toBeNull(); // порядок токенов свободный
  });

  it('пустой запрос — null (обрабатывается до скоринга)', () => {
    expect(fuzzyScore('', 'что угодно')).toBeNull();
    expect(fuzzyScore('   ', 'что угодно')).toBeNull();
  });
});

describe('rankByQuery', () => {
  const items = [
    { label: 'Главная', hint: 'core' },
    { label: 'база знаний', hint: 'rag' },
    { label: 'чат', hint: 'chat' },
    { label: 'дайджест', hint: 'blog' },
  ];

  it('пустой запрос возвращает все элементы без пересортировки', () => {
    expect(rankByQuery('', items, (i) => i.label)).toEqual(items);
    expect(rankByQuery('  ', items, (i) => i.label)).toEqual(items);
  });

  it('отсеивает несовпавшие и сортирует по счёту', () => {
    const out = rankByQuery('баз', items, (i) => `${i.label} ${i.hint}`);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('база знаний');
  });

  it('совпадение по подзаголовку тоже работает', () => {
    const out = rankByQuery('rag', items, (i) => `${i.label} ${i.hint}`);
    expect(out[0].label).toBe('база знаний');
  });

  it('сортировка стабильна при равном счёте (исходный порядок)', () => {
    const peers = [
      { label: '-alpha' },
      { label: '+alpha' },
      { label: ' alpha' },
    ];
    const out = rankByQuery('alpha', peers, (i) => i.label);
    expect(out.map((i) => i.label)).toEqual(['-alpha', '+alpha', ' alpha']);
  });

  it('не мутирует входной массив', () => {
    const snapshot = [...items];
    rankByQuery('чат', items, (i) => i.label);
    expect(items).toEqual(snapshot);
  });
});
