// Plain JVM unit-тесты DTO конвейера RAG: декодирование серверных ответов
// /api/rag/* (snake_case DialogDb-чатов, aliases без topicId, notes, done с sources+quotes).
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

class RagModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `chats response decodes snake_case dialog chats`() {
        val payload = """
            {
              "titles": {"-1001": "Артель | чат"},
              "aliases": [{"name": "артель", "chatKey": "-1001", "topicId": 7}],
              "chats": [
                {
                  "id": "abc-123",
                  "title": "Разбор требований",
                  "created_at": "2026-09-01 10:00:00",
                  "updated_at": "2026-09-02 12:00:00",
                  "msg_count": 4
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString(RagChatsResponse.serializer(), payload)

        assertEquals(mapOf("-1001" to "Артель | чат"), dto.titles)
        assertEquals(RagAliasDto("артель", "-1001", 7), dto.aliases.single())
        val chat = dto.chats.single()
        assertEquals("abc-123", chat.id)
        assertEquals("Разбор требований", chat.title)
        assertEquals("2026-09-01 10:00:00", chat.createdAt)
        assertEquals("2026-09-02 12:00:00", chat.updatedAt)
        assertEquals(4, chat.msgCount)
    }

    @Test
    fun `alias without topicId decodes as null`() {
        val payload = """
            {
              "titles": {},
              "aliases": [{"name": "весь чат", "chatKey": "-1001"}],
              "chats": []
            }
        """.trimIndent()

        val dto = json.decodeFromString(RagChatsResponse.serializer(), payload)

        assertNull(dto.aliases.single().topicId)
        assertEquals("-1001", dto.aliases.single().chatKey)
    }

    @Test
    fun `chat detail decodes messages and taskStateText`() {
        val payload = """
            {
              "chat": {
                "id": "abc-123",
                "title": "Разбор",
                "created_at": "2026-09-01 10:00:00",
                "updated_at": "2026-09-02 12:00:00",
                "msg_count": 2
              },
              "messages": [
                {"id": 1, "chatId": "abc-123", "role": "user", "content": "привет", "ts": "2026-09-01 10:00:01"},
                {"id": 2, "chatId": "abc-123", "role": "assistant", "content": "ответ", "ts": "2026-09-01 10:00:09"}
              ],
              "taskStateText": "Задача: разобрать требования"
            }
        """.trimIndent()

        val dto = json.decodeFromString(RagChatDetailResponse.serializer(), payload)

        assertEquals("abc-123", dto.chat.id)
        assertEquals(2, dto.messages.size)
        assertEquals(1L, dto.messages[0].id)
        assertEquals("assistant", dto.messages[1].role)
        assertEquals("Задача: разобрать требования", dto.taskStateText)
    }

    @Test
    fun `notes response decodes partitions and notes`() {
        val payload = """
            {
              "ok": true,
              "partitions": {"fixed": 3, "structure": 5, "telegram": 120, "notes": 2, "docs": 0, "faq": 0},
              "notes": [{"source": "note://a", "title": "А", "chunks": 2}]
            }
        """.trimIndent()

        val dto = json.decodeFromString(RagNotesResponse.serializer(), payload)

        assertEquals(3, dto.partitions.fixed)
        assertEquals(120, dto.partitions.telegram)
        assertEquals(RagNoteDto("note://a", "А", 2), dto.notes.single())
    }

    @Test
    fun `done with sources and quotes decodes fully`() {
        val payload = """
            {
              "type": "done",
              "answer": "итог",
              "sources": [
                {"chunkId": "c1", "source": "fixed://doc1", "title": "Док", "section": "План", "score": 0.9}
              ],
              "quotes": [
                {"chunkId": "c1", "source": "fixed://doc1", "section": "План", "snippet": "тезис"}
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString(RagSseEventDto.serializer(), payload)

        assertEquals("итог", dto.answer)
        assertEquals(1, dto.sources.size)
        assertEquals("Док", dto.sources[0].title)
        assertEquals(0.9, dto.sources[0].score, 0.0001)
        assertEquals("тезис", dto.quotes[0].snippet)
    }

    @Test
    fun `alias action add response decodes with topicId`() {
        val payload = """{"ok": true, "name": "артель", "chatKey": "-1001", "topicId": 7}"""

        val dto = json.decodeFromString(RagAliasActionResponse.serializer(), payload)

        assertEquals("артель", dto.name)
        assertEquals("-1001", dto.chatKey)
        assertEquals(7, dto.topicId)
    }

    @Test
    fun `index requests encode field names as server expects`() {
        assertEquals(
            """{"strategies":["fixed","structure"]}""",
            json.encodeToString(RagIndexRequest.serializer(), RagIndexRequest(listOf("fixed", "structure"))),
        )
        assertEquals(
            """{"chatRef":"-1001","topicId":7,"reset":true,"limit":100}""",
            json.encodeToString(
                RagIndexTgRequest.serializer(),
                RagIndexTgRequest(chatRef = "-1001", topicId = 7, reset = true, limit = 100),
            ),
        )
    }

    @Test
    fun `note add request encodes title and text`() {
        assertEquals(
            """{"title":"А","text":"текст"}""",
            json.encodeToString(RagNoteAddRequest.serializer(), RagNoteAddRequest("А", "текст")),
        )
    }
}
