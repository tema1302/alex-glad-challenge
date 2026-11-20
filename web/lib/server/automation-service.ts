// Адаптер автоматизации (web): тонкая обёртка над общей фабрикой
// createAutomationRunner (#78, см. challenge/src/core/agents/automationRun.ts) —
// конвейер поста, профиль голоса блога и публикация в TG по auto_publish живут
// в ядре. runBlog инжектится в BlogAutomation; getRule связывается лениво
// (singleton создаётся поверх runner'а). Здесь — только сборка зависимостей web.
// Публикация — через publishToTelegram (outbox + человекочитаемые ошибки):
// outbox-запись привязывается к реальному посту (postId), канон
// blog-schedule-service.ts.

import 'server-only';

import { BlogAutomation, createAutomationRunner, dataPath } from './challenge';
import { getBlogDb } from './db';
import { pickLlmClient } from './llm';
import { publishToTelegram } from './tg-publish';

let automation: BlogAutomation | null = null;

export function getAutomation(): BlogAutomation {
  if (!automation) {
    const runner = createAutomationRunner({
      blogDb: getBlogDb(),
      // Лениво: LlmClient() без ключей бросает, а getAutomation() дергают
      // GET-маршруты без LLM — клиент резолвится на прогон (как раньше).
      client: () => pickLlmClient('cloud'),
      getRule: (blogId) => automation?.getRule(blogId) ?? null,
      // Outbox-честность: 'blog' + postId + chat_id канала блога.
      publish: async (content, blog, postId) => {
        const outcome = await publishToTelegram(
          content,
          'blog',
          postId,
          'HTML',
          blog.tg_chat_id ?? undefined,
        );
        return { ok: outcome.ok, messageId: outcome.messageId, error: outcome.error };
      },
    });
    automation = new BlogAutomation(dataPath('automation.sqlite'), {
      runBlog: (blogId) => runner.runBlog(blogId),
      blogExists: (id) => getBlogDb().getBlog(id) !== null,
    });
  }
  return automation;
}
