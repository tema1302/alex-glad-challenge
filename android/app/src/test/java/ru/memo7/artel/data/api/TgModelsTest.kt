// Plain JVM unit-тесты DTO Telegram-поверхностей (#145): decode top (snake_case +
// map реакций), history (nullable blog_post_id/message_id/error), publish-ошибка
// с errorKind/retryAfter и успех publish. Без сети — только строки payload'ов.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

class TgModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `top decode держит snake_case и map реакций`() {
        val payload = """
            {
              "messages": [
                {
                  "msg_id": 4523,
                  "from_name": "Григорий",
                  "text": "Эволюция — это про людей",
                  "date_iso": "2026-09-01T10:15:00.000Z",
                  "reaction_total": 7,
                  "reactions": {"❤️": 5, "🔥": 2}
                },
                {
                  "msg_id": 4524,
                  "from_name": "Анна",
                  "text": "без реакций",
                  "date_iso": "2026-09-01T11:00:00.000Z",
                  "reaction_total": 0,
                  "reactions": {}
                }
              ],
              "count": 5600,
              "chatKey": "-1001508192874",
              "topicId": 5,
              "by": "reactions"
            }
        """.trimIndent()

        val dto = json.decodeFromString<TgTopResponse>(payload)

        assertEquals(2, dto.messages.size)
        val first = dto.messages[0]
        assertEquals(4523L, first.msg_id)
        assertEquals("Григорий", first.from_name)
        assertEquals("2026-09-01T10:15:00.000Z", first.date_iso)
        assertEquals(7, first.reaction_total)
        assertEquals(mapOf("❤️" to 5, "🔥" to 2), first.reactions)
        assertEquals(0, dto.messages[1].reaction_total)
        assertEquals(emptyMap<String, Int>(), dto.messages[1].reactions)
        assertEquals(5600, dto.count)
        assertEquals("-1001508192874", dto.chatKey)
        assertEquals(5, dto.topicId)
        assertEquals("reactions", dto.by)
    }

    @Test
    fun `history decode держит null blog_post_id message_id error`() {
        val payload = """
            {
              "ok": true,
              "items": [
                {
                  "id": 10,
                  "text": "Пост дня",
                  "source": "manual",
                  "blog_post_id": null,
                  "message_id": 321,
                  "status": "ok",
                  "error": null,
                  "created_at": "2026-09-02T09:00:00.000Z"
                },
                {
                  "id": 11,
                  "text": "Не отправился",
                  "source": "blog",
                  "blog_post_id": 77,
                  "message_id": null,
                  "status": "error",
                  "error": "chat not found",
                  "created_at": "2026-09-02T10:00:00.000Z"
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<TelegramHistoryResponse>(payload)

        assertEquals(2, dto.items.size)
        val okItem = dto.items[0]
        assertNull(okItem.blogPostId)
        assertEquals(321L, okItem.messageId)
        assertEquals("ok", okItem.status)
        assertNull(okItem.error)
        assertEquals("2026-09-02T09:00:00.000Z", okItem.createdAt)
        val errorItem = dto.items[1]
        assertEquals(77L, errorItem.blogPostId)
        assertNull(errorItem.messageId)
        assertEquals("error", errorItem.status)
        assertEquals("chat not found", errorItem.error)
    }

    @Test
    fun `publish error decode держит errorKind и retryAfter`() {
        val payload = """{"ok":false,"error":"Слишком много отправок. Подождите 42 с","errorKind":"rate-limit","retryAfter":42}"""

        val dto = json.decodeFromString<TelegramPublishError>(payload)

        assertEquals("rate-limit", dto.errorKind)
        assertEquals(42, dto.retryAfter)
        assertEquals("Слишком много отправок. Подождите 42 с", dto.error)
    }

    @Test
    fun `publish success decode держит messageId`() {
        val dto = json.decodeFromString<TelegramPublishResponse>("""{"ok":true,"messageId":456}""")

        assertEquals(456L, dto.messageId)
    }

    @Test
    fun `evolute request encode не тащит null поля`() {
        val encoded = json.encodeToString(
            EvoluteAgentRequest.serializer(),
            EvoluteAgentRequest(query = "что такое эволюция?"),
        )

        assertEquals("""{"query":"что такое эволюция?"}""", encoded)
    }
}
