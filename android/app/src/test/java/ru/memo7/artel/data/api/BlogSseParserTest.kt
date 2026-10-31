// Чистые тесты парсера SSE-стримов blog/news и blog/scout: без подмены сети —
// только строки и события. Контракт событий: web/app/api/blog/{news,scout}/route.ts.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BlogSseParserTest {

    private fun drainNews(text: String): Pair<List<BlogStreamEvent.NewsEvent>, String> {
        val buffer = StringBuilder(text)
        val events = mutableListOf<BlogStreamEvent.NewsEvent>()
        BlogSseParser.drainNews(buffer) { events += it }
        return events to buffer.toString()
    }

    private fun drainScout(text: String): Pair<List<BlogStreamEvent.ScoutEvent>, String> {
        val buffer = StringBuilder(text)
        val events = mutableListOf<BlogStreamEvent.ScoutEvent>()
        BlogSseParser.drainScout(buffer) { events += it }
        return events to buffer.toString()
    }

    @Test
    fun `news done с post=null и topNews`() {
        val (events, remainder) = drainNews(
            "data: {\"type\":\"stage\",\"step\":\"start\"}\n\n" +
                "data: {\"type\":\"done\",\"post\":null,\"topNews\":[{\"title\":\"Гол\",\"score\":9.5,\"why\":\"топ\"}],\"verdict\":\"ok\",\"notice\":null}\n\n",
        )
        assertEquals(
            listOf(
                BlogStreamEvent.NewsEvent.Stage("start"),
                BlogStreamEvent.NewsEvent.Done(
                    post = null,
                    topNews = listOf(TopNewsDto("Гол", 9.5, "топ")),
                    verdict = "ok",
                    notice = null,
                ),
            ),
            events,
        )
        assertEquals("", remainder)
    }

    @Test
    fun `news done с post`() {
        val (events, remainder) = drainNews(
            "data: {\"type\":\"done\",\"post\":{\"id\":42,\"content\":\"текст поста\"},\"topNews\":[],\"verdict\":null}\n\n",
        )
        assertEquals(
            listOf(
                BlogStreamEvent.NewsEvent.Done(
                    post = NewsPostDto(42, "текст поста"),
                    topNews = emptyList(),
                    verdict = null,
                    notice = null,
                ),
            ),
            events,
        )
        assertEquals("", remainder)
    }

    @Test
    fun `news notice пробрасывается в done`() {
        val (events, _) = drainNews(
            "data: {\"type\":\"done\",\"post\":null,\"topNews\":[],\"verdict\":null,\"notice\":\"RSS-источники недоступны\"}\n\n",
        )
        assertEquals("RSS-источники недоступны", (events.single() as BlogStreamEvent.NewsEvent.Done).notice)
    }

    @Test
    fun `news error становится Failure`() {
        val (events, remainder) = drainNews(
            "data: {\"type\":\"error\",\"message\":\"LLM недоступен\"}\n\n",
        )
        assertEquals(listOf<BlogStreamEvent.NewsEvent>(BlogStreamEvent.NewsEvent.Failure("LLM недоступен")), events)
        assertEquals("", remainder)
    }

    @Test
    fun `scout done с ranked и agents`() {
        val (events, remainder) = drainScout(
            "data: {\"type\":\"stage\",\"step\":\"start\"}\n\n" +
                "data: {\"type\":\"done\",\"ranked\":[{" +
                "\"title\":\"Тема\",\"source\":\"rss\",\"hypeScore\":8.0,\"hypeReason\":\"громко\"," +
                "\"orchestratorScore\":9.0,\"orchestratorReason\":\"в тему\",\"url\":\"https://a.ru\"}]," +
                "\"agents\":[{\"agent\":\"rss\",\"count\":3,\"error\":null},{\"agent\":\"tg\",\"count\":0,\"error\":\"no session\"}]}\n\n",
        )
        assertEquals(
            listOf(
                BlogStreamEvent.ScoutEvent.Stage("start"),
                BlogStreamEvent.ScoutEvent.Done(
                    ranked = listOf(
                        ScoutRankedDto(
                            title = "Тема",
                            source = "rss",
                            hypeScore = 8.0,
                            hypeReason = "громко",
                            orchestratorScore = 9.0,
                            orchestratorReason = "в тему",
                            url = "https://a.ru",
                        ),
                    ),
                    agents = listOf(
                        ScoutAgentDto("rss", 3, null),
                        ScoutAgentDto("tg", 0, "no session"),
                    ),
                ),
            ),
            events,
        )
        assertEquals("", remainder)
    }

    @Test
    fun `scout error становится Failure`() {
        val (events, _) = drainScout("data: {\"type\":\"error\",\"message\":\"упало\"}\n\n")
        assertEquals(listOf<BlogStreamEvent.ScoutEvent>(BlogStreamEvent.ScoutEvent.Failure("упало")), events)
    }

    @Test
    fun `битый json пропускается, поток не падает`() {
        val (events, remainder) = drainNews(
            "data: точно не json\n\ndata: {\"type\":\"stage\",\"step\":\"start\"}\n\n",
        )
        assertEquals(listOf<BlogStreamEvent.NewsEvent>(BlogStreamEvent.NewsEvent.Stage("start")), events)
        assertEquals("", remainder)
    }

    @Test
    fun `незакрытое событие остаётся в буфере до дописывания`() {
        val (first, remainder) = drainNews("data: {\"type\":\"done\",")
        assertEquals(emptyList<BlogStreamEvent.NewsEvent>(), first)
        assertTrue(remainder.startsWith("data: {\"type\":\"done\","))

        val (second, empty) = drainNews(remainder + "\"post\":null,\"topNews\":[]}\n\n")
        assertEquals(
            listOf(BlogStreamEvent.NewsEvent.Done(null, emptyList(), null, null)),
            second,
        )
        assertEquals("", empty)
    }

    @Test
    fun `не-data строки и неизвестный тип игнорируются`() {
        val (events, remainder) = drainScout(
            "event: tease\ndata: {\"type\":\"stage\",\"step\":\"start\"}\n\n" +
                ": keepalive\n\n" +
                "data: {\"type\":\"mystery\"}\n\n",
        )
        assertEquals(listOf<BlogStreamEvent.ScoutEvent>(BlogStreamEvent.ScoutEvent.Stage("start")), events)
        assertEquals("", remainder)
    }
}
