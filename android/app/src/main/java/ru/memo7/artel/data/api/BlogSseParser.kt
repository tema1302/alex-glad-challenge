// Парсеры SSE-стримов POST /api/blog/news и POST /api/blog/scout.
// Generic sseStream (ArtelRepository) уже разбирает транспортный SSE через
// SseParser и отдаёт сюда распакованный JSON-payload (без `data:`); конец
// потока = закрытие соединения сервером (сентинела [DONE] нет).
// Битый/чужой payload пропускается молча: стрим не должен ронять экран.
// Контракт событий — web/app/api/blog/{news,scout}/route.ts.
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

/**
 * Парсер payload'ов SSE для news/scout. В отличие от [ChatSseParser], сюда
 * приходит не сырой блок с `data:`, а уже распакованный JSON из [SseParser]
 * (generic sseStream отдаёт payload без префикса). Поэтому parser работает
 * с одной строкой JSON, а не с буфером SSE-блока.
 */
object BlogSseParser {

    /** true — JSON оказался событием news и был передан в [onEvent]. */
    fun parseNews(payload: String, onEvent: (BlogStreamEvent.NewsEvent) -> Unit): Boolean {
        val event = decodeNews(payload) ?: return false
        onEvent(event)
        return true
    }

    /** true — JSON оказался событием scout и был передан в [onEvent]. */
    fun parseScout(payload: String, onEvent: (BlogStreamEvent.ScoutEvent) -> Unit): Boolean {
        val event = decodeScout(payload) ?: return false
        onEvent(event)
        return true
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
}
