// Plain JVM unit-тесты DTO блог-поверхностей: JSON сервера → Kotlin DTO.
// Контракты сверены с web/app/api/blog/** и web/app/api/blogs/**.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

class BlogModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `posts list декодирует tg null ok error`() {
        val payload = """
            {
              "posts": [
                {
                  "id": 1, "news_id": 10, "content": "первый", "verdict": null,
                  "topic": null, "variant": 0, "created_at": "2026-09-01 10:00:00", "blog_id": 5,
                  "blog": {"id": 5, "slug": "main", "name": "Главный"},
                  "tg": null
                },
                {
                  "id": 2, "news_id": null, "content": "второй", "verdict": "{\"verdict\":\"ok\"}",
                  "topic": "тема", "variant": 1, "created_at": "2026-09-02 10:00:00", "blog_id": 5,
                  "blog": {"id": 5, "slug": "main", "name": "Главный"},
                  "tg": {"status": "ok", "messageId": 777, "createdAt": "2026-09-02 11:00:00", "error": null}
                },
                {
                  "id": 3, "news_id": null, "content": "третий", "verdict": null,
                  "topic": null, "variant": 0, "created_at": "2026-09-03 10:00:00", "blog_id": null,
                  "blog": null,
                  "tg": {"status": "error", "messageId": null, "createdAt": "2026-09-03 11:00:00", "error": "chat not found"}
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogPostsResponse>(payload)

        assertEquals(3, dto.posts.size)
        val noTg = dto.posts[0]
        val okTg = dto.posts[1]
        val errTg = dto.posts[2]
        assertNull(noTg.tg)
        assertEquals("main", noTg.blog?.slug)
        assertEquals(10L, noTg.newsId)
        assertEquals("ok", okTg.tg?.status)
        assertEquals(777L, okTg.tg?.messageId)
        assertNull(okTg.tg?.error)
        assertEquals("error", errTg.tg?.status)
        assertEquals("chat not found", errTg.tg?.error)
        assertNull(errTg.blog)
        assertNull(errTg.blogId)
    }

    @Test
    fun `post detail декодирует blog с tgChatId`() {
        val payload = """
            {
              "post": {
                "id": 7, "news_id": null, "content": "текст", "verdict": null,
                "topic": "тема дня", "variant": 2, "created_at": "2026-09-04 12:00:00", "blog_id": 3
              },
              "blog": {"id": 3, "slug": "extra", "name": "Экстра", "tgChatId": "-100123"},
              "tg": null
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogPostResponse>(payload)

        assertEquals(7L, dto.post.id)
        assertEquals("тема дня", dto.post.topic)
        assertEquals(2, dto.post.variant)
        assertEquals("extra", dto.blog?.slug)
        assertEquals("-100123", dto.blog?.tgChatId)
        assertNull(dto.tg)
    }

    @Test
    fun `blogs list декодирует производные флаги`() {
        val payload = """
            {
              "blogs": [
                {
                  "id": 1, "slug": "main", "name": "Главный", "profile": "default",
                  "hasProfile": true, "sourcesCount": 4, "tgChatIdSet": true,
                  "stylePreset": "antonov", "createdAt": "2026-01-01 00:00:00"
                },
                {
                  "id": 2, "slug": "empty", "name": "Пустой", "profile": null,
                  "hasProfile": false, "sourcesCount": 0, "tgChatIdSet": false,
                  "stylePreset": "default", "createdAt": "2026-01-02 00:00:00"
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogsResponse>(payload)

        assertEquals(2, dto.blogs.size)
        val first = dto.blogs[0]
        assertEquals("main", first.slug)
        assertTrue(first.hasProfile)
        assertEquals(4, first.sourcesCount)
        assertTrue(first.tgChatIdSet)
        assertEquals("antonov", first.stylePreset)
        assertFalse(dto.blogs[1].hasProfile)
        assertFalse(dto.blogs[1].tgChatIdSet)
    }

    @Test
    fun `blog detail декодирует промпты и источники`() {
        val payload = """
            {
              "blog": {
                "id": 1, "slug": "main", "name": "Главный", "profile": "default",
                "hasProfile": true, "sourcesCount": 2, "tgChatIdSet": false,
                "tgChatId": null, "stylePreset": "default",
                "systemPrompt": "писать коротко", "contextPrompt": null,
                "sources": ["https://a.ru/rss", "https://b.ru/rss"],
                "createdAt": "2026-01-01 00:00:00"
              }
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogDetailResponse>(payload)

        assertEquals("писать коротко", dto.blog.systemPrompt)
        assertNull(dto.blog.contextPrompt)
        assertEquals(listOf("https://a.ru/rss", "https://b.ru/rss"), dto.blog.sources)
        assertNull(dto.blog.tgChatId)
    }

    @Test
    fun `schedule декодирует schedules и runs`() {
        val payload = """
            {
              "ok": true,
              "blog": {"id": 1, "slug": "main", "name": "Главный"},
              "schedules": [
                {
                  "id": 11, "dayOfWeek": 1, "timeLocal": "09:30", "timezone": "Europe/Moscow",
                  "topic": "утро", "variants": 2, "enabled": true,
                  "createdAt": "2026-01-01 00:00:00", "updatedAt": "2026-01-01 00:00:00"
                }
              ],
              "runs": [
                {
                  "id": 99, "scheduleId": 11, "status": "ok", "attempts": 1,
                  "postId": 55, "message": "ok",
                  "startedAt": "2026-09-01 09:30:00", "finishedAt": "2026-09-01 09:30:05"
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogScheduleResponse>(payload)

        assertTrue(dto.ok)
        assertEquals("main", dto.blog?.slug)
        val slot = dto.schedules.single()
        assertEquals(1, slot.dayOfWeek)
        assertEquals("09:30", slot.timeLocal)
        assertEquals("Europe/Moscow", slot.timezone)
        assertEquals(2, slot.variants)
        assertTrue(slot.enabled)
        val run = dto.runs.single()
        assertEquals("ok", run.status)
        assertEquals(55L, run.postId)
        assertEquals(1, run.attempts)
    }

    @Test
    fun `pipeline декодирует projection с labels history и sandbox`() {
        val payload = """
            {
              "stage": "draft", "step": "Черновик",
              "expectedAction": "Проверить факты",
              "allowed": ["review", "publish"],
              "revisionCount": 2,
              "history": [
                {"stage": "idle", "step": "Старт", "timestamp": "2026-09-01T10:00:00Z", "detail": ""}
              ],
              "labels": {"draft": "Черновик", "review": "Проверка"},
              "sandbox": true
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogPipelineDto>(payload)

        assertEquals("draft", dto.stage)
        assertEquals("Проверить факты", dto.expectedAction)
        assertEquals(listOf("review", "publish"), dto.allowed)
        assertEquals(2, dto.revisionCount)
        assertEquals("idle", dto.history.single().stage)
        assertEquals("Черновик", dto.labels["draft"])
        assertTrue(dto.sandbox)
    }

    @Test
    fun `pipeline без sandbox-флага по умолчанию false`() {
        val payload = """
            {
              "stage": "idle", "step": "Старт", "expectedAction": "Начать",
              "allowed": ["draft"], "revisionCount": 0, "history": [],
              "labels": {}
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogPipelineDto>(payload)

        assertFalse(dto.sandbox)
        assertEquals("draft", dto.allowed.single())
    }

    @Test
    fun `style add 201 ok и 200 duplicated`() {
        val created = json.decodeFromString<AddStyleSampleResponse>("""{"ok":true,"duplicated":false}""")
        val duplicated = json.decodeFromString<AddStyleSampleResponse>("""{"ok":false,"duplicated":true}""")

        assertTrue(created.ok)
        assertFalse(created.duplicated)
        assertFalse(duplicated.ok)
        assertTrue(duplicated.duplicated)
    }

    @Test
    fun `style samples декодируют snake_case`() {
        val payload = """
            {"samples": [{"id": 5, "text": "образец", "created_at": "2026-09-01 10:00:00", "blog_id": 2}]}
        """.trimIndent()

        val dto = json.decodeFromString<StyleSamplesResponse>(payload)

        val sample = dto.samples.single()
        assertEquals(5L, sample.id)
        assertEquals("образец", sample.text)
        assertEquals(2L, sample.blogId)
    }

    @Test
    fun `publish success и failure декодируются`() {
        val ok = json.decodeFromString<PublishPostResponse>("""{"ok":true,"messageId":123}""")
        val rateLimited = json.decodeFromString<PublishPostResponse>(
            """{"ok":false,"error":"слишком часто","errorKind":"rate-limit","retryAfter":30}""",
        )

        assertTrue(ok.ok)
        assertEquals(123L, ok.messageId)
        assertFalse(rateLimited.ok)
        assertEquals("rate-limit", rateLimited.errorKind)
        assertEquals(30L, rateLimited.retryAfter)
    }

    @Test
    fun `generate posts декодирует posts и published`() {
        val payload = """
            {
              "ok": true,
              "posts": [{"id": 21, "variant": 1, "angle": "иронично", "content": "текст"}],
              "published": {"ok": true, "messageId": 321}
            }
        """.trimIndent()

        val dto = json.decodeFromString<GeneratePostsResponse>(payload)

        assertTrue(dto.ok)
        val post = dto.posts.single()
        assertEquals(21L, post.id)
        assertEquals("иронично", post.angle)
        assertTrue(dto.published?.ok == true)
        assertEquals(321L, dto.published?.messageId)
    }

    @Test
    fun `digest декодирует sources и truncated`() {
        val payload = """
            {
              "ok": true, "digest": "текст дайджеста", "newsCount": 12,
              "sources": [{"title": "Новость", "url": "https://a.ru/1"}],
              "truncated": true
            }
        """.trimIndent()

        val dto = json.decodeFromString<DigestResponse>(payload)

        assertTrue(dto.ok)
        assertEquals(12, dto.newsCount)
        assertTrue(dto.truncated)
        assertEquals("https://a.ru/1", dto.sources.single().url)
    }

    @Test
    fun `blog list декодирует status counts и readiness`() {
        val payload = """
            {
              "blogs": [
                {
                  "id": 1, "slug": "main", "name": "Главный", "profile": "default",
                  "hasProfile": true, "sourcesCount": 2, "tgChatIdSet": false,
                  "stylePreset": "default", "status": "active", "archivedAt": null,
                  "counts": {"posts": 4, "news": 5, "styleSamples": 1, "postsLast7Days": 3, "lastPostAt": "2026-11-09"},
                  "lastPostAt": "2026-11-09", "agentPromptsCount": 2, "readyForNews": true,
                  "createdAt": "2026-01-01 00:00:00"
                }
              ],
              "profiles": ["default"]
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogsResponse>(payload)

        val blog = dto.blogs.single()
        assertEquals("active", blog.status)
        assertEquals(4, blog.counts.posts)
        assertEquals(3, blog.counts.postsLast7Days)
        assertEquals(2, blog.agentPromptsCount)
        assertTrue(blog.readyForNews)
        assertNull(blog.archivedAt)
    }

    @Test
    fun `agent prompts декодирует override источник и default`() {
        val payload = """
            {
              "blog": {"slug": "main", "name": "Главный"},
              "prompts": [
                {
                  "agent": "factcheck.verdict", "label": "Фактчекер: вердикт",
                  "description": "Вердикт", "group": "quality",
                  "defaultPrompt": "Ты фактчекер", "prompt": "Строгий",
                  "effectivePrompt": "Строгий", "source": "blog",
                  "isOverridden": true, "updatedAt": "2026-11-10",
                  "maxLength": 8000, "editableScope": "роль"
                },
                {
                  "agent": "digest.weekly", "label": "Дайджест",
                  "prompt": null, "defaultPrompt": "Ты редактор",
                  "effectivePrompt": "Ты редактор", "source": "default",
                  "isOverridden": false, "maxLength": 8000
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogAgentPromptsResponse>(payload)

        assertEquals("main", dto.blog?.slug)
        assertEquals(2, dto.prompts.size)
        assertTrue(dto.prompts[0].isOverridden)
        assertEquals("Строгий", dto.prompts[0].prompt)
        assertFalse(dto.prompts[1].isOverridden)
        assertNull(dto.prompts[1].prompt)
        assertEquals(8000, dto.prompts[1].maxLength)
    }

    @Test
    fun `blog pulse декодирует totals и блоги`() {
        val payload = """
            {
              "generatedAt": "2026-11-10T12:00:00Z",
              "totals": {"blogs": 2, "active": 2, "needsAttention": 1, "posts": 6, "postsLast7Days": 3, "customPrompts": 2},
              "blogs": [
                {"id": 1, "slug": "main", "name": "Главный", "hasProfile": true, "sourcesCount": 1,
                 "readyForNews": true, "counts": {"posts": 4, "postsLast7Days": 3}, "agentPromptsCount": 2}
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<BlogPulseResponse>(payload)

        assertEquals(2, dto.totals.active)
        assertEquals(1, dto.totals.needsAttention)
        assertEquals(3, dto.totals.postsLast7Days)
        assertEquals("main", dto.blogs.single().slug)
        assertTrue(dto.blogs.single().readyForNews)
    }
}
