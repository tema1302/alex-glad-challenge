// DTO Telegram-поверхностей (#145): /api/tg/top, /api/tg/collect (SSE),
// /api/telegram/history, /api/telegram/publish, /api/evolute/agent (SSE).
// Зеркало web-контрактов (web/lib/shared/forms.ts, web/lib/shared/sse.ts);
// snake_case-поля top-эндпоинта оставлены как есть — плоская проекция строк tg.sqlite.
package ru.memo7.artel.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ---------- TG top (GET /api/tg/top) ---------- */

/** Сообщение топика: snake_case — как на сервере (см. заголовок файла). */
@Serializable
data class TgTopMessageDto(
    val msg_id: Long,
    val from_name: String,
    val text: String,
    val date_iso: String,
    val reaction_total: Int = 0,
    val reactions: Map<String, Int> = emptyMap(),
)

@Serializable
data class TgTopResponse(
    val messages: List<TgTopMessageDto> = emptyList(),
    val count: Int = 0,
    val chatKey: String = "",
    val topicId: Int = 1,
    val by: String = "reactions",
)

/* ---------- TG collect (POST /api/tg/collect, SSE) ---------- */

/**
 * Тело запроса: chatRef — ссылка/ключ чата (1..200, обязателен), topicId — forum-топик
 * (опционален: resolveChatTopic извлекает его из chatRef), limit 1..5000, reset — полный
 * пересбор топика. Является также телом sseStream, поэтому null-поля не уходят в JSON
 * (explicitNulls=false в ApiFactory.json).
 */
@Serializable
data class TgCollectRequest(
    val chatRef: String,
    val topicId: Int? = null,
    val limit: Int? = null,
    val reset: Boolean? = null,
)

/** detail событий stage/progress: живой прогресс сбора, все поля опциональны. */
@Serializable
data class TgCollectStageDetail(
    val chatKey: String? = null,
    val topicId: Int? = null,
    val chatTitle: String? = null,
    val fetched: Int? = null,
    val newlyInserted: Int? = null,
    val lastId: Long? = null,
)

/* ---------- Telegram outbox (GET /api/telegram/history) ---------- */

/** Запись outbox; snake_case на wire → camelCase через @SerialName (конвенция ApiModels). */
@Serializable
data class TelegramHistoryItemDto(
    val id: Long,
    val text: String,
    val source: String,
    @SerialName("blog_post_id") val blogPostId: Long? = null,
    @SerialName("message_id") val messageId: Long? = null,
    val status: String,
    val error: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class TelegramHistoryResponse(
    val ok: Boolean,
    val items: List<TelegramHistoryItemDto> = emptyList(),
)

/* ---------- Telegram publish (POST /api/telegram/publish) ---------- */

/** parseMode: 'HTML' (default) | 'none' — сервер сам санитизирует TG-HTML. */
@Serializable
data class TelegramPublishRequest(
    val text: String,
    val parseMode: String? = null,
)

/** Успех: {ok:true, messageId}. */
@Serializable
data class TelegramPublishResponse(
    val ok: Boolean,
    val messageId: Long = 0,
)

/**
 * Ошибка publish ({ok:false, error, errorKind?, retryAfter?}): errorKind —
 * 'not-configured' (400) | 'rate-limit' (429, retryAfter — секунды) |
 * 'unauthorized' | 'chat-not-found' | 'forbidden' | 'network' | 'unknown' (502).
 * VM декодирует её из тела ошибки и маппит в русские строки без URL/секретов.
 */
@Serializable
data class TelegramPublishError(
    val ok: Boolean = false,
    val error: String = "",
    val errorKind: String? = null,
    val retryAfter: Int? = null,
)

/* ---------- Evolute agent (POST /api/evolute/agent, SSE) ---------- */

/** Реплика истории диалога (role: 'user' | 'assistant', content ≤ 8000, максимум 20). */
@Serializable
data class EvoluteHistoryMessageDto(
    val role: String,
    val content: String,
)

@Serializable
data class EvoluteAgentRequest(
    val query: String,
    val history: List<EvoluteHistoryMessageDto>? = null,
    val k: Int? = null,
    val llm: String? = null,
    val noRag: Boolean? = null,
)

/** Источник RAG-ответа; chunkId — строковый id чанка (web SseSource.chunkId: string). */
@Serializable
data class EvoluteSourceDto(
    val chunkId: String,
    val source: String,
    val title: String = "",
    val section: String = "",
    val score: Double = 0.0,
)

/* ---------- Wire-обёртки событий SSE (внутренние, для TgSseParser) ---------- */

@Serializable
internal data class TgCollectStageWire(
    val type: String,
    val step: String? = null,
    val detail: TgCollectStageDetail? = null,
)

@Serializable
internal data class TgCollectDoneWire(
    val type: String,
    val mode: String,
    val fetched: Int = 0,
    val newlyInserted: Int = 0,
    val updated: Int = 0,
    val total: Int = 0,
    val chatKey: String? = null,
    val topicId: Int? = null,
    val chatTitle: String? = null,
)

/** Общий для collect/evolute wire-вид события {type:'error', message}. */
@Serializable
internal data class TgStreamErrorWire(
    val type: String,
    val message: String? = null,
)

@Serializable
internal data class EvoluteStageWire(
    val type: String,
    val step: String? = null,
)

@Serializable
internal data class EvoluteTokenWire(
    val type: String,
    val delta: String? = null,
)

@Serializable
internal data class EvoluteDoneWire(
    val type: String,
    val answer: String? = null,
    val sources: List<EvoluteSourceDto>? = null,
)
