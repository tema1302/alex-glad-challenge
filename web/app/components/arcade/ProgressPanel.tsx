'use client';

// Панель прогресса аркады: уровень, полоса XP до следующего уровня, счётчик
// достижений и кнопка «Поделиться» (клипборд + Telegram). Список достижений —
// сворачиваемый: открытые — цветные, закрытые — с подсказкой как открыть.
// Данные — useProgress() (localStorage + CustomEvent), вся логика в progress.ts.
import { useState } from 'react';
import { Button } from '../ui/Button';
import { IconChevronRight } from '../ui/icons';
import { useToast } from '../ui/Toast';
import {
  ACHIEVEMENT_DEFS,
  levelProgress,
} from './progress';
import { useProgress } from './use-progress';
import { buildProfileShareText, tgShareUrl } from './share-card';

export function ProgressPanel() {
  const { toast } = useToast();
  const progress = useProgress();
  const [expanded, setExpanded] = useState(false);

  const lp = levelProgress(progress.xp);
  const unlocked = new Set(progress.achievements);

  const share = async (): Promise<void> => {
    const text = buildProfileShareText(progress);
    const url = tgShareUrl(text);
    try {
      await navigator.clipboard.writeText(text);
      toast('ok', 'Результат скопирован — вставьте в чат или канал');
    } catch {
      /* клипборд недоступен (права/http) — остаётся переход в Telegram */
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-ink">ур. {lp.level}</span>
          <span className="text-sm text-dim">{lp.title}</span>
        </div>

        {/* Полоса XP до следующего уровня (на максимуме — заполнена) */}
        <div
          className="min-w-[140px] flex-1"
          role="progressbar"
          aria-label="Прогресс до следующего уровня"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(lp.fraction * 100)}
        >
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-base ease-system"
              style={{ width: `${Math.round(lp.fraction * 100)}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-[11px] text-dim">
            {progress.xp} XP
            {lp.xpToNext !== null ? ` · до след. уровня ${lp.xpToNext} XP` : ' · максимум'}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            icon={<IconChevronRight className={expanded ? 'rotate-90 transition-transform' : 'transition-transform'} />}
          >
            Достижения {unlocked.size}/{ACHIEVEMENT_DEFS.length}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void share()}>
            Поделиться
          </Button>
        </div>
      </div>

      {expanded && (
        <ul className="mt-4 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
          {ACHIEVEMENT_DEFS.map((a) => {
            const got = unlocked.has(a.id);
            return (
              <li
                key={a.id}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${
                  got ? 'border-accent-dim bg-accent/10' : 'border-line bg-surface-2 opacity-70'
                }`}
              >
                <span aria-hidden="true" className={got ? '' : 'grayscale'}>
                  {a.emoji}
                </span>
                <span className="min-w-0">
                  <span className={`block font-medium ${got ? 'text-ink' : 'text-dim'}`}>{a.title}</span>
                  <span className="block text-xs text-dim">{got ? 'открыто' : a.hint}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
