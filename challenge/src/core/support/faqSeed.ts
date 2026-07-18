// Seed CRM-демо-данных support-assistant (день 33). Идемпотентный: upsertUser /
// upsertTicket (INSERT OR REPLACE с явным id) — повторный прогон support-seed
// перезаписывает те же строки, сохраняя предсказуемые id #1..5 для smoke-кейсов.
// 5 пользователей + 5 тикетов продукта CloudNote связаны с 5 FAQ-кейсами
// (research-critic §5). details — JSON-строка (валидная) с taint-полями браузера/
// инвойса/webhook; маскировка webhook-токена (кейс 4) делается в supportAssistant
// перед LLM-промптом (не в БД).

import type { CrmDb } from '../crmDb.js';

export interface SeedResult {
  users: number;
  tickets: number;
}

export function seedSupport(db: CrmDb): SeedResult {
  db.upsertUser({ id: 1, name: 'Anna Petrova', email: 'anna@example.com', plan: 'Pro', locale: 'ru', twoFa: 1 });
  db.upsertUser({ id: 2, name: 'Boris Sidorov', email: 'boris@example.com', plan: 'Free', locale: 'ru', twoFa: 0 });
  db.upsertUser({ id: 3, name: 'Vera Korneeva', email: 'vera@example.com', plan: 'Team', locale: 'ru', twoFa: 0 });
  db.upsertUser({ id: 4, name: 'Gleb Minin', email: 'gleb@example.com', plan: 'Pro', locale: 'ru', twoFa: 1 });
  db.upsertUser({ id: 5, name: 'Igor Denisov', email: 'denisov@example.com', plan: 'Free', locale: 'ru', twoFa: 0 });

  db.upsertTicket({
    id: 1,
    userId: 1,
    subject: 'Не могу войти — бесконечный редирект после 2FA',
    status: 'open',
    priority: 'high',
    details: JSON.stringify({
      browser: 'Chrome/Windows',
      last_attempt: '2026-07-17T11:30:00Z',
      cookie_cleared: false,
      two_fa_enabled: true,
    }),
  });
  db.upsertTicket({
    id: 2,
    userId: 2,
    subject: 'Списали деньги, но Pro не активировался',
    status: 'pending',
    priority: 'normal',
    details: JSON.stringify({
      invoice_id: 'INV-77123',
      amount: '$9',
      paid_at: '2026-07-15',
      current_plan: 'Free',
    }),
  });
  db.upsertTicket({
    id: 3,
    userId: 3,
    subject: 'Экспорт в PDF падает с ошибкой',
    status: 'open',
    priority: 'normal',
    details: JSON.stringify({
      note_id: 4521,
      error: 'EX-304',
      size_mb: 78,
    }),
  });
  db.upsertTicket({
    id: 4,
    userId: 4,
    subject: 'Slack-интеграция не постит в канал',
    status: 'open',
    priority: 'normal',
    details: JSON.stringify({
      webhook: 'https://hooks.slack.com/services/T000/B000/SECRETKEY',
      channel: '#eng',
      last_attempt: '2026-07-16T09:00:00Z',
    }),
  });
  db.upsertTicket({
    id: 5,
    userId: 5,
    subject: 'Как экспортировать всю команду разом?',
    status: 'open',
    priority: 'low',
    details: JSON.stringify({
      team_size: 12,
      use_case: 'массовый экспорт всех заметок команды',
    }),
  });

  return { users: 5, tickets: 5 };
}
