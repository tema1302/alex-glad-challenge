// Агент 2: ForumScanner.
// Соцсети/форумы без ключей: Mastodon (хештеги), Lemmy (футбольное сообщество)
// и Sports.ru (HTML-новости). Reddit удалён: публичный JSON-API нестабилен и
// требует собственного User-Agent-контракта; Mastodon/Lemmy дают открытый JSON.
// Каждый источник — отдельный запрос, ошибка одного не валит весь агент.

import { XMLParser } from 'fast-xml-parser';

import type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';
import { clean } from '../sanitize.js';
import { netFetch, type NetFetchInit } from '../net.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 football-bot/1.0';
const MASTODON_BASE = 'https://mastodon.social';
const LEMMY_BASE = 'https://lemmy.world';
const SPORTSRU_RSS = 'https://www.sports.ru/rss/topnews.xml';

const xmlParser = new XMLParser({ ignoreAttributes: true });

export type ForumFetcher = (url: string, init?: NetFetchInit) => Promise<Response>;

export interface ForumScannerOptions {
  /** Максимум тем в результате агента. */
  readonly limit?: number;
  /** Пользовательский запрос: влияет на выбор Mastodon-хештегов. */
  readonly userQuery?: string;
  /** Инъекция для тестов (по умолчанию netFetch). */
  readonly fetcher?: ForumFetcher;
  readonly lemmyCommunity?: string;
}

interface TagRule {
  readonly test: RegExp;
  readonly tags: ReadonlyArray<string>;
}

// Запрос на русском → английские Mastodon-хештеги. Правила намеренно широкие:
// оркестратор всё равно фильтрует темы по исходному запросу.
const TAG_RULES: ReadonlyArray<TagRule> = [
  { test: /chelsea|челси/i, tags: ['chelsea', 'cfc'] },
  { test: /arsenal|арсенал/i, tags: ['arsenal', 'arsenalfc'] },
  { test: /liverpool|ливерпул/i, tags: ['liverpool', 'lfc'] },
  { test: /man(chester)?\s*(united|utd)|манчестер\s*юнайтед/i, tags: ['manchesterunited', 'mufc'] },
  { test: /man(chester)?\s*city|манчестер\s*сити/i, tags: ['mancity', 'mcfc'] },
  { test: /tottenham|тоттенхэм|шпор/i, tags: ['tottenham', 'thfc'] },
  { test: /premier\s*league|апл|epl/i, tags: ['premierleague', 'epl'] },
  { test: /champions\s*league|лига\s*чемпионов|лч/i, tags: ['championsleague'] },
  { test: /transfer|трансфер/i, tags: ['transfernews', 'transfers'] },
  { test: /stat|xg|статистик|аналитик/i, tags: ['footballstats', 'football'] },
  { test: /real\s*madrid|реал\s*мадрид/i, tags: ['realmadrid'] },
  { test: /barcelona|барселон/i, tags: ['fcbarcelona', 'barca'] },
  { test: /world\s*cup|чемпионат\s*мира|мундиаль/i, tags: ['worldcup'] },
];

const DEFAULT_TAGS = ['football', 'soccer'] as const;

/** Английские Mastodon-хештеги по свободному запросу (для тестов — public). */
export function mastodonTagsForQuery(query: string | undefined): string[] {
  const tags = new Set<string>();
  const q = query ?? '';
  for (const rule of TAG_RULES) {
    if (!rule.test.test(q)) continue;
    for (const tag of rule.tags) tags.add(tag);
  }
  if (tags.size === 0) {
    for (const tag of DEFAULT_TAGS) tags.add(tag);
  } else {
    tags.add('football');
  }
  return Array.from(tags).slice(0, 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** HTML из Mastodon/Lemmy → плоский текст для промпта и UI. */
function stripHtml(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ');
  return clean(text, 500);
}

/** Служебные посты Lemmy (миграция/правила/модерация) — не футбольные темы. */
function isLemmyMeta(title: string): boolean {
  const text = title.toLowerCase();
  return (
    text.startsWith('[announcement]') ||
    text.startsWith('[meta]') ||
    text.includes('community migration') ||
    text.includes('community rules') ||
    text.includes('moderator')
  );
}

function safeHttpUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export class ForumScannerAgent implements SourceAgent {
  readonly name = 'forum';
  private readonly limit: number;
  private readonly userQuery: string;
  private readonly fetcher: ForumFetcher;
  private readonly lemmyCommunity: string;

  constructor(opts: ForumScannerOptions = {}) {
    this.limit = opts.limit ?? 10;
    this.userQuery = opts.userQuery ?? '';
    this.fetcher = opts.fetcher ?? netFetch;
    this.lemmyCommunity = opts.lemmyCommunity ?? 'football';
  }

  async fetch(): Promise<SourceAgentResult> {
    const [mastodon, lemmy, sportsru] = await Promise.allSettled([
      this.fetchMastodon(),
      this.fetchLemmy(),
      this.fetchSportsRu(),
    ]);

    const groups: TrendingTopic[][] = [];
    if (mastodon.status === 'fulfilled') groups.push(mastodon.value);
    if (lemmy.status === 'fulfilled') groups.push(lemmy.value);
    if (sportsru.status === 'fulfilled') groups.push(sportsru.value);

    // Round-robin, чтобы один активный источник не вытеснил остальные из лимита.
    const topics: TrendingTopic[] = [];
    for (let i = 0; topics.length < this.limit; i++) {
      let added = false;
      for (const group of groups) {
        const topic = group[i];
        if (!topic) continue;
        topics.push(topic);
        added = true;
        if (topics.length >= this.limit) break;
      }
      if (!added) break;
    }

    const errors: string[] = [];
    if (mastodon.status === 'rejected') errors.push(`mastodon: ${errorText(mastodon.reason)}`);
    if (lemmy.status === 'rejected') errors.push(`lemmy: ${errorText(lemmy.reason)}`);
    if (sportsru.status === 'rejected') errors.push(`sports.ru: ${errorText(sportsru.reason)}`);

    return {
      agent: this.name,
      topics,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  private async fetchMastodon(): Promise<TrendingTopic[]> {
    const tags = mastodonTagsForQuery(this.userQuery).slice(0, 4);
    const results = await Promise.allSettled(tags.map((tag) => this.fetchMastodonTag(tag)));
    const topics: TrendingTopic[] = [];
    const errors: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') topics.push(...result.value);
      else errors.push(`#${tags[i]}: ${errorText(result.reason)}`);
    }
    if (topics.length === 0 && errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    return topics.slice(0, 8);
  }

  private async fetchMastodonTag(tag: string): Promise<TrendingTopic[]> {
    const url = `${MASTODON_BASE}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=10`;
    const resp = await this.fetcher(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 10_000,
      label: `mastodon #${tag}`,
    });
    if (!resp.ok) throw new Error(`#${tag} HTTP ${resp.status}`);

    const data: unknown = await resp.json();
    if (!Array.isArray(data)) throw new Error(`#${tag}: неожиданный формат ответа`);

    const topics: TrendingTopic[] = [];
    for (const item of data) {
      if (!isRecord(item)) continue;
      const text = stripHtml(asString(item.content));
      if (text.length < 15) continue;
      const favourites = asNumber(item.favourites_count);
      const boosts = asNumber(item.reblogs_count);
      const replies = asNumber(item.replies_count);
      const urlValue = safeHttpUrl(asString(item.url) || asString(item.uri));
      topics.push({
        title: text.slice(0, 120),
        description: text.slice(0, 200),
        source: `mastodon/#${tag}`,
        ...(urlValue ? { url: urlValue } : {}),
        hypeScore: Math.min(100, Math.round(favourites * 2 + boosts * 4 + replies)),
        hypeReason: `${favourites} favs, ${boosts} boosts, ${replies} replies`,
        rawContent: text,
      });
    }
    return topics;
  }

  private async fetchLemmy(): Promise<TrendingTopic[]> {
    const url =
      `${LEMMY_BASE}/api/v3/post/list?community_name=${encodeURIComponent(this.lemmyCommunity)}` +
      '&sort=Hot&limit=15';
    const resp = await this.fetcher(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 10_000,
      label: `lemmy ${this.lemmyCommunity}`,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data: unknown = await resp.json();
    if (!isRecord(data) || !Array.isArray(data.posts)) {
      throw new Error('неожиданный формат ответа');
    }

    const topics: TrendingTopic[] = [];
    for (const row of data.posts) {
      if (!isRecord(row) || !isRecord(row.post)) continue;
      const post = row.post;
      if (post.nsfw === true || post.deleted === true || post.removed === true) continue;

      const title = clean(asString(post.name), 200);
      if (title.length < 10 || isLemmyMeta(title)) continue;

      const body = stripHtml(asString(post.body));
      const counts = isRecord(row.counts) ? row.counts : {};
      const community = isRecord(row.community) ? row.community : {};
      const communityName = asString(community.name) || this.lemmyCommunity;
      const id = asNumber(post.id);
      const postUrl =
        safeHttpUrl(asString(post.url)) ??
        (id > 0 ? `${LEMMY_BASE}/post/${id}` : undefined);
      const score = asNumber(counts.score);
      const comments = asNumber(counts.comments);

      topics.push({
        title,
        description: body.slice(0, 200),
        source: `lemmy/${communityName}`,
        ...(postUrl ? { url: postUrl } : {}),
        hypeScore: Math.min(100, Math.max(0, Math.round(score + comments * 2))),
        hypeReason: `${score} score, ${comments} comments`,
        rawContent: body || title,
      });
    }
    return topics.slice(0, 8);
  }

  // Sports.ru — топ новостей, фильтр по футбольным ссылкам/категории.
  // HTML-главная теперь Next.js-приложение без article-разметки, поэтому берём RSS.
  private async fetchSportsRu(): Promise<TrendingTopic[]> {
    const resp = await this.fetcher(SPORTSRU_RSS, {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 10_000,
      label: 'sports.ru RSS',
    });
    if (!resp.ok) throw new Error(`sports.ru HTTP ${resp.status}`);

    const xml = await resp.text();
    const parsed = xmlParser.parse(xml) as {
      rss?: { channel?: { item?: Record<string, unknown> | Array<Record<string, unknown>> } };
    };
    const rawItems = parsed.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    const topics: TrendingTopic[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const link = asString(item['link']).trim();
      const category = asString(item['category']).trim();
      const isFootball = link.includes('/football/') || category.toLowerCase() === 'футбол';
      if (!isFootball) continue;

      const title = clean(asString(item['title']).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 200);
      if (title.length < 10 || seen.has(title)) continue;
      seen.add(title);
      const description = stripHtml(asString(item['description']));
      const topicUrl = safeHttpUrl(link);
      topics.push({
        title,
        description: description.slice(0, 200),
        source: 'sports.ru',
        ...(topicUrl ? { url: topicUrl } : {}),
        hypeScore: 0,
        hypeReason: '',
        rawContent: description || title,
      });
      if (topics.length >= 8) break;
    }

    return topics;
  }
}
