// 'use client'-форма входа (ТЗ §8.2): карточка с Field + eye-toggle, error-строкой
// и submit с loading. Успех → полная загрузка window.location.assign(next):
// свежий серверный хром с cookie (гость→админ меняет layout, soft-навигация
// не перерисует его).
'use client';

import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { IconEye, IconEyeOff } from '../components/ui/icons';

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (): Promise<void> => {
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) {
        setError(data.error ?? `HTTP ${r.status}`);
        setLoading(false);
      } else {
        window.location.assign(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      className="rounded-lg border border-line bg-surface p-6 shadow-panel"
    >
      <h1 className="font-mono text-lg font-semibold uppercase tracking-tight text-ink">Вход</h1>
      <p className="mt-1 text-sm text-dim">Личный кабинет. Введите пароль администратора.</p>

      <div className="mt-4">
        <Field id="password" label="Пароль" error={error ?? undefined}>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              autoFocus
              className="w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 pr-10 font-sans text-sm text-ink transition placeholder:text-dim focus-visible:border-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim disabled:opacity-50"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
              className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-dim transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
            >
              {show ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
        </Field>
      </div>

      <Button
        variant="primary"
        type="submit"
        className="mt-4 w-full"
        loading={loading}
        disabled={loading || !password}
      >
        Войти
      </Button>
    </form>
  );
}
