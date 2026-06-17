// Агент 2. Написание поста в Telegram-канал.
// Берёт выбранную новость и few-shot примеры стиля, генерирует пост
// в стиле «Иди на факты глянь»: резкий, с иронией, с эмодзи и шапкой.

import type { BlogDb, NewsRow, StyleSampleRow } from '../db.js';
import { LlmClient, msg } from '../index.js';

export interface WrittenPost {
  content: string;
  news: NewsRow;
}

export class PostWriter {
  constructor(private client: LlmClient) {}

  async write(db: BlogDb, news: NewsRow): Promise<WrittenPost> {
    const samples = db.styleSamples(5);
    const fewShot = samples.length > 0
      ? formatSamples(samples)
      : DEFAULT_STYLE_HINT;

    const prompt = `Ты автор Telegram-канала «Иди на факты глянь» про футбольный клуб Челси.
Напиши пост под новость ниже, СТРОГО копируя стиль автора.

=== НОВОСТЬ ===
Заголовок: ${news.title}
Источник: ${news.source}
Текст: ${news.summary}
Дата: ${news.published_at}

=== ОБРАЗЦЫ СТИЛЯ ===
${fewShot}

=== ПРАВИЛА СТИЛЯ ===
- Шапка: «Иди на факты глянь: » (без даты и времени).
- Резкий, уверенный тон, с иронией и подколами.
- Капсом ВЫДЕЛЯТЬ ключевые слова для акцента (УДОБНЫЙ, ЖЕСТКИХ, ПЛОХО и т.п.).
- Эмодзи умеренно (🤣, 😁, 🙄, 🎙).
- Риторические вопросы, разговорная речь (камон, мужики, ну прям).
- В конце подпись: @lookatfacts
- Объём: 6-15 предложений.
- Если новость не про Челси — найди угол связи (Челси должен подписать, Челси сыграл бы так, Челси нужен такой игрок).
- НЕ выдумывать факты, которых нет в новости (имена, цифры, счета берём только из источника).

Выдай только готовый пост, без преамбул и без markdown-разметки.
НЕ пиши рассуждения типа "Drafting post" или "Body:". ПЕРВЫЙ символ ответа — "И" (от "Иди на факты глянь:").`;

    const content = await this.client.chat(
      [msg.user(prompt)],
      { temperature: 0.7, maxTokens: 2000 },
    );

    return { content: content.trim(), news };
  }
}

const DEFAULT_STYLE_HINT =
  'Образцов нет в БД. Используй типичный стиль канала «Иди на факты глянь»: ' +
  'резкий, ироничный, с риторическими вопросами, капсом для акцентов и эмодзи. ' +
  'В конце подпись @lookatfacts.';

function formatSamples(rows: StyleSampleRow[]): string {
  return rows
    .map((s, i) => `--- ОБРАЗЕЦ ${i + 1} ---\n${s.text}`)
    .join('\n\n');
}
