// Типизированный парсер SSE-событий RAG-стримов (POST /api/rag/query, /api/rag/chat/{id},
// /api/rag/index, /api/rag/index-tg) поверх сырых JSON-payload'ов, которые отдаёт
// repository.sseStream через SseParser. Контракт событий — web/lib/shared/sse.ts:
// {type:'stage',step,detail?} | {type:'token',delta} | {type:'done',…} | {type:'error',message}.
// Битый/чужой payload → null: стрим не должен ронять экран.
package ru.memo7.artel.data.api

import kotlinx.serialization.json.JsonElement
import ru.memo7.artel.core.network.ApiFactory

/** Событие RAG-стрима в терминах клиента. */
sealed interface RagStreamEvent {
    /** Стадия пайплайна: step (rewrite/retrieve/…, start/collect/progress/clear) + detail. */
    data class Stage(val step: String, val detail: JsonElement?) : RagStreamEvent

    /** Очередной фрагмент текста ответа LLM. */
    data class Token(val delta: String) : RagStreamEvent

    /**
     * Финал стрима. Для query/rag-chat — answer + sources + quotes; для index —
     * result (статистика по партициям); для index-tg — mode/chatKey/indexed/total/dim.
     */
    data class Done(
        val answer: String? = null,
        val sources: List<RagSourceDto> = emptyList(),
        val quotes: List<RagQuoteDto> = emptyList(),
        val result: List<RagIndexStatDto> = emptyList(),
        val mode: String? = null,
        val chatKey: String? = null,
        val indexed: Int? = null,
        val total: Int? = null,
        val dim: Int? = null,
    ) : RagStreamEvent

    /** Ошибка, сообщённая сервером внутри 200-потока. */
    data class Failure(val message: String) : RagStreamEvent
}

object RagSseParser {

    /** Один сырой payload (JSON-строка одного `data:`-блока) → событие; битый JSON → null. */
    fun parse(raw: String): RagStreamEvent? = runCatching {
        val event = ApiFactory.json.decodeFromString(RagSseEventDto.serializer(), raw)
        when (event.type) {
            "stage" -> RagStreamEvent.Stage(event.step ?: "start", event.detail)
            "token" -> RagStreamEvent.Token(event.delta ?: "")
            "done" -> RagStreamEvent.Done(
                answer = event.answer,
                sources = event.sources,
                quotes = event.quotes,
                result = event.result,
                mode = event.mode,
                chatKey = event.chatKey,
                indexed = event.indexed,
                total = event.total,
                dim = event.dim,
            )
            "error" -> RagStreamEvent.Failure(event.message ?: "Ответ сервера не описал ошибку")
            else -> null
        }
    }.getOrNull()
}
