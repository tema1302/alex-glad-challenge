// Plain JVM unit-тесты DTO дополнительных персон и панелей чата: шутник,
// Антонов (rewrite/thread), memory/branch/profile/constraints views.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

class ChatExtrasModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `joker session переиспользует ChatSessionDto`() {
        val payload = """
            {"session": {"id": "joker-1", "strategy": "full", "usage": {"total_tokens": 42}, "messages": [
              {"role": "user", "content": "шутка про код"},
              {"role": "assistant", "content": "…"}
            ]}}
        """.trimIndent()

        val dto = json.decodeFromString(JokerSessionResponse.serializer(), payload)

        assertEquals("joker-1", dto.session.id)
        assertEquals(2, dto.session.messages.size)
        assertEquals(42, dto.session.usage?.total_tokens)
    }

    @Test
    fun `memory view декодирует working map и longTerm`() {
        val payload = """
            {
              "memoryEnabled": true,
              "task": "помогать с кодом",
              "working": {"draft": "черновик", "lang": "kotlin"},
              "longTerm": [
                {"key": "стек", "value": "kotlin compose", "updatedAt": "2026-09-10 12:00:00"}
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString(MemoryViewDto.serializer(), payload)

        assertTrue(dto.memoryEnabled)
        assertEquals("помогать с кодом", dto.task)
        assertEquals(mapOf("draft" to "черновик", "lang" to "kotlin"), dto.working)
        assertEquals(
            LongTermItemDto("стек", "kotlin compose", "2026-09-10 12:00:00"),
            dto.longTerm.single(),
        )
    }

    @Test
    fun `memory view допускает пустые поля`() {
        val dto = json.decodeFromString(MemoryViewDto.serializer(), """{"memoryEnabled": false}""")

        assertNull(dto.task)
        assertTrue(dto.working.isEmpty())
        assertTrue(dto.longTerm.isEmpty())
    }

    @Test
    fun `memory action response несёт view`() {
        val payload = """{"ok": true, "view": {"memoryEnabled": false}}"""

        val dto = json.decodeFromString(MemoryActionResponse.serializer(), payload)

        assertTrue(dto.ok)
        assertEquals(false, dto.view.memoryEnabled)
    }

    @Test
    fun `branch view декодирует список и activeId`() {
        val payload = """
            {
              "branches": [
                {"id": 0, "label": "main", "parentId": null, "active": false, "messageCount": 12},
                {"id": 1, "label": "эксперимент", "parentId": 0, "active": true, "messageCount": 3}
              ],
              "activeId": 1
            }
        """.trimIndent()

        val dto = json.decodeFromString(BranchViewDto.serializer(), payload)

        assertEquals(2, dto.branches.size)
        assertEquals(BranchDto(1, "эксперимент", 0, true, 3), dto.branches[1])
        assertNull(dto.branches[0].parentId)
        assertEquals(1, dto.activeId)
    }

    @Test
    fun `branch checkpoint response допускает branchId а switch без него`() {
        val checkpoint = json.decodeFromString(
            BranchActionResponse.serializer(),
            """{"ok": true, "branchId": 7, "view": {"branches": [], "activeId": 0}}""",
        )
        assertEquals(7, checkpoint.branchId)

        val switch = json.decodeFromString(
            BranchActionResponse.serializer(),
            """{"ok": true, "view": {"branches": [], "activeId": 0}}""",
        )
        assertNull(switch.branchId)
        assertTrue(switch.view.branches.isEmpty())
    }

    @Test
    fun `profile view держит snapshot как JsonElement`() {
        val payload = """
            {
              "profiles": ["default", "артель"],
              "active": "артель",
              "snapshot": {"style": "сухой", "facts": ["любит compose"]}
            }
        """.trimIndent()

        val dto = json.decodeFromString(ProfileViewDto.serializer(), payload)

        assertEquals(listOf("default", "артель"), dto.profiles)
        assertEquals("артель", dto.active)
        val snapshot = dto.snapshot as kotlinx.serialization.json.JsonObject
        assertEquals("сухой", (snapshot["style"] as kotlinx.serialization.json.JsonPrimitive).content)
        val facts = snapshot["facts"] as kotlinx.serialization.json.JsonArray
        assertEquals("любит compose", (facts.first() as kotlinx.serialization.json.JsonPrimitive).content)
        assertNull(dto.summary)
    }

    @Test
    fun `profile view допускает пустой список и null snapshot`() {
        val dto = json.decodeFromString(
            ProfileViewDto.serializer(),
            """{"profiles": [], "active": null, "snapshot": null}""",
        )

        assertTrue(dto.profiles.isEmpty())
        assertNull(dto.active)
        assertNull(dto.snapshot)
    }

    @Test
    fun `profile edit response несёт summary`() {
        val dto = json.decodeFromString(
            ProfileActionResponse.serializer(),
            """{"ok": true, "summary": "добавлена любовь к compose", "view": {"profiles": ["p"], "active": "p"}}""",
        )

        assertEquals("добавлена любовь к compose", dto.summary)
        assertEquals("p", dto.view.active)
    }

    @Test
    fun `constraints view декодирует items`() {
        val payload = """
            {
              "items": [
                {"id": "c-1", "type": "stack", "title": "Только Kotlin", "description": "без Java", "createdAt": "2026-09-01"}
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString(ConstraintsViewDto.serializer(), payload)

        assertEquals(
            ConstraintDto("c-1", "stack", "Только Kotlin", "без Java", "2026-09-01"),
            dto.items.single(),
        )
    }

    @Test
    fun `constraints add response допускает item`() {
        val payload = """
            {
              "ok": true,
              "item": {"id": "c-2", "type": "custom", "title": "T", "description": "d", "createdAt": "2026-09-02"},
              "view": {"items": []}
            }
        """.trimIndent()

        val dto = json.decodeFromString(ConstraintsActionResponse.serializer(), payload)

        assertEquals("c-2", dto.item?.id)
        assertTrue(dto.view.items.isEmpty())
    }

    @Test
    fun `antonov rewrite response декодирует пост и provider`() {
        val payload = """{"ok": true, "post": "текст поста", "provider": "cloud"}"""

        val dto = json.decodeFromString(AntonovRewriteResponse.serializer(), payload)

        assertTrue(dto.ok)
        assertEquals("текст поста", dto.post)
        assertEquals("cloud", dto.provider)
    }

    @Test
    fun `antonov rewrite ошибка 429 несёт retryAfterSec`() {
        val payload = """{"ok": false, "error": "Слишком много запросов", "retryAfterSec": 900}"""

        val dto = json.decodeFromString(AntonovRewriteResponse.serializer(), payload)

        assertEquals(false, dto.ok)
        assertEquals(900, dto.retryAfterSec)
    }

    @Test
    fun `antonov thread response декодирует список постов`() {
        val payload = """{"ok": true, "posts": ["пост 1", "пост 2"], "provider": "local"}"""

        val dto = json.decodeFromString(AntonovThreadResponse.serializer(), payload)

        assertEquals(listOf("пост 1", "пост 2"), dto.posts)
        assertEquals("local", dto.provider)
    }

    @Test
    fun `antonov thread request кодирует дефолты без лишних полей`() {
        // ApiFactory.json: explicitNulls = false, encodeDefaults = false — null-поля
        // (mode/llm) и дефолты (author/source/images) не уходят в JSON.
        val body = json.encodeToString(
            AntonovThreadRequest.serializer(),
            AntonovThreadRequest(text = "привет"),
        )

        assertTrue(body.contains("\"text\":\"привет\""))
        assertTrue(!body.contains("mode"))
        assertTrue(!body.contains("llm"))
        assertTrue(!body.contains("author"))
        assertTrue(!body.contains("images"))
    }
}
