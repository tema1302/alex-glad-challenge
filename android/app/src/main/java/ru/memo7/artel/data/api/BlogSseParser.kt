// Feed-based парсеры SSE-стримов POST /api/blog/news и POST /api/blog/scout:
// безымянные события `data: <JSON>` через `\n\n`, конец потока = закрытие
// соединения сервером (сентинела [DONE] нет). Структура зеркалит ChatSseParser:
// [drain] вырезает из буфера все ПОЛНЫЕ блоки, хвост недописанного события
// остаётся; буфер ожидается в `\n`-нормализованном виде (OkHttp readUtf8Line
// срезает \r). Битый/чужой payload пропускается молча: стрим не должен ронять
// экран. Контракт событий — web/app/api/blog/{news,scout}/route.ts.
package ru.memo7.artel.data.api

import ru.memo7.artel.core.network.ApiFactory

/** Событие блог-стрима в терминах клиента. */
sealed interface BlogStreamEvent {

    sealed interface NewsEvent : BlogStreamEvent {
        /** Старт/этап пайплайна (сервер шлёт step:'start'). */
        data class Stage(val step: String) : NewsEvent

        /** Пайплайн завершён: пост (может быть null), топ новостей, вердикт, notice. */
        data class Done(
            val post: NewsPostDto?,
            val topNews: List<TopNewsDto>,
            val verdict: String?,
            val notice: String?,
        ) : NewsEvent

        /** Ошибка, сообщённая сервером внутри стрима. */
        data class Failure(val message: String) : NewsEvent
    }

    sealed interface ScoutEvent : BlogStreamEvent {
        data class Stage(val step: String) : ScoutEvent

        /** Скаут завершён: ранжированный топ оркестратора + сводка по агентам. */
        data class Done(
            val ranked: List<ScoutRankedDto>,
            val agents: List<ScoutAgentDto>,
        ) : ScoutEvent

        data class Failure(val message: String) : ScoutEvent
    }
}

/** Парсер буфера SSE для news/scout; вызывается после каждого прочитанного чанка. */
object BlogSseParser {

    fun drainNews(buffer: StringBuilder, onEvent: (BlogStreamEvent.NewsEvent) -> Unit) {
        drainBlocks(buffer) { payload ->
            decodeNews(payload)?.let(onEvent)
        }
    }

    fun drainScout(buffer: StringBuilder, onEvent: (BlogStreamEvent.ScoutEvent) -> Unit) {
        drainBlocks(buffer) { payload ->
            decodeScout(payload)?.let(onEvent)
        }
    }

    private fun drainBlocks(buffer: StringBuilder, onPayload: (String) -> Unit) {
        var index = buffer.indexOf(BLOCK_SEPARATOR)
        while (index >= 0) {
            val block = buffer.substring(0, index)
            buffer.delete(0, index + BLOCK_SEPARATOR.length)
            eventPayload(block)?.let(onPayload)
            index = buffer.indexOf(BLOCK_SEPARATOR)
        }
    }

    /** `data:`-строки блока, склеенные через `\n` (многострочный JSON валиден). */
    private fun eventPayload(block: String): String? {
        val data = block
            .lineSequence()
            .filter { it.startsWith("data:") }
            .joinToString("\n") { it.removePrefix("data:").trim() }
        return data.ifEmpty { null }
    }

    /** Битый/чужой payload молча пропускается: стрим не должен ронять экран. */
    private fun decodeNews(payload: String): BlogStreamEvent.NewsEvent? = runCatching {
        val event = ApiFactory.json.decodeFromString(BlogNewsEventDto.serializer(), payload)
        when (event.type) {
            "stage" -> BlogStreamEvent.NewsEvent.Stage(event.step ?: "start")
            "done" -> BlogStreamEvent.NewsEvent.Done(event.post, event.topNews, event.verdict, event.notice)
            "error" -> BlogStreamEvent.NewsEvent.Failure(event.message ?: "Сервер не описал ошибку")
            else -> null
        }
    }.getOrNull()

    private fun decodeScout(payload: String): BlogStreamEvent.ScoutEvent? = runCatching {
        val event = ApiFactory.json.decodeFromString(BlogScoutEventDto.serializer(), payload)
        when (event.type) {
            "stage" -> BlogStreamEvent.ScoutEvent.Stage(event.step ?: "start")
            "done" -> BlogStreamEvent.ScoutEvent.Done(event.ranked, event.agents)
            "error" -> BlogStreamEvent.ScoutEvent.Failure(event.message ?: "Сервер не описал ошибку")
            else -> null
        }
    }.getOrNull()

    private const val BLOCK_SEPARATOR = "\n\n"
}
