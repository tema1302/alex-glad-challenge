// 'use client'-форма входа (паттерн telegram/publish: useState + fetch + Button).
// Успех → полная загрузка window.location.assign(next): свежий серверный хром с cookie
// (гость→админ меняет layout, soft-навигация не перерисует его). Ошибка — error-строка.
'use client';

import { useState } from 'react';
import { Button } from '../components/ui/Button';

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
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
      className="bento-enter rounded-2xl border border-line bg-surface p-6"
    >
      <h1 className="font-mono text-lg font-semibold uppercase tracking-tight text-ink">Вход</h1>
      <p className="mt-1 text-sm text-dim">Личный кабинет. Введите пароль администратора.</p>
      <label htmlFor="password" className="mt-4 block text-sm text-dim">
        Пароль
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        className="mt-1 w-full rounded border border-line-strong bg-surface-2 px-3 py-2 font-sans text-sm text-ink transition placeholder:text-dim focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={loading}
        placeholder="••••••••"
      />
      <Button
        variant="primary"
        type="submit"
        className="mt-4 w-full justify-center"
        disabled={loading || !password}
      >
        {loading ? '…' : 'Войти'}
      </Button>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-err/40 bg-err/10 p-2 text-sm text-err">
          {error}
        </p>
      )}
    </form>
  );
}
