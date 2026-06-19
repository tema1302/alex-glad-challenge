// Агент 2. Написание поста в Telegram-канал.
// Берёт выбранную новость, few-shot примеры стиля и профиль пользователя,
// генерирует пост с учётом персонализации (день 12).

import type { BlogDb, NewsRow, StyleSampleRow } from '../db.js';
import { LlmClient, msg } from '../index.js';
import type { ProfileManager } from '../profile.js';

export interface WrittenPost {
  content: string;
  news: NewsRow;
}

export class PostWriter {
  constructor(
    private client: LlmClient,
    private profile?: ProfileManager,
  ) {}

  async write(db: BlogDb, news: NewsRow): Promise<WrittenPost> {
    const samples = db.styleSamples(5);
    const fewShot = samples.length > 0
      ? formatSamples(samples)
      : DEFAULT_STYLE_HINT;

    const profileData = this.profile?.active;
    const profileBlock = profileData
      ? `\n=== ПРОФИЛЬ АВТОРА (персонализация) ===\n${this.profile!.toPromptText()}\n`
      : '';

    const club = profileData?.любимый_клуб ?? 'Челси';
    const style = profileData?.стиль ?? 'ироничный, резкий';
    const emojiRule = profileData?.эмодзи ?? 'умеренно';
    const signature = profileData?.подпись ?? '@lookatfacts';
    const lengthRule = profileData?.длина_постов ?? '200-500 символов';
    const formatRule = profileData?.формат_абзацев ?? '2-4 предложения на абзац';
    const taboos = profileData?.табу ?? 'без мата, без политики';

    const prompt = `Ты автор Telegram-канала про футбольный клуб ${club}.
Напиши пост под новость ниже, СТРОГО соблюдая профиль автора и стиль.
${profileBlock}
=== НОВОСТЬ ===
Заголовок: ${news.title}
Источник: ${news.source}
Текст: ${news.summary}
Дата: ${news.published_at}

=== ОБРАЗЦЫ СТИЛЯ ===
${fewShot}

=== ПРАВИЛА ===
- Стиль: ${style}.
- Шапка: «Иди на факты глянь: » (без даты и времени).
- Капсом ВЫДЕЛЯТЬ ключевые слова для акцента.
- Эмодзи: ${emojiRule}.
- Риторические вопросы, разговорная речь.
- В конце подпись: ${signature}
- Объём: ${lengthRule}.
- Если новость не про ${club} — найди угол связи (${club} должен подписать, ${club} сыграл бы так, ${club} нужен такой игрок).
- НЕ выдумывать факты, которых нет в новости.
- НЕ ОБРЕЗАЙ пост на полуслове.

=== ОГРАНИЧЕНИЯ ===
${taboos}

=== ФОРМАТИРОВАНИЕ ===
- ${formatRule}.
- Между абзацами — пустая строка.

Выдай только готовый пост, без преамбул.
ПЕРВЫЙ символ ответа — "И" (от "Иди на факты глянь:").`;

    const content = await this.client.chat(
      [msg.user(prompt)],
      { temperature: 0.7, maxTokens: 3000 },
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
