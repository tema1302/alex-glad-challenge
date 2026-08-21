// SectionShell — stateless Server Component (landing-v2, D1 «бродсайд»).
// Full-width секция-«глава» с hairline-разделителем (border-t, кроме first)
// + внутренний контейнер max-w-6xl px-5 (контейнерами владеет страница, не layout).
// id → scroll-mt-20 (компенсация sticky header h-12); нумерация «01 · label» — SectionLabel.
import type { ReactNode } from 'react';
import { SectionLabel } from '../ui/SectionLabel';

interface SectionShellProps {
  n: string;
  label: string;
  id?: string;
  first?: boolean;
  children: ReactNode;
}

export function SectionShell({ n, label, id, first = false, children }: SectionShellProps) {
  const sectionClass = [first ? '' : 'border-t border-line', id ? 'scroll-mt-20' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <section id={id} className={sectionClass}>
      <div className="mx-auto w-full max-w-6xl px-5 py-16 md:py-24">
        <SectionLabel>{`${n} · ${label}`}</SectionLabel>
        {children}
      </div>
    </section>
  );
}
