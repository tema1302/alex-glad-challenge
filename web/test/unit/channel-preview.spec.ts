// Парсер и кэш «Свежее в канале»: фикстурная разметка t.me/s, деградация без
// сети, TTL кэшей. Сеть в тестах не трогается — fetcher инъектится.
import { describe, expect, it, vi } from 'vitest';
import {
  createChannelPreview,
  messageHtmlToText,
  parseChannelHtml,
} from '../../lib/server/channel-preview';

// Фрагмент, воспроизводящий структуру https://t.me/s/<channel>:
// блоки сообщений с data-post, datetime, tgme_widget_message_text.
function msg(id: number, iso: string, textHtml: string): string {
  return `
  <div class="tgme_widget_message ..." data-post="artemiyartel/${id}" id="-1">
    <time datetime="${iso}"></time>
    <div class="tgme_widget_message_bubble">
      <div class="tgme_widget_message_text js-message_text" dir="auto">${textHtml}</div>
      <a class="tgme_widget_message_date" href="https://t.me/artemiyartel/${id}"></a>
    </div>
  </div>`;
}

const FIXTURE = `<html><body>
  ${msg(101, '2026-09-10T09:15:00+00:00', 'Радар: <b>локальная LLM</b> на minimizing&nbsp;costs. Часть 1.')}
  ${msg(102, '2026-09-10T12:40:00+00:00', 'Чек-лист по промпт-инъекциям:<br/>1) валидация<br/>2) санитайз')}
  ${msg(103, '2026-09-11T08:00:00+00:00', '')}
  <div class="tgme_widget_message" data-post="artemiyartel/104"><time datetime="2026-09-11T10:00:00+00:00"></time></div>
</body></html>`;

describe('messageHtmlToText', () => {
  it('снимает теги и превращает <br> в переносы', () => {
    expect(messageHtmlToText('Чек-лист:<br/>1) валидация<br/>2) санитайз')).toBe(
      'Чек-лист:\n1) валидация\n2) санитайз',
    );
  });

  it('декодирует HTML-энтити, включая &nbsp;', () => {
    expect(messageHtmlToText('A&nbsp;B &amp; C &lt;tag&gt;')).toBe('A B & C <tag>');
  });

  it('схлопывает лишние пробелы и пустые переносы', () => {
    expect(messageHtmlToText('  раз    два  ')).toBe('раз два');
    expect(messageHtmlToText('а<br/><br/><br/>б')).toBe('а\nб');
  });
});

describe('parseChannelHtml', () => {
  it('достаёт текст, дату и прямую ссылку на пост; новые первыми', () => {
    const posts = parseChannelHtml(FIXTURE, '@artemiyartel');
    // Текст есть только у 101 и 102 (103 — пустой, 104 — без текстового div).
    expect(posts.map((p) => p.id)).toEqual([102, 101]);
  });

  it('пост без текста и блок без текстового div пропускаются', () => {
    const posts = parseChannelHtml(FIXTURE, '@artemiyartel');
    const texts = posts.map((p) => p.text);
    expect(texts.every((t) => t.length > 0)).toBe(true);
    // id 103 (пустой текст) и 104 (нет tgme_widget_message_text) не попали
    expect(posts.find((p) => p.id === 103)).toBeUndefined();
    expect(posts.find((p) => p.id === 104)).toBeUndefined();
  });

  it('в тексте поста нет HTML-мусора, ссылка собирается из имени канала', () => {
    const posts = parseChannelHtml(FIXTURE, '@artemiyartel', 10);
    const p = posts.find((x) => x.id === 101)!;
    expect(p.text).not.toMatch(/<[^>]+>/);
    expect(p.text).toContain('локальная LLM');
    expect(p.url).toBe('https://t.me/artemiyartel/101');
    expect(p.dateIso).toBe('2026-09-10T09:15:00+00:00');
  });

  it('limit обрезает список; пустой HTML → пустой список', () => {
    expect(parseChannelHtml(FIXTURE, 'artemiyartel', 1)).toHaveLength(1);
    expect(parseChannelHtml('', 'artemiyartel', 4)).toEqual([]);
    expect(parseChannelHtml('<html></html>', 'artemiyartel', 4)).toEqual([]);
  });
});

describe('createChannelPreview — кэш и деградация', () => {
  it('успех кэшируется: fetcher вызывается один раз в пределах TTL', async () => {
    let nowMs = 0;
    const fetcher = vi.fn().mockResolvedValue(FIXTURE);
    const get = createChannelPreview('@artemiyartel', {
      fetcher,
      now: () => nowMs,
      okTtlMs: 600,
      failTtlMs: 100,
    });

    const first = await get();
    expect(first.ok).toBe(true);
    nowMs = 500;
    const second = await get();
    expect(second.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    nowMs = 601; // TTL истёк — снова в сеть
    await get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('сеть легла → ok:false, а не исключение', async () => {
    const get = createChannelPreview('@artemiyartel', {
      fetcher: vi.fn().mockRejectedValue(new Error('сеть недоступна')),
      now: () => 0,
    });
    const r = await get();
    expect(r).toEqual({ ok: false });
  });

  it('неудача не ретраится каждый рендер: failTtlMs держит отрицательный кэш', async () => {
    let nowMs = 0;
    const fetcher = vi.fn().mockRejectedValue(new Error('down'));
    const get = createChannelPreview('@artemiyartel', {
      fetcher,
      now: () => nowMs,
      okTtlMs: 600,
      failTtlMs: 300,
    });
    await get();
    await get();
    await get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    nowMs = 301;
    await get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('разметка без текстовых постов считается неудачей (нечего показывать)', async () => {
    const get = createChannelPreview('@artemiyartel', {
      fetcher: vi.fn().mockResolvedValue('<html><body>unsupported</body></html>'),
      now: () => 0,
    });
    expect(await get()).toEqual({ ok: false });
  });
});
