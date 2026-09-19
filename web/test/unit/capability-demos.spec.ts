// Сценарии мини-демо витрины: целостность структуры — иначе карточка отрисует
// пустой DemoPlayer. Плюс: каждый id capabilitySections имеет свой сценарий.
import { describe, expect, it } from 'vitest';
import { capabilityDemos } from '../../data/capability-demos';
import { capabilitySections } from '../../data/showcase';

describe('capabilityDemos', () => {
  it('у каждой секции витрины есть сценарий с интро и ≥2 битами', () => {
    for (const s of capabilitySections) {
      const demo = capabilityDemos[s.id];
      expect(demo, `нет сценария для ${s.id}`).toBeDefined();
      expect(demo!.intro.length).toBeGreaterThan(0);
      expect(demo!.beats.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('в каждом бите: ≥1 фраза-выбор и непустой ответ; фразы уникальны внутри бита', () => {
    for (const [id, demo] of Object.entries(capabilityDemos)) {
      for (const beat of demo.beats) {
        expect(beat.ask.length, `${id}: нет фраз`).toBeGreaterThan(0);
        expect(beat.reply.length, `${id}: пустой ответ`).toBeGreaterThan(0);
        expect(new Set(beat.ask).size).toBe(beat.ask.length);
      }
    }
  });

  it('чипы-доказательства есть хотя бы в одном бите каждого демо', () => {
    for (const [id, demo] of Object.entries(capabilityDemos)) {
      expect(demo.beats.some((b) => (b.chips?.length ?? 0) > 0), `${id}: нет чипов`).toBe(true);
    }
  });

  it('guard-демо RAG содержит честный отказ', () => {
    const rag = capabilityDemos.rag!;
    expect(rag.beats.some((b) => b.reply.startsWith('Не знаю'))).toBe(true);
  });
});
