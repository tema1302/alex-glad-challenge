// @vitest-environment jsdom
// S6: /blog/pipeline при сбое загрузки — честная error-карточка с «Повторить»
// (раньше и загрузка, и сбой были одной строкой текста без действия).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PipelinePage from '../../app/blog/pipeline/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STAGES = ['idle', 'planning', 'execution', 'validation', 'revision', 'done'] as const;

const VIEW = {
  stage: 'idle',
  step: '—',
  expectedAction: 'начать с планирования',
  allowed: ['planning'],
  revisionCount: 0,
  history: [],
  labels: Object.fromEntries(STAGES.map((s) => [s, s])),
};

function json(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

describe('PipelinePage: сбой загрузки ≠ «Загрузка…»', () => {
  it('сбой → error-карточка «Повторить»; retry рендерит стадии', async () => {
    let pipelineCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/blog/pipeline') {
          pipelineCalls += 1;
          if (pipelineCalls === 1) throw new Error('network down');
          return json(VIEW);
        }
        return json({});
      }),
    );

    render(<PipelinePage />);
    const user = userEvent.setup();

    expect(await screen.findByText('ошибка загрузки')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Разрешённые переходы')).toBeInTheDocument();
    expect(screen.queryByText('ошибка загрузки')).toBeNull();
  });
});
