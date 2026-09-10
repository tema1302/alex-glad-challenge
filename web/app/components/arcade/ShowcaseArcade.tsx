'use client';

// Аркада витрины: три игры на данных страницы — клик tab-а переключает режим.
// Client Component: страница /showcase остаётся серверной, аркада — остров.
import { useState } from 'react';
import { Tabs } from '../ui/Tabs';
import { QuizGame } from './QuizGame';
import { LayersGame } from './LayersGame';
import { StackGame } from './StackGame';

const GAME_TABS = [
  { id: 'quiz', label: 'Угадай модуль' },
  { id: 'layers', label: 'Собери архитектуру' },
  { id: 'stack', label: 'Разложи стек' },
] as const;

type GameId = (typeof GAME_TABS)[number]['id'];

export function ShowcaseArcade() {
  const [game, setGame] = useState<GameId>('quiz');

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-dim">
        Тот же материал, что на витрине ниже, — только в режиме «потыкать»: отвечайте, собирайте, раскладывайте.
      </p>
      <Tabs tabs={[...GAME_TABS]} active={game} onChange={(id) => setGame(id as GameId)} label="Режим игры" />
      <div className="rounded-xl border border-line bg-surface p-4 shadow-panel">
        {game === 'quiz' && <QuizGame />}
        {game === 'layers' && <LayersGame />}
        {game === 'stack' && <StackGame />}
      </div>
    </div>
  );
}
