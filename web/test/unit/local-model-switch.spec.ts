// Unit: runtime-переключатель локальной LLM (day-10 s3).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'qwen2.5-coder:1.5b-base';
const TUNED = 'qwen2.5-coder-1.5b-distilled';

function load() {
  return import('../../lib/server/local-model-switch');
}

describe('local-model-switch', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.LOCAL_LLM_MODEL = BASE;
    process.env.LOCAL_LLM_TUNED_MODEL = TUNED;
  });

  it('дефолт = base, переключатель доступен', async () => {
    const m = await load();
    const s = m.getLocalModelState();
    expect(s).toEqual({ base: BASE, tuned: TUNED, active: BASE, switchable: true });
  });

  it('переключение на tuned и обратно на "base"', async () => {
    const m = await load();
    expect(m.setLocalModelOverride(TUNED).active).toBe(TUNED);
    expect(m.getLocalModelState().active).toBe(TUNED);
    expect(m.setLocalModelOverride('base').active).toBe(BASE);
  });

  it('чужое имя модели — RangeError', async () => {
    const m = await load();
    expect(() => m.setLocalModelOverride('evil/model')).toThrow(RangeError);
  });

  it('tuned совпадает с base → переключатель недоступен', async () => {
    process.env.LOCAL_LLM_TUNED_MODEL = BASE;
    const m = await load();
    const s = m.getLocalModelState();
    expect(s.switchable).toBe(false);
    expect(s.active).toBe(BASE);
    expect(() => m.setLocalModelOverride(TUNED)).toThrow(RangeError);
  });

  it('tuned не задана → переключатель недоступен, override игнорируется', async () => {
    delete process.env.LOCAL_LLM_TUNED_MODEL;
    const m = await load();
    expect(m.getLocalModelState().switchable).toBe(false);
    expect(() => m.setLocalModelOverride('x')).toThrow(/не задана/);
  });
});
