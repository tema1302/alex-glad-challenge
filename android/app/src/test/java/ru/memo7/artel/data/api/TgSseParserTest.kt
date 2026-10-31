// Чистые JVM-тесты TgSseParser: collect (stage/progress/done/error/битый JSON) и
// evolute (stage/token×N+done с sources/error). Без сети и моков — только строки.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TgSseParserTest {

    @Test
    fun `collect stage start с detail декодируется`() {
        val raw = """{"type":"stage","step":"start","detail":{"chatKey":"-1001508192874","topicId":5,"chatTitle":"Эволют Чат"}}"""

        val event = TgSseParser.parseCollect(raw)

        assertEquals(
            TgCollectEvent.Stage(
                "start",
                TgCollectStageDetail(chatKey = "-1001508192874", topicId = 5, chatTitle = "Эволют Чат"),
            ),
            event,
        )
    }

    @Test
    fun `collect stage progress с прогрессом декодируется`() {
        val raw = """{"type":"stage","step":"progress","detail":{"fetched":120,"newlyInserted":40,"lastId":9801234567}}"""

        val event = TgSseParser.parseCollect(raw)

        assertEquals(
            TgCollectEvent.Stage(
                "progress",
                TgCollectStageDetail(fetched = 120, newlyInserted = 40, lastId = 9801234567L),
            ),
            event,
        )
    }

    @Test
    fun `collect done с mode и счётчиками декодируется`() {
        val raw = """{"type":"done","mode":"incremental","fetched":120,"newlyInserted":40,"updated":3,"total":5600,"chatKey":"-1001508192874","topicId":5,"chatTitle":"Эволют Чат"}"""

        val event = TgSseParser.parseCollect(raw)

        assertEquals(
            TgCollectEvent.Done(
                mode = "incremental",
                fetched = 120,
                newlyInserted = 40,
                updated = 3,
                total = 5600,
                chatKey = "-1001508192874",
                topicId = 5,
                chatTitle = "Эволют Чат",
            ),
            event,
        )
    }

    @Test
    fun `collect error декодируется`() {
        val event = TgSseParser.parseCollect("""{"type":"error","message":"сессия TG устарела"}""")

        assertEquals(TgCollectEvent.Failure("сессия TG устарела"), event)
    }

    @Test
    fun `collect битый json и неизвестный тип дают null`() {
        assertNull(TgSseParser.parseCollect("точно не json"))
        assertNull(TgSseParser.parseCollect("""{"type":"mystery","x":1}"""))
        assertNull(TgSseParser.parseCollect("""{"type":"done","chatKey":"k"}"""))
    }

    @Test
    fun `parse диспетчеризует done с mode в collect`() {
        val raw = """{"type":"done","mode":"full","fetched":10,"newlyInserted":10,"updated":0,"total":10,"chatKey":"k","topicId":1,"chatTitle":"t"}"""

        val event = TgSseParser.parse(raw)

        assertTrue(event is TgCollectEvent.Done)
        assertEquals("full", (event as TgCollectEvent.Done).mode)
    }

    @Test
    fun `parse диспетчеризует token в evolute`() {
        val event = TgSseParser.parse("""{"type":"token","delta":"при"}""")

        assertEquals(EvoluteEvent.Token("при"), event)
    }

    @Test
    fun `evolute token подряд и done с sources декодируются`() {
        val raws = listOf(
            """{"type":"token","delta":"Концепция "}""",
            """{"type":"token","delta":"«эволюции»"}""",
            """{"type":"done","answer":"Концепция «эволюции»","sources":[{"chunkId":"c-1","source":"telegram","title":"Эволют Чат","section":"intro","score":0.87}]}""",
        )

        val events = raws.map { TgSseParser.parseEvolute(it) }

        assertEquals(
            listOf(
                EvoluteEvent.Token("Концепция "),
                EvoluteEvent.Token("«эволюции»"),
                EvoluteEvent.Done(
                    "Концепция «эволюции»",
                    listOf(EvoluteSourceDto(chunkId = "c-1", source = "telegram", title = "Эволют Чат", section = "intro", score = 0.87)),
                ),
            ),
            events,
        )
    }

    @Test
    fun `evolute done без sources и error декодируются`() {
        assertEquals(
            EvoluteEvent.Done("просто ответ", emptyList()),
            TgSseParser.parseEvolute("""{"type":"done","answer":"просто ответ"}"""),
        )
        assertEquals(
            EvoluteEvent.Failure("модель не ответила"),
            TgSseParser.parseEvolute("""{"type":"error","message":"модель не ответила"}"""),
        )
    }

    @Test
    fun `evolute stage и битый json`() {
        assertEquals(EvoluteEvent.Stage("retrieve"), TgSseParser.parseEvolute("""{"type":"stage","step":"retrieve"}"""))
        assertNull(TgSseParser.parseEvolute("{not json"))
        assertNull(TgSseParser.parse("точно не json"))
    }
}
