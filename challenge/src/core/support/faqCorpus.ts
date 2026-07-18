// Кураторский FAQ-корпус support-assistant для продукта CloudNote (день 33).
// Ручные Chunk[]: один чанк = один Q&A (максимальная точность retrieve, без
// правок chunker). Стратегия 'faq' → indexDocuments напрямую (НЕ runIndexing),
// партиции fixed/structure/telegram/docs в rag.sqlite не затрагиваются.
//
// 4 чанка соответствуют кейсам 1–4 research-critic §5 (Auth/2FA, оплата,
// экспорт, Slack-интеграция). Кейс 5 (batch-экспорт «всей команды разом»)
// намеренно ОТСУТСТВУЕТ в корпусе — это no-RAG edge для проверки guard'а
// «не знаю» (decideGuard reason=empty) в Validation.

import type { Chunk, ChunkingStrategy } from '../rag/types.js';

export const FAQ_STRATEGY: ChunkingStrategy = 'faq';

interface FaqEntry {
  title: string;       // тема
  question: string;    // вопрос пользователя
  answer: string;      // ответ поддержки
}

const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    title: 'Авторизация и 2FA',
    question: 'Почему не работает авторизация и бесконечный редирект после 2FA?',
    answer:
      'Если не проходит вход после 2FA — используйте одноразовые коды восстановления со страницы /security. ' +
      'Бесконечный редирект после 2FA чаще всего = устаревшие cookie сессии: очистите cookie домена cloudnote.example ' +
      'или войдите в режиме инкогнито. Коды восстановления регенерируются раз в 30 дней; ' +
      'новые коды можно получить на /security после входа.',
  },
  {
    title: 'Тарифы и возвраты',
    question: 'Списали деньги, но Pro не активировался — где инвойс и как вернуть?',
    answer:
      'Тариф Pro активируется в течение 5 минут после оплаты. Если списание прошло, а статус не сменился — ' +
      'пришлите invoice_id (например INV-77123) в поддержку, мы проверим платёж. ' +
      'Возврат в течение 14 дней с оплаты по запросу на billing@cloudnote.example с указанием invoice_id.',
  },
  {
    title: 'Экспорт и форматы',
    question: 'Почему экспорт в PDF падает с ошибкой EX-304?',
    answer:
      'Экспорт одной заметки в PDF недоступен для заметок крупнее 50 MB и для заметок с вложениями-video. ' +
      'Ошибка EX-304 = превышение размера. Альтернатива — экспорт в Markdown, затем конвертация в PDF внешним инструментом. ' +
      'Поштучный экспорт выполняется из меню заметки «Export → PDF/Markdown».',
  },
  {
    title: 'Интеграции и webhook',
    question: 'Почему Slack-интеграция не постит сообщения в канал?',
    answer:
      'Slack-интеграция требует webhook URL с правами incoming-webhook на конкретный канал. ' +
      'Если посты не идут — проверьте, что webhook не отозван в настройках Slack-приложения и что целевой канал существует. ' +
      'CloudNote не хранил и не хранит токены каналов: webhook URL вводится пользователем в настройках интеграции. ' +
      'Пересоздайте webhook в Slack и обновите его в настройках интеграции CloudNote.',
  },
];

export function buildFaqChunks(): Chunk[] {
  return FAQ_ENTRIES.map((e, i) => ({
    text: `${e.title}\n\nВопрос: ${e.question}\n\nОтвет: ${e.answer}`,
    metadata: {
      source: 'faq.md',
      title: e.title,
      section: `Q: ${e.question}`,
      chunkId: `faq::${i + 1}`,
    },
  }));
}
