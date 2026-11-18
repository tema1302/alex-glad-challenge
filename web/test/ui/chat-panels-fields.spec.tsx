// @vitest-environment jsdom
// UI-сценарий (S4 «Инпуты»): чат-панели получают доступные имена контролов —
// inline-ряды через aria-label, вертикальные формы через Field (label↔контрол).
// Контракт: каждый из 13 контролов находится getByLabelText — бросок на
// «несколько» заодно доказывает уникальность имён в пределах панели.
// GET-вью застаблены по URL (канон usePanelView: mount → GET → setView).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MemoryPanel } from '../../app/chat/[sessionId]/panels/MemoryPanel';
import { ConstraintsPanel } from '../../app/chat/[sessionId]/panels/ConstraintsPanel';
import { ProfilePanel } from '../../app/chat/[sessionId]/panels/ProfilePanel';
import { BranchesPanel } from '../../app/chat/[sessionId]/panels/BranchesPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const MEMORY_VIEW = {
  memoryEnabled: true,
  task: 'выбрать режим прогрева',
  working: { city: 'Лондон' },
  longTerm: [{ key: 'club', value: 'Chelsea', updatedAt: '2026-01-01T00:00:00Z' }],
};

const CONSTRAINTS_VIEW = { items: [] };

const PROFILE_VIEW = {
  profiles: ['default', 'expert'],
  active: 'default',
  snapshot: { любимый_клуб: 'Chelsea', стиль: 'короткие посты', notes: ['заметка'] },
};

const BRANCH_VIEW = {
  branches: [
    { id: 1, label: 'корень', parentId: null, active: true, messageCount: 4 },
    { id: 2, label: 'ветка про трансферы', parentId: 1, active: false, messageCount: 1 },
  ],
  activeId: 1,
};

/** Стаб GET-вью всех четырёх панелей одной сессии; POST не нужен. */
function stubPanelViews(sessionId: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/chat/${sessionId}/memory`) return json(MEMORY_VIEW);
      if (url === `/api/chat/${sessionId}/constraints`) return json(CONSTRAINTS_VIEW);
      if (url === `/api/chat/${sessionId}/profile`) return json(PROFILE_VIEW);
      if (url === `/api/chat/${sessionId}/branch`) return json(BRANCH_VIEW);
      return json({});
    }),
  );
}

describe('MemoryPanel: доступные имена инпутов (S4)', () => {
  it('5 инпутов трёх слоёв — уникальные aria-label', async () => {
    stubPanelViews('s1');
    render(<MemoryPanel sessionId="s1" />);

    // Панель рендерит форму только после GET-вью.
    await screen.findByText(/Long-term/);

    // getByLabelText бросает и на «не найдено», и на «несколько» — каждый
    // ассерт заодно проверяет уникальность имени внутри панели.
    expect(screen.getByLabelText('ключ (long-term)')).toBeTruthy();
    expect(screen.getByLabelText('значение (long-term)')).toBeTruthy();
    expect(screen.getByLabelText('текущая задача')).toBeTruthy();
    expect(screen.getByLabelText('ключ (рабочий факт)')).toBeTruthy();
    expect(screen.getByLabelText('значение (рабочий факт)')).toBeTruthy();
  });
});

describe('ConstraintsPanel: вертикальная форма через Field', () => {
  it('select и оба текстовых поля связаны с label', async () => {
    stubPanelViews('s2');
    render(<ConstraintsPanel sessionId="s2" />);

    await screen.findByText(/Добавить инвариант/);

    const type = screen.getByLabelText('Тип') as HTMLSelectElement;
    const title = screen.getByLabelText('Название') as HTMLInputElement;
    const desc = screen.getByLabelText('Описание') as HTMLInputElement;
    expect(type.tagName).toBe('SELECT');
    expect(type.value).toBe('stack');
    expect(title).toBeTruthy();
    expect(desc).toBeTruthy();
  });
});

describe('ProfilePanel: селектор, LLM-инструкция и inline-поля', () => {
  it('4 контрола доступны по уникальным именам', async () => {
    stubPanelViews('s3');
    render(<ProfilePanel sessionId="s3" />);

    await screen.findByText(/Активный профиль/);

    const select = screen.getByLabelText('активный профиль') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('default');

    const instruction = screen.getByLabelText('Инструкция для LLM') as HTMLTextAreaElement;
    expect(instruction.tagName).toBe('TEXTAREA');

    expect(screen.getByLabelText('имя нового профиля')).toBeTruthy();
    expect(screen.getByLabelText('заметка к активному профилю')).toBeTruthy();
  });
});

describe('BranchesPanel: Field «Метка» в ряду с кнопкой', () => {
  it('инпут метки доступен по имени, кнопка остаётся в ряду', async () => {
    stubPanelViews('s4');
    render(<BranchesPanel sessionId="s4" />);

    await screen.findByText(/ветка про трансферы/);

    const label = screen.getByLabelText('Метка') as HTMLInputElement;
    expect(label.tagName).toBe('INPUT');
    expect(screen.getByRole('button', { name: /checkpoint/ })).toBeTruthy();
  });
});
