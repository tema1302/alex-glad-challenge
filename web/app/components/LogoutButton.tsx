// 'use client': кнопка «Выйти» в Nav (админ). POST /api/auth/logout (не GET-линк —
// мутация = POST), затем полная загрузка '/' (гость получает лендинг и гостевой хром).
'use client';

import { useState } from 'react';
import { Button } from './ui/Button';
import { IconLogout } from './ui/icons';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  const logout = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // При сетевой ошибке всё равно уходим: серверная cookie истечёт по maxAge.
    }
    window.location.assign('/');
  };

  return (
    <Button
      variant="ghost"
      onClick={() => void logout()}
      disabled={loading}
      aria-label="Выйти"
      title="Выйти"
      className="max-sm:aspect-square max-sm:!px-0"
    >
      <IconLogout className="h-4 w-4 sm:hidden" />
      <span className="max-sm:sr-only">{loading ? '…' : 'Выйти'}</span>
    </Button>
  );
}
