// Синхронность id агентов между core-реестром и shared-схемой web.
// shared не импортирует core (клиентский бандл), поэтому список живёт в двух
// местах; тест ловит дрейф при добавлении нового агента.
import { describe, expect, it } from 'vitest';

import { BLOG_AGENT_IDS as CORE_IDS } from '@challenge/core/blogAgentPrompts';
import { BLOG_AGENT_IDS as SHARED_IDS } from '../../lib/shared/forms';

describe('BLOG_AGENT_IDS sync', () => {
  it('core и shared содержат один и тот же набор агентов', () => {
    expect([...SHARED_IDS]).toEqual([...CORE_IDS]);
  });
});
