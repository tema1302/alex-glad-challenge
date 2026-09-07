// @vitest-environment jsdom
// Component: Textarea (счётчик/warn/over) + Tabs (a11y role=tablist) + Badge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Textarea } from '../../app/components/ui/Textarea';
import { Tabs } from '../../app/components/ui/Tabs';
import { Badge, statusBadge } from '../../app/components/ui/Badge';

afterEach(cleanup);

describe('Textarea', () => {
  it('счётчик: обычный → dim; ≥warnAt → warn; >max → err', () => {
    const { rerender } = render(<Textarea value="12345" onValueChange={() => undefined} max={100} warnAt={50} />);
    const counter = screen.getByText('5 / 100');
    expect(counter.className).not.toContain('text-warn');

    rerender(<Textarea value={'a'.repeat(50)} onValueChange={() => undefined} max={100} warnAt={50} />);
    expect(screen.getByText('50 / 100').className).toContain('text-warn');

    rerender(<Textarea value={'a'.repeat(101)} onValueChange={() => undefined} max={100} warnAt={50} />);
    expect(screen.getByText('101 / 100').className).toContain('text-err');
  });

  it('без max счётчик не рендерится', () => {
    render(<Textarea value="x" onValueChange={() => undefined} />);
    expect(screen.queryByText(/\/ 4096/)).toBeNull();
  });
});

describe('Tabs', () => {
  it('active таб aria-selected, клик вызывает onChange, role=tablist', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Вид превью"
        tabs={[
          { id: 'render', label: 'Рендер' },
          { id: 'html', label: 'HTML' },
        ]}
        active="render"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Вид превью');
    const renderTab = screen.getByRole('tab', { name: 'Рендер' });
    const htmlTab = screen.getByRole('tab', { name: 'HTML' });
    expect(renderTab).toHaveAttribute('aria-selected', 'true');
    expect(htmlTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(htmlTab);
    expect(onChange).toHaveBeenCalledWith('html');
  });
});

describe('Badge / statusBadge', () => {
  it('statusBadge: draft → dim, published → ok, error → err', () => {
    const { container: c1 } = render(statusBadge('draft'));
    expect(c1.textContent).toBe('draft');
    const { container: c2 } = render(statusBadge('published'));
    expect(c2.textContent).toBe('published');
    const { container: c3 } = render(statusBadge('error'));
    expect(c3.textContent).toBe('error');
    expect(c3.querySelector('span')?.className).toContain('text-err');
  });

  it('Badge с произвольным тоном', () => {
    render(<Badge tone="accent">manual</Badge>);
    expect(screen.getByText('manual').className).toContain('text-accent');
  });
});
