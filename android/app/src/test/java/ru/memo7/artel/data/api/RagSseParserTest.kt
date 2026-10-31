// Чистые тесты RagSseParser: один сырой payload → одно событие; битый JSON → null.
// Без подмены сети — только строки.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RagSseParserTest {

    @Test
    fun `token событие парсится`() {
        assertEquals(
            RagStreamEvent.Token("при"),
            RagSseParser.parse("""{"type":"token","delta":"при"}"""),
        )
    }

    @Test
    fun `stage с detail парсится`() {
        val event = RagSseParser.parse(
            """{"type":"stage","step":"progress","detail":{"indexed":12,"total":40}}""",
        )
        assertEquals("progress", (event as RagStreamEvent.Stage).step)
        assertTrue(event.detail.toString().contains(""""indexed":12"""))
    }

    @Test
    fun `done с answer sources quotes парсится`() {
        val event = RagSseParser.parse(
            """{"type":"done","answer":"ответ","sources":[{"chunkId":"c1","source":"docs/a.md","title":"А","section":"Введение","score":0.81}],"quotes":[{"chunkId":"c1","source":"docs/a.md","section":"Введение","snippet":"кусок"}]}""",
        )
        assertEquals(
            RagStreamEvent.Done(
                answer = "ответ",
                sources = listOf(RagSourceDto("c1", "docs/a.md", "А", "Введение", 0.81)),
                quotes = listOf(RagQuoteDto("c1", "docs/a.md", "Введение", "кусок")),
            ),
            event,
        )
    }

    @Test
    fun `done noRag без источников даёт пустые списки`() {
        assertEquals(
            RagStreamEvent.Done(answer = "просто ответ"),
            RagSseParser.parse("""{"type":"done","answer":"просто ответ"}"""),
        )
    }

    @Test
    fun `done index-tg несёт mode chatKey indexed total`() {
        val event = RagSseParser.parse(
            """{"type":"done","mode":"single","chatKey":"-1001","indexed":30,"total":120,"dim":768}""",
        )
        assertEquals(
            RagStreamEvent.Done(mode = "single", chatKey = "-1001", indexed = 30, total = 120, dim = 768),
            event,
        )
    }

    @Test
    fun `done index несёт result статистику`() {
        val event = RagSseParser.parse(
            """{"type":"done","result":[{"strategy":"fixed","chunks":10,"avgLen":450.5,"dim":768}]}""",
        )
        assertEquals(
            RagStreamEvent.Done(result = listOf(RagIndexStatDto("fixed", 10, 450.5, 768))),
            event,
        )
    }

    @Test
    fun `error событие парсится в Failure`() {
        assertEquals(
            RagStreamEvent.Failure("модель недоступна"),
            RagSseParser.parse("""{"type":"error","message":"модель недоступна"}"""),
        )
    }

    @Test
    fun `битый json возвращает null`() {
        assertNull(RagSseParser.parse("точно не json"))
        assertNull(RagSseParser.parse("""{"type":"""))
    }

    @Test
    fun `неизвестный тип возвращает null`() {
        assertNull(RagSseParser.parse("""{"type":"ping"}"""))
    }

    @Test
    fun `несколько событий подряд парсятся по одному`() {
        val raws = listOf(
            """{"type":"stage","step":"rewrite"}""",
            """{"type":"token","delta":"а"}""",
            """{"type":"token","delta":"б"}""",
            """{"type":"done","answer":"аб"}""",
        )
        assertEquals(
            listOf(
                RagStreamEvent.Stage("rewrite", null),
                RagStreamEvent.Token("а"),
                RagStreamEvent.Token("б"),
                RagStreamEvent.Done(answer = "аб"),
            ),
            raws.map { RagSseParser.parse(it) },
        )
    }
}
