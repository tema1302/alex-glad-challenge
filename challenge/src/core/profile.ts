// Менеджер профилей: много профилей, активный один.
// Каждый профиль — .data/profiles/<name>.json.
// Редактирование через LLM: /profile-edit <естественный текст>.
//
// Использование:
//   const mgr = new ProfileManager(dir);
//   mgr.load('default');
//   mgr.active?.get('любимый_клуб');  // → 'Челси'
//   await mgr.editViaLLM('убери эмодзи и добавь сарказма', client);

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { msg } from './types.js';

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

export interface LlmClientLike {
  chat(messages: ChatMessage[], params?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

export class ProfileManager {
  private dir: string;
  private _activeName: string | null = null;
  private _data: UserProfile = { ...DEFAULT_PROFILE };

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  get activeName(): string | null {
    return this._activeName;
  }

  get active(): UserProfile | null {
    return this._activeName ? this._data : null;
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  }

  load(name: string): boolean {
    const filePath = path.join(this.dir, `${name}.json`);
    if (!existsSync(filePath)) return false;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<UserProfile>;
      this._data = { ...DEFAULT_PROFILE, ...parsed };
      this._activeName = name;
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    if (!this._activeName) return;
    const filePath = path.join(this.dir, `${this._activeName}.json`);
    writeFileSync(filePath, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  create(name: string, base?: Partial<UserProfile>): void {
    this._data = { ...DEFAULT_PROFILE, ...base };
    this._activeName = name;
    this.save();
  }

  copy(newName: string): boolean {
    if (!this._activeName) return false;
    this.create(newName, this._data);
    return true;
  }

  delete(name: string): boolean {
    if (name === this._activeName) return false;
    const filePath = path.join(this.dir, `${name}.json`);
    if (!existsSync(filePath)) return false;
    import('node:fs').then(({ unlinkSync }) => unlinkSync(filePath));
    return true;
  }

  get<K extends keyof UserProfile>(key: K): UserProfile[K] {
    return this._data[key];
  }

  set<K extends keyof UserProfile>(key: K, value: string): void {
    if (!PROFILE_FIELDS.includes(key)) {
      throw new Error(`Неизвестное поле: "${key}". Доступно: ${PROFILE_FIELDS.join(', ')}`);
    }
    (this._data as unknown as Record<string, string>)[key] = value;
  }

  reset(): void {
    this._data = { ...DEFAULT_PROFILE };
  }

  get fields(): (keyof UserProfile)[] {
    return PROFILE_FIELDS;
  }

  snapshot(): UserProfile {
    return { ...this._data };
  }

  toPromptText(): string {
    return PROFILE_FIELDS.map((k) => `- ${k}: ${this._data[k]}`).join('\n');
  }

  toSystemBlock(): string {
    return `Профиль автора канала:\n${this.toPromptText()}`;
  }

  // Редактирование профиля естественным языком через LLM.
  // Пример: "убери эмодзи, добавь больше сарказма, длина 300 символов".
  // LLM получает текущий профиль + инструкцию, возвращает обновлённый JSON.
  async editViaLLM(instruction: string, client: LlmClientLike): Promise<string> {
    const current = JSON.stringify(this._data, null, 2);
    const prompt = `Ты редактор профиля Telegram-канала.
Тебе передан текущий профиль в JSON и инструкция от пользователя.
Примени изменения и верни ОБНОВЛЁННЫЙ профиль в том же JSON-формате.

ПРАВИЛА:
- Верни СТРОГО JSON. ПЕРВЫЙ СИМВОЛ — "{".
- Сохраняй ВСЕ поля, даже если инструкция их не затрагивает.
- Если инструкция неоднозначна — трактуй в сторону минимальных изменений.
- Не добавляй новые поля, не удаляй существующие.

ТЕКУЩИЙ ПРОФИЛЬ:
${current}

ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ:
${instruction}

ОБНОВЛЁННЫЙ ПРОФИЛЬ:`;

    const raw = await client.chat(
      [msg.user(prompt)],
      { temperature: 0.2, maxTokens: 1500 },
    );

    const updated = parseProfileJson(raw);
    if (!updated) {
      throw new Error('LLM вернул невалидный JSON профиля');
    }
    this._data = { ...DEFAULT_PROFILE, ...updated };
    this.save();
    return diffProfiles(current, JSON.stringify(this._data, null, 2));
  }
}

function parseProfileJson(raw: string): Partial<UserProfile> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Partial<UserProfile>;
  } catch {
    return null;
  }
}

function diffProfiles(before: string, after: string): string {
  const beforeObj = JSON.parse(before) as Record<string, string>;
  const afterObj = JSON.parse(after) as Record<string, string>;
  const changes: string[] = [];
  for (const key of Object.keys(afterObj)) {
    if (beforeObj[key] !== afterObj[key]) {
      changes.push(`  ${key}: "${beforeObj[key]}" → "${afterObj[key]}"`);
    }
  }
  if (changes.length === 0) return 'Без изменений';
  return changes.join('\n');
}
