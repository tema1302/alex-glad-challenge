// @vitest-environment jsdom
// Component: TgMessage (санитайз-превью пузыря Telegram) + CountUp (proof-цифры).
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TgMessage } from '../../app/components/ui/TgMessage';
import { CountUp } from '../../app/components/CountUp';

describe('TgMessage', () => {
  it('рендерит разрешённую разметку', () => {
    const { container } = render(<TgMessage html="<b>жирный</b> и <code>код</code>" />);
    expect(container.querySelector('b')).toHaveTextContent('жирный');
    expect(container.querySelector('code')).toHaveTextContent('код');
  });

  it('скрипты и запрещённые теги не попадают в DOM (whitelist sanitize)', () => {
    const { container } = render(
      <TgMessage html={'<b>ok</b><script>window.__pwned = true</script><img src=x onerror=alert(1)>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // Запрещённые теги видны как экранированный текст, не исполняются
    expect(container.textContent).toContain('<script>');
  });
});

describe('CountUp', () => {
  it('reduce-motion (тестовый стаб) → мгновенный финальный результат', async () => {
    render(<CountUp value="82" />);
    await waitFor(() => expect(screen.getByText('82')).toBeInTheDocument());
  });

  it('суффикс сохраняется (10+, 0₽)', async () => {
    render(
      <>
        <CountUp value="10+" />
        <CountUp value="0₽" />
      </>,
    );
    await waitFor(() => expect(screen.getByText('10+')).toBeInTheDocument());
    expect(screen.getByText('0₽')).toBeInTheDocument();
  });

  it('не-числовое значение проходит как есть', () => {
    render(<CountUp value="∞" />);
    expect(screen.getByText('∞')).toBeInTheDocument();
  });
});
