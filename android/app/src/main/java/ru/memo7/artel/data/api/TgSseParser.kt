// Типизированный парсер SSE-событий Telegram-поверхностей (#145):
// POST /api/tg/collect → TgCollectEvent, POST /api/evolute/agent → EvoluteEvent.
// Общий транспорт — безымянные события `data: <JSON>` через `\n\n` (сырые payload'ы
// выдаёт SseParser.drain); здесь payload → sealed-иерархия. Контракты событий —
// web/lib/shared/sse.ts (SseTgCollectEvent / SseEvent). Битый JSON → null: стрим
// не должен ронять экран.
package ru.memo7.artel.data.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.memo7.artel.core.network.ApiFactory

/** Общий маркер событий tg-стримов — возвращаемый тип [TgSseParser.parse]. */
sealed interface TgStreamEvent

/** События SSE POST /api/tg/collect: stage(start|progress) → done | error. */
sealed interface TgCollectEvent : TgStreamEvent {
    data class Stage(val step: String, val detail: TgCollectStageDetail?) : TgCollectEvent

    /** Итог сбора: mode — 'full' | 'resume' | 'incremental'. */
    data class Done(
        val mode: String,
        val fetched: Int,
        val newlyInserted: Int,
        val updated: Int,
        val total: Int,
        val chatKey: String?,
        val topicId: Int?,
        val chatTitle: String?,
    ) : TgCollectEvent

    /** Ошибка, сообщённая сервером внутри стрима. */
    data class Failure(val message: String) : TgCollectEvent
}

/** События SSE POST /api/evolute/agent: общий RAG-контракт stage → token → done | error. */
sealed interface EvoluteEvent : TgStreamEvent {
    /** Стадия пайплайна: rewrite|retrieve|filter|rerank|guard|llm. */
    data class Stage(val step: String) : EvoluteEvent

    /** Очередной фрагмент ответа. */
    data class Token(val delta: String) : EvoluteEvent

    /** Ответ завершён: канонический текст и (при RAG) источники. */
    data class Done(val answer: String?, val sources: List<EvoluteSourceDto>) : EvoluteEvent

    /** Ошибка, сообщённая сервером внутри стрима. */
    data class Failure(val message: String) : EvoluteEvent
}

object TgSseParser {

    /**
     * Разбор одного сырого payload'а. Диспетчеризация: stage со step 'start'/'progress'
     * и done с полем mode — collect; token — evolute. У события {type:'error'} потоки
     * неразличимы — здесь оно маппится в EvoluteEvent.Failure; потребители стримов
     * обязаны использовать типизированные [parseCollect]/[parseEvolute]. Битый JSON → null.
     */
    fun parse(raw: String): TgStreamEvent? {
        val root = decodeTree(raw) ?: return null
        val type = root.type() ?: return null
        return when (type) {
            "stage" -> {
                val step = root.stepOrNull()
                if (step == "start" || step == "progress") parseCollect(raw) else parseEvolute(raw)
            }
            "done" -> if (root.containsKey("mode")) parseCollect(raw) else parseEvolute(raw)
            "token", "error" -> parseEvolute(raw)
            else -> null
        }
    }

    fun parseCollect(raw: String): TgCollectEvent? = when (wireType(raw)) {
        "stage" -> decode<TgCollectStageWire>(raw)?.let { wire ->
            TgCollectEvent.Stage(wire.step ?: "start", wire.detail)
        }
        "done" -> decode<TgCollectDoneWire>(raw)?.let { wire ->
            TgCollectEvent.Done(
                mode = wire.mode,
                fetched = wire.fetched,
                newlyInserted = wire.newlyInserted,
                updated = wire.updated,
                total = wire.total,
                chatKey = wire.chatKey,
                topicId = wire.topicId,
                chatTitle = wire.chatTitle,
            )
        }
        "error" -> decode<TgStreamErrorWire>(raw)?.let { wire ->
            TgCollectEvent.Failure(wire.message ?: DEFAULT_ERROR_MESSAGE)
        }
        else -> null
    }

    fun parseEvolute(raw: String): EvoluteEvent? = when (wireType(raw)) {
        "stage" -> decode<EvoluteStageWire>(raw)?.let { EvoluteEvent.Stage(it.step.orEmpty()) }
        "token" -> decode<EvoluteTokenWire>(raw)?.let { EvoluteEvent.Token(it.delta ?: "") }
        "done" -> decode<EvoluteDoneWire>(raw)?.let { wire ->
            EvoluteEvent.Done(wire.answer, wire.sources ?: emptyList())
        }
        "error" -> decode<TgStreamErrorWire>(raw)?.let { wire ->
            EvoluteEvent.Failure(wire.message ?: DEFAULT_ERROR_MESSAGE)
        }
        else -> null
    }

    private fun wireType(raw: String): String? = decodeTree(raw)?.type()

    /** type/stage-поля защищены от не-примитивных значений: битый payload → null. */
    private fun JsonObject.type(): String? =
        runCatching { this["type"]?.jsonPrimitive?.contentOrNull }.getOrNull()

    private fun JsonObject.stepOrNull(): String? =
        runCatching { this["step"]?.jsonPrimitive?.contentOrNull }.getOrNull()

    /** Общий decode helper: битый/чужой payload → null. */
    private inline fun <reified T> decode(raw: String): T? =
        runCatching { ApiFactory.json.decodeFromString<T>(raw) }.getOrNull()

    private fun decodeTree(raw: String): JsonObject? =
        runCatching { ApiFactory.json.parseToJsonElement(raw).jsonObject }.getOrNull()

    private const val DEFAULT_ERROR_MESSAGE = "Ошибка в потоке данных"
}
