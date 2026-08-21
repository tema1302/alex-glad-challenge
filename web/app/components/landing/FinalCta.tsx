// FinalCta — финальная glow-панель конверсии (landing-v2, единственное заимствование из D3).
// Radial-пятно bg-accent/10 blur-3xl за контентом — ЕДИНСТВЕННЫЙ glow на странице.
// children = SubscribeButton primary (+ строка t.me/…); points — редакционная формула канала.
import type { ReactNode } from 'react';

interface FinalCtaProps {
  heading: string;
  points: readonly string[];
  children: ReactNode;
}

export function FinalCta({ heading, points, children }: FinalCtaProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-accent/30 bg-surface-2 p-8 md:p-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 left-1/2 h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative">
        <h2 className="font-mono text-2xl font-semibold uppercase leading-tight tracking-tight text-ink md:text-3xl">
          {heading}
        </h2>
        <ul className="mt-6 space-y-3">
          {points.map((point) => (
            <li
              key={point}
              className="flex items-start gap-3 text-sm leading-relaxed text-dim md:text-base"
            >
              <span
                aria-hidden
                className="mt-[9px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              />
              {point}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">{children}</div>
      </div>
    </div>
  );
}
