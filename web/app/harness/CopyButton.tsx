// 'use client': единственный клиентский компонент /harness — копирование шаблона
// в буфер обмена (navigator.clipboard, требует secure-context; dev на 127.0.0.1 —
// secure). Фолбэка нет: при недоступности API текст остаётся выделяемым вручную в <pre>.
'use client';

import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // clipboard недоступен (не secure-context) — ручное выделение в <pre> остаётся.
    }
  };

  return (
    <Button variant="ghost" onClick={() => void copy()} className={copied ? 'text-ok' : undefined}>
      {copied ? 'скопировано' : 'скопировать'}
    </Button>
  );
}
