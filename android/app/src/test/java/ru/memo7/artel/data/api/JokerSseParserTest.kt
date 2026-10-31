// Чистые JVM-тесты парсера SSE-событий шутника: token/done(usage)/error/битый.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JokerSseParserTest {

    @Test
    fun `token парсится с дельтой`() {
        val event = JokerSseParser.parse("""{"type":"token","delta":"почему программист"}""")
        assertEquals(JokerStreamEvent.Token("почему программист"), event)
    }

    @Test
    fun `done парсится с каноническим ответом и usage`() {
        val event = JokerSseParser.parse(
            """{"type":"done","answer":"потому что баг","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}""",
        )
        assertEquals(
            JokerStreamEvent.Done("потому что баг", ChatUsageDto(10, 5, 15)),
            event,
        )
    }

    @Test
    fun `done без usage допустим`() {
        val event = JokerSseParser.parse("""{"type":"done","answer":"ответ"}""")
        assertEquals(JokerStreamEvent.Done("ответ", null), event)
    }

    @Test
    fun `error парсится с сообщением сервера`() {
        val event = JokerSseParser.parse("""{"type":"error","message":"LLM не ответил"}""")
        assertEquals(JokerStreamEvent.Failure("LLM не ответил"), event)
    }

    @Test
    fun `error без message получает запасную строку`() {
        val event = JokerSseParser.parse("""{"type":"error"}""")
        assertTrue(event is JokerStreamEvent.Failure)
        assertEquals("Ответ сервера не описал ошибку", (event as JokerStreamEvent.Failure).message)
    }

    @Test
    fun `битый json возвращает null`() {
        assertNull(JokerSseParser.parse("точно не json"))
        assertNull(JokerSseParser.parse(""))
    }

    @Test
    fun `неизвестный тип возвращает null`() {
        assertNull(JokerSseParser.parse("""{"type":"stage","label":"думаю"}"""))
    }
}
