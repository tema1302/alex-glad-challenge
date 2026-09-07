'use client';

// ConfirmDialog (ТЗ §5.4): надстройка над Dialog для реальных внешних действий
// (publish/delete). Асинхронный onConfirm с loading; успех закрывает диалог,
// ошибка оставляет открытым (родитель показывает toast) — текст не теряется.
// Пока onConfirm выполняется, закрытие (Esc/подложка/cancel) заблокировано.

import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  tone = 'primary',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: ReactNode;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}) {
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Ошибку показывает родитель (toast/Card) — диалог остаётся открытым.
    } finally {
      setBusy(false);
    }
  };

  const requestClose = (): void => {
    if (!busy) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title={title}
      tone={tone === 'danger' ? 'danger' : 'default'}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => void run()}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}
