// Авто-черновики блога — «утренний редактор» (уровень 2 автоматизации).
// Задача планировщика Windows (BlogAutoDrafts, ежедневно 07:00) запускает
// scripts/run-auto-drafts.cmd → этот скрипт: N раз прогоняет СТАНДАРТНЫЙ
// блог-pipeline (RSS → агент-1 топ новостей → агент-2 пост голосом канала
// «Иди на факты глянь» → агент-3 фактчекинг; тот же runNewsPipeline, что у
// кнопки /blog/news). Посты падают в очередь /blog/posts (верху списка по
// created_at), владелец вычитывает и отправляет вручную — автоотправка
// в канал сознательно не делается.
//
// Дедуп между запусками бесплатный: агент-1 выбирает только неиспользованные
// новости (news.used), дубли фидов режутся UNIQUE по URL; темы кончились —
// прогон честно завершается «новых тем нет».
//
// Запуск вручную (из web/):
//   NODE_OPTIONS=--conditions=react-server ../challenge/node_modules/.bin/tsx scripts/auto-drafts.ts \
//     [--posts 2] [--hours 36] [--topK 8] [--llm cloud|local] [--style] [--dry-run]
//   --conditions=react-server нейтрализует 'server-only' (нужен только для
//   --style: промпт Антоновайзера живёт в web/lib/server/style-prompt.ts —
//   единственный источник, копии не плодим).
//   --style: опциональный доп. проход «переписать в стиле auantonov» (пост для
//   ДРУГОГО канала). По умолчанию выключен: pipeline уже пишет голосом профиля,
//   лишний рерайт = лишний риск для фактов.
//   --dry-run: RSS-фетч + выбор тем БЕЗ написания постов (проверка кормовой базы).
import { BlogDb } from '@challenge/core/db';
import { dataPath } from '@challenge/core/paths';
import { loadEnvUpward } from '@challenge/core/env';
import { LlmClient } from '@challenge/core/client';
import { makeLocalLlmClient } from '@challenge/core/rag/llm';
import { ProfileManager } from '@challenge/core/profile';
import { runNewsPipeline } from '@challenge/core/agents/pipeline';
import { fetchAllFeedsDetailed, filterRecent, toNewsRow } from '@challenge/core/agents/rss';
import { NewsFetcher } from '@challenge/core/agents/newsFetcher';
import { clean } from '@challenge/core/sanitize';
import { msg } from '@challenge/core/types';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'style' || key === 'dry-run') {
      out[key] = true;
    } else {
      out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      if (out[key] !== 'true') i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  loadEnvUpward();
  const args = parseArgs(process.argv.slice(2));
  const postsWanted = Number(args.posts ?? 2) || 2;
  const hours = Number(args.hours ?? 36) || 36;
  const topK = Number(args.topK ?? 8) || 8;
  const llm = args.llm === 'local' ? 'local' : 'cloud';
  const stylePass = args.style === true;
  const dryRun = args['dry-run'] === true;

  console.log(
    `[auto-drafts] старт ${new Date().toISOString()} · постов: ${postsWanted} · окно: ${hours}ч · llm: ${llm}${stylePass ? ' · +стиль auantonov' : ''}${dryRun ? ' · DRY-RUN' : ''}`,
  );

  const db = new BlogDb(dataPath('blog.sqlite'));
  const client = llm === 'local' ? makeLocalLlmClient() : new LlmClient();

  // Профиль — зеркало /api/blog/news: default | первый | создать default.
  const profile = new ProfileManager(dataPath('profiles'));
  const names = profile.list();
  if (names.length > 0) {
    profile.load(names.includes('default') ? 'default' : names[0]);
  } else {
    profile.create('default');
  }

  if (dryRun) {
    // Те же шаги 0–1, что в runNewsPipeline, но без написания поста.
    const { items, errors } = await fetchAllFeedsDetailed();
    let added = 0;
    for (const item of filterRecent(items, hours)) {
      if (db.insertNews(toNewsRow(item))) added++;
    }
    console.log(`[auto-drafts] RSS: получено ${items.length}, новых в БД ${added}${errors.length ? `, ошибки: ${errors.join('; ')}` : ''}`);
    const ranked = await new NewsFetcher(client).fetch(db, { maxAgeHours: hours, topK });
    console.log(`[auto-drafts] Кандидатов в окне ${hours}ч: ${ranked.rawCount}, топ выбран: ${ranked.ranked.length}`);
    for (const r of ranked.ranked) {
      console.log(`  · (${r.score}) ${r.news.title} — ${r.why}`);
    }
    console.log('[auto-drafts] dry-run завершён, посты не писались.');
    return;
  }

  const created: Array<{ id: number; title: string; len: number; verdict: string }> = [];
  const failed: string[] = [];

  for (let i = 1; i <= postsWanted; i++) {
    try {
      const r = await runNewsPipeline(db, client, { maxAgeHours: hours, topK, profile });
      if (!r.post) {
        console.log(`[auto-drafts] прогон ${i}: неиспользованных тем в окне ${hours}ч нет — стоп.`);
        break;
      }
      const id = db.recentPosts(1)[0]?.id ?? 0;
      let content = r.post.content;

      if (stylePass && id > 0) {
        const { STYLE_SYSTEM_PROMPT, buildStyleUserPrompt } = await import(
          '../lib/server/style-prompt.js'
        );
        const raw = await client.chat(
          [msg.system(STYLE_SYSTEM_PROMPT), msg.user(buildStyleUserPrompt({ text: content, mode: 'normal', format: 'post', signature: false, llm }))],
          { temperature: 0.8, maxTokens: 3000 },
        );
        const rewritten = clean(raw, 8000).trim();
        if (rewritten.length > 0) {
          content = rewritten;
          db.updatePostContent(id, content);
        }
      }

      const title = r.news.ranked[0]?.news.title ?? '?';
      const verdict = r.factCheck?.verdict ?? '—';
      created.push({ id, title, len: content.length, verdict });
      console.log(`[auto-drafts] прогон ${i}: пост #${id} · фактчек: ${verdict} · ${content.length} зн. · тема: «${title}»`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push(message);
      console.error(`[auto-drafts] прогон ${i} упал: ${message}`);
    }
  }

  console.log(`[auto-drafts] готово: ${created.length} из ${postsWanted} · посты #${created.map((c) => c.id).join(', #') || '—'} ждут вычитки в /blog/posts`);
  if (created.length === 0 && failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[auto-drafts] фатально:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
