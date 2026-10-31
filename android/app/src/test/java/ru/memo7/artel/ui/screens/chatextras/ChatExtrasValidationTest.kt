// Чистая JVM-валидация обязательных полей memory-actions и constraints add/rm:
// таблица кейсов → null (ok) или русская подсказка. Без сети, без Android.
package ru.memo7.artel.ui.screens.chatextras

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.data.api.ConstraintsActionRequest
import ru.memo7.artel.data.api.MemoryActionRequest

class ChatExtrasValidationTest {

    /* ---------- Memory actions ---------- */

    private data class MemoryCase(
        val name: String,
        val request: MemoryActionRequest,
        val expected: String?,
    )

    private val memoryCases = listOf(
        MemoryCase(
            "remember без ключа",
            MemoryActionRequest(action = "remember", value = "v"),
            "Укажите ключ",
        ),
        MemoryCase(
            "remember без значения",
            MemoryActionRequest(action = "remember", key = "k"),
            "Укажите значение",
        ),
        MemoryCase(
            "remember валиден",
            MemoryActionRequest(action = "remember", key = "k", value = "v"),
            null,
        ),
        MemoryCase(
            "remember с пустым ключом после trim",
            MemoryActionRequest(action = "remember", key = "   ", value = "v"),
            "Укажите ключ",
        ),
        MemoryCase(
            "remember со слишком длинным ключом",
            MemoryActionRequest(action = "remember", key = "k".repeat(201), value = "v"),
            "Ключ слишком длинный: максимум 200 знаков",
        ),
        MemoryCase(
            "forget без ключа",
            MemoryActionRequest(action = "forget"),
            "Укажите ключ",
        ),
        MemoryCase(
            "forget валиден",
            MemoryActionRequest(action = "forget", key = "k"),
            null,
        ),
        MemoryCase(
            "task без описания",
            MemoryActionRequest(action = "task"),
            "Укажите описание задачи",
        ),
        MemoryCase(
            "task валиден",
            MemoryActionRequest(action = "task", description = "сделать то-то"),
            null,
        ),
        MemoryCase(
            "task-add без значения",
            MemoryActionRequest(action = "task-add", key = "k"),
            "Укажите значение",
        ),
        MemoryCase(
            "task-add валиден",
            MemoryActionRequest(action = "task-add", key = "k", value = "v"),
            null,
        ),
        MemoryCase(
            "fact-rm без ключа",
            MemoryActionRequest(action = "fact-rm"),
            "Укажите ключ",
        ),
        MemoryCase(
            "on без полей валиден",
            MemoryActionRequest(action = "on"),
            null,
        ),
        MemoryCase(
            "off без полей валиден",
            MemoryActionRequest(action = "off"),
            null,
        ),
        MemoryCase(
            "task-clear без полей валиден",
            MemoryActionRequest(action = "task-clear"),
            null,
        ),
        MemoryCase(
            "неизвестное действие",
            MemoryActionRequest(action = "hack"),
            "Неизвестное действие памяти: hack",
        ),
    )

    @Test
    fun `memory action cases`() {
        memoryCases.forEach { case ->
            assertEquals(
                "case: ${case.name}",
                case.expected,
                ChatExtrasValidator.validateMemoryAction(case.request),
            )
        }
    }

    /* ---------- Constraints actions ---------- */

    @Test
    fun `constraints add требует тип из enum`() {
        assertEquals(
            "Выберите тип ограничения",
            ChatExtrasValidator.validateConstraintsAction(
                ConstraintsActionRequest(action = "add", type = "weird", title = "t"),
            ),
        )
        assertEquals(
            "Выберите тип ограничения",
            ChatExtrasValidator.validateConstraintsAction(
                ConstraintsActionRequest(action = "add", type = null, title = "t"),
            ),
        )
    }

    @Test
    fun `constraints add требует название`() {
        assertEquals(
            "Укажите название",
            ChatExtrasValidator.validateConstraintsAction(
                ConstraintsActionRequest(action = "add", type = "stack", title = "  "),
            ),
        )
        assertEquals(
            "Название слишком длинное: максимум 200 знаков",
            ChatExtrasValidator.validateConstraintsAction(
                ConstraintsActionRequest(action = "add", type = "stack", title = "t".repeat(201)),
            ),
        )
    }

    @Test
    fun `constraints add валиден по таблице типов`() {
        listOf("architecture", "tech_decision", "stack", "business", "custom").forEach { type ->
            assertNull(
                ChatExtrasValidator.validateConstraintsAction(
                    ConstraintsActionRequest(action = "add", type = type, title = "Только Kotlin"),
                ),
            )
        }
    }

    @Test
    fun `constraints add допускает пустое описание но не длинное`() {
        assertNull(
            ChatExtrasValidator.validateConstraintsAction(
                ConstraintsActionRequest(action = "add", type = "custom", title = "t", description = ""),
            ),
        )
        assertEquals(
            "Описание слишком длинное: максимум 2000 знаков",
            ChatExtrasValidator.validateConstraintsAction(
                ConstraintsActionRequest(action = "add", type = "custom", title = "t", description = "d".repeat(2001)),
            ),
        )
    }

    @Test
    fun `constraints rm требует id`() {
        assertEquals(
            "Укажите id ограничения",
            ChatExtrasValidator.validateConstraintsAction(ConstraintsActionRequest(action = "rm")),
        )
        assertEquals(
            "Укажите id ограничения",
            ChatExtrasValidator.validateConstraintsAction(ConstraintsActionRequest(action = "rm", id = "  ")),
        )
        assertNull(
            ChatExtrasValidator.validateConstraintsAction(ConstraintsActionRequest(action = "rm", id = "c-1")),
        )
    }

    @Test
    fun `constraints неизвестное действие`() {
        assertEquals(
            "Неизвестное действие ограничений: hack",
            ChatExtrasValidator.validateConstraintsAction(ConstraintsActionRequest(action = "hack")),
        )
    }
}
