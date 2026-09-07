// @vitest-environment jsdom
// Component: Field — связка label↔контрол, aria-describedby/invalid, hint/error.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Field } from '../../app/components/ui/Field';
import { Textarea } from '../../app/components/ui/Textarea';

afterEach(cleanup);

describe('Field', () => {
  it('label связан htmlFor→id, инжектит id и aria-describedby в контрол', () => {
    render(
      <Field id="msg" label="Текст сообщения" hint="HTML разрешён">
        <textarea />
      </Field>,
    );

    const label = screen.getByText('Текст сообщения');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'msg');

    const textarea = screen.getByLabelText('Текст сообщения');
    expect(textarea).toHaveAttribute('id', 'msg');
    expect(textarea).toHaveAttribute('aria-describedby', 'msg-hint');
    expect(textarea).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('HTML разрешён')).toHaveAttribute('id', 'msg-hint');
  });

  it('ошибка: текст + aria-invalid + aria-describedby на error-id (не только цветом)', () => {
    render(
      <Field id="msg" label="Текст" hint="подсказка" error="Превышен лимит 4096 символов">
        <textarea />
      </Field>,
    );

    const textarea = screen.getByLabelText('Текст');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', 'msg-error');
    expect(screen.getByText('Превышен лимит 4096 символов')).toHaveAttribute('id', 'msg-error');
    // При ошибке hint скрывается — не дублируем
    expect(screen.queryByText('подсказка')).toBeNull();
  });

  it('Textarea внутри Field: счётчик n/max и ввод', () => {
    const onValueChange = vi.fn();
    render(
      <Field id="tg" label="Текст">
        <Textarea value="abc" onValueChange={onValueChange} max={4096} warnAt={3800} />
      </Field>,
    );

    expect(screen.getByText('3 / 4096')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'abcd' } });
    expect(onValueChange).toHaveBeenCalledWith('abcd');
  });
});
