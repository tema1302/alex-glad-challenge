// Query rewrite (день 23): одно переформулирование вопроса для семантического поиска.
// Опциональная стадия пайплайна (off по умолчанию). Переиспользуем makeLocalLlmClient.
// Ошибка или пустой ответ — вернуть исходный вопрос (не падать, ретрив продолжает работать).

import type { LlmClient } from '../client.js';
import { msg } from '../types.js';

const SYSTEM_REWRITE =
  'Отвечай ТОЛЬКО на русском языке. Переформулируй вопрос для семантического поиска ' +
  'по мануалу автомобиля: подбери точные технические термины и синонимы, сохранив смысл. ' +
  'Верни только переформулированный вопрос одной строкой, без объяснений и кавычек.';

export async function rewriteQuery(client: LlmClient, question: string): Promise<string> {
  try {
    const out = await client.chat([msg.system(SYSTEM_REWRITE), msg.user(question)], {
      temperature: 0,
    });
    const clean = out
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["«]|["»]$/g, '')
      .trim();
    return clean.length > 0 ? clean : question;
  } catch {
    return question;
  }
}
