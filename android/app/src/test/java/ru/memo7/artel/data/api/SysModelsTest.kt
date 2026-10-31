package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/**
 * Plain JVM unit-тест контрактов sys-поверхностей (#148): briefing (stats + topTg
 * snake_case), admin servers (под-объекты, null provider/model), summary publish
 * (тело HTTP-ошибки 429 с errorKind/retryAfter). Без сети — только decode/encode.
 */
class SysModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `briefing decodes full stats and topTg snake_case`() {
        val payload = """
            {
              "todoSummary": "Пост №7: набросок\nПост №8: идея",
              "stats": {
                "news": 3,
                "posts": 7,
                "ragFixed": 11,
                "ragStructure": 5,
                "ragTelegram": 13,
                "tgMessages": 42,
                "tgChats": 4,
                "tgTopics": 2,
                "dialogChats": 6,
                "dialogMessages": 17
              },
              "topTg": [
                {
                  "msg_id": 1001,
                  "from_name": "Анна",
                  "text": "Отличный пост!",
                  "date_iso": "2026-09-08T10:15:00.000Z",
                  "reaction_total": 12
                }
              ],
              "chatKey": "chat:-100123:5",
              "topicId": 5
            }
        """.trimIndent()

        val dto = json.decodeFromString<BriefingResponse>(payload)

        assertEquals("Пост №7: набросок\nПост №8: идея", dto.todoSummary)
        assertEquals(3, dto.stats.news)
        assertEquals(7, dto.stats.posts)
        assertEquals(11, dto.stats.ragFixed)
        assertEquals(5, dto.stats.ragStructure)
        assertEquals(13, dto.stats.ragTelegram)
        assertEquals(42, dto.stats.tgMessages)
        assertEquals(4, dto.stats.tgChats)
        assertEquals(2, dto.stats.tgTopics)
        assertEquals(6, dto.stats.dialogChats)
        assertEquals(17, dto.stats.dialogMessages)
        val top = dto.topTg!!.single()
        assertEquals(1001L, top.msgId)
        assertEquals("Анна", top.fromName)
        assertEquals("Отличный пост!", top.text)
        assertEquals("2026-09-08T10:15:00.000Z", top.dateIso)
        assertEquals(12, top.reactionTotal)
        assertEquals("chat:-100123:5", dto.chatKey)
        assertEquals(5, dto.topicId)
    }

    @Test
    fun `briefing without topTg keeps it null and defaults topicId`() {
        val payload = """
            {
              "todoSummary": "Всё сделано",
              "stats": {
                "news": 0,
                "posts": 0,
                "ragFixed": 0,
                "ragStructure": 0,
                "ragTelegram": 0,
                "tgMessages": 0,
                "tgChats": 0,
                "tgTopics": 0,
                "dialogChats": 0,
                "dialogMessages": 0
              },
              "chatKey": null,
              "topicId": 1
            }
        """.trimIndent()

        val dto = json.decodeFromString<BriefingResponse>(payload)

        assertNull("topTg без chatKey обязан отсутствовать (null)", dto.topTg)
        assertNull(dto.chatKey)
        assertEquals(1, dto.topicId)
    }

    @Test
    fun `admin servers decodes all sub-objects with null provider and model`() {
        val payload = """
            {
              "mcp": { "configured": true, "host": "http://127.0.0.1:8765", "authConfigured": false },
              "cloud": { "configured": false, "provider": null, "model": null },
              "local": { "configured": true, "model": "qwen2.5:7b" },
              "embed": { "configured": false },
              "mtproto": { "configured": false },
              "botApi": { "configured": true, "channelLabel": "-100…7890" },
              "activeModel": "qwen2.5:7b",
              "activeProvider": null
            }
        """.trimIndent()

        val dto = json.decodeFromString<AdminServersResponse>(payload)

        assertTrue(dto.mcp.configured)
        assertEquals("http://127.0.0.1:8765", dto.mcp.host)
        assertFalse(dto.mcp.authConfigured)
        assertFalse(dto.cloud.configured)
        assertNull("provider нерасконфигурированного cloud — null", dto.cloud.provider)
        assertNull("model нерасконфигурированного cloud — null", dto.cloud.model)
        assertTrue(dto.local.configured)
        assertEquals("qwen2.5:7b", dto.local.model)
        assertNull("provider у local не задан — null", dto.local.provider)
        assertFalse(dto.embed.configured)
        assertNull(dto.embed.model)
        assertFalse(dto.mtproto.configured)
        assertNull(dto.mtproto.provider)
        assertTrue(dto.botApi.configured)
        assertEquals("-100…7890", dto.botApi.channelLabel)
        assertEquals("qwen2.5:7b", dto.activeModel)
        assertNull(dto.activeProvider)
    }

    @Test
    fun `summary publish error 429 decodes errorKind and retryAfter`() {
        val payload = """
            {
              "ok": false,
              "error": "Telegram просит подождать 30 с перед повтором",
              "errorKind": "rate-limit",
              "retryAfter": 30
            }
        """.trimIndent()

        val dto = json.decodeFromString<SummaryPublishResponse>(payload)

        assertFalse(dto.ok)
        assertEquals("rate-limit", dto.errorKind)
        assertEquals(30, dto.retryAfter)
        assertNull("у ошибки нет messageId", dto.messageId)
        assertEquals("Telegram просит подождать 30 с перед повтором", dto.error)
    }

    @Test
    fun `summary publish success decodes messageId without errorKind`() {
        val payload = """{ "ok": true, "messageId": 777 }"""

        val dto = json.decodeFromString<SummaryPublishResponse>(payload)

        assertTrue(dto.ok)
        assertEquals(777L, dto.messageId)
        assertNull(dto.errorKind)
        assertNull(dto.retryAfter)
    }

    @Test
    fun `summary publish request encodes only publish true`() {
        val encoded = json.encodeToString(SummaryPublishRequest.serializer(), SummaryPublishRequest(true))

        assertEquals("""{"publish":true}""", encoded)
    }

    @Test
    fun `agent request without llm omits the field`() {
        val encoded = json.encodeToString(AgentRequest.serializer(), AgentRequest("привет"))

        assertEquals("""{"prompt":"привет"}""", encoded)
    }
}
