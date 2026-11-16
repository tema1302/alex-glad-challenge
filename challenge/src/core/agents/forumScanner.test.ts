import test from 'node:test';
import assert from 'node:assert/strict';

import { ForumScannerAgent, mastodonTagsForQuery, type ForumFetcher } from './forumScanner.js';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const MASTODON = [
  {
    content: '<p>Челси обыграл АПЛ-лидера: разбор xG и формы</p>',
    url: 'https://mastodon.social/@football/1',
    favourites_count: 12,
    reblogs_count: 3,
    replies_count: 2,
  },
  {
    content: '<p>коротко</p>',
    url: 'https://mastodon.social/@football/2',
    favourites_count: 1,
    reblogs_count: 0,
    replies_count: 0,
  },
];

const LEMMY = {
  posts: [
    {
      post: {
        id: 42,
        name: 'Chelsea advanced stats: xG, xGA and pressing',
        body: '<p>Разбор продвинутой статистики Челси.</p>',
        url: 'https://example.com/chelsea-stats',
      },
      counts: { score: 31, comments: 8 },
      community: { name: 'football' },
    },
    {
      post: {
        id: 43,
        name: 'NSFW post',
        nsfw: true,
      },
      counts: { score: 100, comments: 100 },
      community: { name: 'football' },
    },
    {
      post: {
        id: 44,
        name: '[Announcement] Community migration to football@lemm.ee',
      },
      counts: { score: 100, comments: 50 },
      community: { name: 'football' },
    },
  ],
};

const SPORTSRU = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Челси объявил о трансфере полузащитника</title>
    <link>https://www.sports.ru/football/1117438540-chelsea-transfer.html</link>
    <category>Футбол</category>
    <description>Лондонский клуб усилился перед АПЛ.</description>
  </item>
  <item>
    <title>Хоккейный клуб продлил контракт</title>
    <link>https://www.sports.ru/hockey/1117438526-hockey.html</link>
    <category>Хоккей</category>
  </item>
</channel></rss>`;

test('mastodonTagsForQuery: АПЛ и Челси → профильные хештеги', () => {
  const tags = mastodonTagsForQuery('Футбольные новости мужского футбола АПЛ и Челси');
  assert.ok(tags.includes('chelsea'));
  assert.ok(tags.includes('premierleague'));
  assert.ok(tags.length <= 4);
});

test('mastodonTagsForQuery: статистика Челси → footballstats', () => {
  const tags = mastodonTagsForQuery('Продвинутая статистика по Челси');
  assert.ok(tags.includes('chelsea'));
  assert.ok(tags.includes('footballstats'));
});

test('mastodonTagsForQuery: без совпадений → football/soccer fallback', () => {
  assert.deepEqual(mastodonTagsForQuery('новости'), ['football', 'soccer']);
});

test('forumScanner: Mastodon + Lemmy + Sports.ru, Reddit не вызывается', async () => {
  const calls: string[] = [];
  const fetcher: ForumFetcher = async (url) => {
    calls.push(url);
    if (url.includes('mastodon.social')) return jsonResponse(MASTODON);
    if (url.includes('lemmy.world')) return jsonResponse(LEMMY);
    if (url.includes('sports.ru')) return new Response(SPORTSRU, { status: 200 });
    return new Response('not found', { status: 404 });
  };

  const agent = new ForumScannerAgent({
    limit: 10,
    userQuery: 'Футбольные новости мужского футбола АПЛ и Челси',
    fetcher,
  });
  const result = await agent.fetch();

  assert.equal(result.error, undefined);
  const sources = new Set(result.topics.map((t) => t.source));
  assert.ok([...sources].some((s) => s.startsWith('mastodon/#chelsea')));
  assert.ok(sources.has('lemmy/football'));
  assert.ok(sources.has('sports.ru'));
  assert.ok(result.topics.some((t) => t.title.includes('xG')));
  assert.ok(!result.topics.some((t) => t.title.includes('[Announcement]')));
  assert.ok(calls.every((u) => !u.includes('reddit')));
  assert.ok(calls.some((u) => u.includes('/timelines/tag/chelsea')));
  assert.ok(calls.some((u) => u.includes('community_name=football')));
});

test('forumScanner: ошибка Mastodon не валит Lemmy и Sports.ru', async () => {
  const fetcher: ForumFetcher = async (url) => {
    if (url.includes('mastodon.social')) throw new Error('mastodon down');
    if (url.includes('lemmy.world')) return jsonResponse(LEMMY);
    if (url.includes('sports.ru')) return new Response(SPORTSRU, { status: 200 });
    return new Response('not found', { status: 404 });
  };

  const result = await new ForumScannerAgent({ fetcher, userQuery: 'Челси' }).fetch();

  assert.ok(result.topics.some((t) => t.source === 'lemmy/football'));
  assert.match(result.error ?? '', /mastodon:.*mastodon down/);
});

test('forumScanner: все источники упали → topics пуст, error содержит все причины', async () => {
  const fetcher: ForumFetcher = async (url) => {
    throw new Error(url.includes('mastodon') ? 'mastodon down' : url.includes('lemmy') ? 'lemmy down' : 'sports down');
  };
  const result = await new ForumScannerAgent({ fetcher, userQuery: 'Челси' }).fetch();

  assert.equal(result.topics.length, 0);
  assert.match(result.error ?? '', /mastodon/);
  assert.match(result.error ?? '', /lemmy/);
  assert.match(result.error ?? '', /sports\.ru/);
});
