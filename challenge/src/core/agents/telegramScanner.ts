// Агент 3: TelegramScanner.
// Через MTProto (gram.js) читает последние посты из указанных каналов,
// считает реакции и просмотры, отдаёт самые горячие темы.
//
// Требует: TG_API_ID, TG_API_HASH в .env.
// При первом запуске — интерактивная авторизация по номеру телефона.
// Сессия сохраняется в .data/tg-session.json.

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';

const CHANNELS = [
  'englishaccent',
  'news_blues',
  'Vstakane',
  'bitc2306',
  'lukomski',
];

export class TelegramScannerAgent implements SourceAgent {
  readonly name = 'telegram';
  private client: TelegramClient | null = null;
  private readonly sessionPath: string;

  constructor(sessionDir: string = '.data') {
    mkdirSync(sessionDir, { recursive: true });
    this.sessionPath = path.join(sessionDir, 'tg-session.json');
  }

  async fetch(): Promise<SourceAgentResult> {
    try {
      const client = await this.getClient();
      const allTopics: TrendingTopic[] = [];

      for (const channel of CHANNELS) {
        try {
          const topics = await this.scanChannel(client, channel);
          allTopics.push(...topics);
        } catch (err) {
          console.error(`[telegram] ${channel}: ${(err as Error).message}`);
        }
      }

      // Сортируем по"hype score" (просмотры + реакции).
      allTopics.sort((a, b) => b.hypeScore - a.hypeScore);
      return { agent: this.name, topics: allTopics.slice(0, 15) };
    } catch (err) {
      return { agent: this.name, topics: [], error: (err as Error).message };
    }
  }

  private async scanChannel(client: TelegramClient, channel: string): Promise<TrendingTopic[]> {
    // Получаем последние посты из канала.
    const entity = await client.getEntity(channel);
    const messages = await client.getMessages(entity, { limit: 15 });

    const topics: TrendingTopic[] = [];

    for (const msg of messages) {
      if (!msg.message || msg.message.length < 20) continue;

      // Считаем реакции.
      let reactionCount = 0;
      if (msg.reactions) {
        for (const r of msg.reactions.results) {
          reactionCount += r.count;
        }
      }

      const views = msg.views ?? 0;
      const hypeScore = Math.min(100, Math.round((views / 100) + reactionCount));

      topics.push({
        title: msg.message.slice(0, 120).split('\n')[0],
        description: msg.message.slice(0, 200),
        source: `telegram/${channel}`,
        url: `https://t.me/${channel}/${msg.id}`,
        hypeScore,
        hypeReason: `${views} views, ${reactionCount} reactions`,
        rawContent: msg.message.slice(0, 500),
      });
    }

    return topics;
  }

  private async getClient(): Promise<TelegramClient> {
    if (this.client && this.client.connected) return this.client;

    const apiId = Number(process.env['TG_API_ID']);
    const apiHash = process.env['TG_API_HASH'];
    if (!apiId || !apiHash) {
      throw new Error('TG_API_ID или TG_API_HASH не заданы в .env');
    }

    // Загружаем сохранённую сессию.
    let sessionString = '';
    if (existsSync(this.sessionPath)) {
      const data = JSON.parse(readFileSync(this.sessionPath, 'utf-8')) as { session?: string };
      sessionString = data.session ?? '';
    }
    const session = new StringSession(sessionString);

    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.start({
      phoneNumber: async () => {
        // Если сессия есть — этот код не выполнится.
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const phone = await new Promise<string>((resolve) => {
          rl.question('Telegram номер (+7...): ', (a) => resolve(a.trim()));
        });
        rl.close();
        return phone;
      },
      password: async () => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const pw = await new Promise<string>((resolve) => {
          rl.question('2FA пароль: ', (a) => resolve(a.trim()));
        });
        rl.close();
        return pw;
      },
      phoneCode: async () => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const code = await new Promise<string>((resolve) => {
          rl.question('Код из Telegram: ', (a) => resolve(a.trim()));
        });
        rl.close();
        return code;
      },
      onError: (err) => { throw err; },
    });

    // Сохраняем сессию для будущих запусков.
    const newSession = session.save();
    writeFileSync(this.sessionPath, JSON.stringify({ session: newSession }), 'utf-8');

    this.client = client;
    return client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
}
