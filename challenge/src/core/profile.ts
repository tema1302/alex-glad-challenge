// Профиль пользователя: структурированная персонализация поверх long-term memory.
// Хранится в .data/profile.json, переживает перезапуск.
// Подключается к каждому запросу: пост-райтер, news-фильтр, REPL-чат.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface UserProfile {
  любимый_клуб: string;
  стиль: string;
  формат_абзацев: string;
  эмодзи: string;
  длина_постов: string;
  подпись: string;
  табу: string;
  язык: string;
}

const DEFAULT_PROFILE: UserProfile = {
  любимый_клуб: 'Челси',
  стиль: 'ироничный, резкий, с подколами',
  формат_абзацев: '2-4 предложения на абзац, пустая строка между ними',
  эмодзи: 'умеренно (🤣 😁 🙄 🔥)',
  длина_постов: '200-500 символов',
  подпись: '@lookatfacts',
  табу: 'без мата, без политики, без оскорблений игроков',
  язык: 'русский',
};

const PROFILE_FIELDS = Object.keys(DEFAULT_PROFILE) as (keyof UserProfile)[];

export class Profile {
  private data: UserProfile;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = { ...DEFAULT_PROFILE };
    this.ensureDir();
  }

  get fields(): (keyof UserProfile)[] {
    return PROFILE_FIELDS;
  }

  get<K extends keyof UserProfile>(key: K): UserProfile[K] {
    return this.data[key];
  }

  set<K extends keyof UserProfile>(key: K, value: string): void {
    if (!PROFILE_FIELDS.includes(key)) {
      throw new Error(`Неизвестное поле профиля: "${key}". Доступно: ${PROFILE_FIELDS.join(', ')}`);
    }
    (this.data as unknown as Record<string, string>)[key] = value;
  }

  reset(): void {
    this.data = { ...DEFAULT_PROFILE };
  }

  save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  load(): number {
    if (!existsSync(this.filePath)) return 0;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<UserProfile>;
      this.data = { ...DEFAULT_PROFILE, ...parsed };
      return Object.keys(parsed).length;
    } catch {
      return 0;
    }
  }

  // Полный текст профиля для инъекции в промпт.
  toPromptText(): string {
    const lines = PROFILE_FIELDS.map((k) => `- ${k}: ${this.data[k]}`);
    return lines.join('\n');
  }

  // Профиль как система сообщений для LLM.
  toSystemBlock(): string {
    return `Профиль автора канала:\n${this.toPromptText()}`;
  }

  snapshot(): UserProfile {
    return { ...this.data };
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
