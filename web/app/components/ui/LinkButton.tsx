import Link from 'next/link';
import { type AnchorHTMLAttributes, type ReactNode } from 'react';

import { FOCUS, SIZES, VARIANTS } from './Button';

// LinkButton (S3 «Кнопки»): ссылка с внешностью кнопки — для действий-навигаций
// («Открыть pipeline», «Создать блог»). Стили общие с Button: карты VARIANTS/
// SIZES/FOCUS импортируются, словарь один; рендер next/link — role=link.
// Без 'use client': компонент не имеет state/эффектов и работает как из
// server-, так и из client-компонентов.
// prefetch={false} по умолчанию: admin-страницы force-dynamic на loopback —
// фоновый prefetch гонял бы сервер-рендеры и withDb-очередь вхолостую;
// opt-in включается пропом.

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: ReactNode;
  /** Иконочный режим: квадратная кнопка-ссылка только с иконкой (пара — Tooltip). */
  square?: boolean;
  /** Next prefetch; по умолчанию выключен (см. комментарий модуля). */
  prefetch?: boolean;
}

export function LinkButton({
  href,
  variant = 'ghost',
  size = 'md',
  icon,
  square = false,
  className = '',
  prefetch = false,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors duration-fast ease-system ${SIZES[size]} ${VARIANTS[variant]} ${FOCUS} ${
        square ? 'aspect-square !px-0' : ''
      } ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </Link>
  );
}
