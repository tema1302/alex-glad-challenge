import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTweetUrl,
  parseFxTweet,
  parseFxAuthor,
  popularityScore,
  discussionScore,
  windowSinceIso,
  rankByPopularity,
  rankByDiscussion,
  authorActivity,
  TWEET_WINDOW_PRESETS,
} from './tweets.js';

// Реальный ответ api.fxtwitter.com по твиту markstats про xG «Челси»/Кайседо.
const FX_TWEET = {
  code: 200,
  message: 'OK',
  tweet: {
    url: 'https://x.com/markrstats/status/2122351771880456203',
    id: '2122351771880456203',
    text: 'Chelsea conceded 1.56 non-penalty xG per game in their first five league games, 13th in the Premier League. In the five since Caicedo came into the starting line-up, they conceded 1.00, 6th. Deep entries allowed fell from 11.8 per game (13th) to 9.4 (5th)',
    author: { screen_name: 'markrstats', name: 'markstats', followers: 63619 },
    created_at: 'Mon Nov 16 15:31:08 +0000 2026',
    created_timestamp: 1794843068,
    replies: 1,
    retweets: 43,
    likes: 236,
    quotes: 23,
    views: 25084,
    bookmarks: 32,
    media: {
      all: [{ type: 'photo', id: '1', url: 'https://pbs.twimg.com/media/HXQbnb6bIAAThhN.jpg?name=orig' }],
      photos: [{ type: 'photo', url: 'https://pbs.twimg.com/media/HXQbnb6bIAAThhN.jpg?name=orig' }],
    },
  },
};

test('parseTweetUrl: x.com URL с query/хвостом', () => {
  assert.deepEqual(parseTweetUrl('https://x.com/markrstats/status/2122351771880456203?a=Zz&s=19'), {
    handle: 'markrstats',
    id: '2122351771880456203',
  });
});

test('parseTweetUrl: twitter.com и голый ID', () => {
  assert.deepEqual(parseTweetUrl('https://twitter.com/markrstats/status/2122351771880456203'), {
    handle: 'markrstats',
    id: '2122351771880456203',
  });
  assert.deepEqual(parseTweetUrl('2122351771880456203'), { handle: null, id: '2122351771880456203' });
});

test('parseTweetUrl: не-твит → null', () => {
  assert.equal(parseTweetUrl('https://x.com/markrstats'), null);
  assert.equal(parseTweetUrl('https://example.com/status/12345'), null);
  assert.equal(parseTweetUrl('просто текст'), null);
  assert.equal(parseTweetUrl(''), null);
});

test('parseFxTweet: реальный твит markstats → все поля', () => {
  const t = parseFxTweet(FX_TWEET)!;
  assert.ok(t);
  assert.equal(t.tweetId, '2122351771880456203');
  assert.equal(t.authorHandle, 'markrstats');
  assert.equal(t.authorName, 'markstats');
  assert.equal(t.likes, 236);
  assert.equal(t.retweets, 43);
  assert.equal(t.quotes, 23);
  assert.equal(t.views, 25084);
  assert.equal(t.bookmarks, 32);
  assert.equal(t.publishedAt, new Date(1794843068 * 1000).toISOString());
  assert.equal(t.media.length, 1);
  assert.equal(t.media[0].type, 'photo');
  assert.ok(t.text.includes('Caicedo'));
});

test('parseFxTweet: нет id/текста/даты → null; control-символы вырезаются', () => {
  assert.equal(parseFxTweet({ code: 200, tweet: { text: 'x' } }), null);
  assert.equal(parseFxTweet({ code: 200, tweet: { id: '1', text: 'x' } }), null);
  assert.equal(parseFxTweet(null), null);
  const dirty = {
    code: 200,
    tweet: { id: '12345', text: '  гол\u0000ой текст  ', created_timestamp: 1794843068, author: { screen_name: 'a' } },
  };
  assert.equal(parseFxTweet(dirty)!.text, 'голой текст');
});

test('parseFxAuthor: профиль → автор', () => {
  const a = parseFxAuthor({ code: 200, user: { screen_name: 'markrstats', name: 'markstats', description: 'football data', followers: 63619 } })!;
  assert.equal(a.handle, 'markrstats');
  assert.equal(a.followers, 63619);
  assert.equal(parseFxAuthor({ code: 200 }), null);
});

test('popularityScore/discussionScore: взвешенный engagement', () => {
  const e = { likes: 236, retweets: 43, replies: 1, quotes: 23, views: 25084, bookmarks: 32 };
  // 236 + 3*43 + 3*23 + 2*1 + 2*32 + floor(25084/100) = 236+129+69+2+64+250 = 750
  assert.equal(popularityScore(e), 750);
  assert.equal(discussionScore(e), 2 * 1 + 3 * 23);
});

test('windowSinceIso: пресеты и custom; невалидное окно → RangeError', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  assert.deepEqual(TWEET_WINDOW_PRESETS, [1, 3, 7, 30]);
  assert.equal(windowSinceIso(1, now), '2026-11-16T00:00:00.000Z');
  assert.equal(windowSinceIso(7, now), '2026-11-10T00:00:00.000Z');
  assert.equal(windowSinceIso(30, now), '2026-10-18T00:00:00.000Z');
  assert.equal(windowSinceIso(14, now), '2026-11-03T00:00:00.000Z'); // custom
  assert.throws(() => windowSinceIso(0, now), RangeError);
  assert.throws(() => windowSinceIso(-3, now), RangeError);
  assert.throws(() => windowSinceIso(Number.NaN, now), RangeError);
});

const ROWS = [
  { author_handle: 'a', likes: 10, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 },
  { author_handle: 'b', likes: 5, retweets: 10, replies: 5, quotes: 5, views: 1000, bookmarks: 0 },
  { author_handle: 'a', likes: 1, retweets: 0, replies: 20, quotes: 0, views: 0, bookmarks: 0 },
];

test('rankByPopularity: убыв., не мутирует вход', () => {
  const ranked = rankByPopularity(ROWS);
  assert.equal(ranked[0].author_handle, 'b'); // 5+30+15+10+10=70
  assert.equal(ranked[0].popularity, 70);
  assert.equal(ROWS[0].likes, 10);
  assert.ok(!('popularity' in ROWS[0]));
});

test('rankByDiscussion: ответы/цитаты важнее лайков', () => {
  const ranked = rankByDiscussion(ROWS);
  assert.equal(ranked[0].author_handle, 'a'); // 3-я строка: 2*20=40
  assert.equal(ranked[0].discussion, 40);
});

test('authorActivity: кол-во твитов в окне, ties по популярности', () => {
  const act = authorActivity(ROWS);
  assert.equal(act[0].handle, 'a');
  assert.equal(act[0].count, 2);
  assert.equal(act[1].handle, 'b');
  assert.equal(act[1].count, 1);
});