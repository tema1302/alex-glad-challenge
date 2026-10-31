// DTO конвейера RAG (web /api/rag/*): запросы, ответы и сырые SSE-события.
// Имена полей — как в серверных схемах (web/lib/shared/forms.ts, web/lib/shared/sse.ts):
// DialogDb-чаты отдаются snake_case (created_at/updated_at/msg_count), остальное — camelCase.
package ru.memo7.artel.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/* ---------- Query / chat-send ---------- */

/** POST /api/rag/query — свободный запрос к базе знаний (query: 1..2000). */
@Serializable
data class RagQueryRequest(
    val query: String,
    val strategy: String? = null,
    val k: Int? = null,
    val llm: String? = null,
    val noRag: Boolean? = null,
)

/** POST /api/rag/chat/{dialogChatId} — сообщение в диалог базы знаний (text: 1..8000). */
@Serializable
data class RagChatSendRequest(
    val text: String,
    val strategy: String? = null,
    val k: Int? = null,
    val llm: String? = null,
    val chatKey: String? = null,
    val topicId: Int? = null,
    val noRag: Boolean? = null,
)

/** Найденный чанк (web SseSource) — источник ответа. */
@Serializable
data class RagSourceDto(
    val chunkId: String,
    val source: String,
    val title: String,
    val section: String,
    val score: Double = 0.0,
)

/** Цитата из чанка (web SseQuote). */
@Serializable
data class RagQuoteDto(
    val chunkId: String,
    val source: String,
    val section: String,
    val snippet: String,
)

/* ---------- TG-каталог: алиасы + DialogDb-чаты ---------- */

/** DialogDb-чат диалога базы знаний — snake_case, как в SQLite. */
@Serializable
data class RagDialogChatDto(
    val id: String,
    val title: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("msg_count") val msgCount: Int = 0,
)

/** GET /api/rag/chats — каталог TG-чатов (chatKey→title) + алиасы + DialogDb-чаты. */
@Serializable
data class RagChatsResponse(
    val titles: Map<String, String> = emptyMap(),
    val aliases: List<RagAliasDto> = emptyList(),
    val chats: List<RagDialogChatDto> = emptyList(),
)

/** Алиас TG-чата: локальное имя → chatKey опционально с топиком. */
@Serializable
data class RagAliasDto(
    val name: String,
    val chatKey: String,
    val topicId: Int? = null,
)

/** POST /api/rag/chats — add/rm алиаса (name: 1..100, chatKey: ≤200 для add). */
@Serializable
data class RagAliasActionRequest(
    val action: String,
    val name: String,
    val chatKey: String? = null,
    val topicId: Int? = null,
)

/** add → {ok,name,chatKey,topicId?}; rm → {ok,name} — один DTO покрывает оба ответа. */
@Serializable
data class RagAliasActionResponse(
    val ok: Boolean,
    val name: String,
    val chatKey: String? = null,
    val topicId: Int? = null,
)

/* ---------- Диалоги базы знаний ---------- */

/** GET /api/rag/chat — список DialogDb-чатов. */
@Serializable
data class RagChatListResponse(
    val chats: List<RagDialogChatDto> = emptyList(),
)

/** POST /api/rag/chat — создание диалога (title: ≤120, опционально). */
@Serializable
data class RagChatCreateRequest(
    val title: String? = null,
)

@Serializable
data class RagChatCreatedResponse(
    val id: String,
)

/** Сообщение диалога (DialogDb MessageRow). */
@Serializable
data class RagChatMessageDto(
    val id: Long,
    val chatId: String,
    val role: String,
    val content: String,
    val ts: String,
)

/** GET /api/rag/chat/{id} — деталь диалога + история + отрендеренный task-state. */
@Serializable
data class RagChatDetailResponse(
    val chat: RagDialogChatDto,
    val messages: List<RagChatMessageDto> = emptyList(),
    val taskStateText: String = "",
)

/** PATCH /api/rag/chat/{id} — title?:≤120, task?:≤500, taskClear?:bool. */
@Serializable
data class RagChatPatchRequest(
    val title: String? = null,
    val task: String? = null,
    val taskClear: Boolean? = null,
)

@Serializable
data class RagChatPatchResponse(
    val chat: RagDialogChatDto,
    val taskStateText: String = "",
)

/* ---------- Индексация ---------- */

/** POST /api/rag/index — пересборка документных партиций (strategies: min 1). */
@Serializable
data class RagIndexRequest(
    val strategies: List<String>,
)

/** Статистика партиции из done index-стрима (web SseRagIndexStrategyStat). */
@Serializable
data class RagIndexStatDto(
    val strategy: String,
    val chunks: Int = 0,
    val avgLen: Double = 0.0,
    val dim: Int? = null,
)

/** POST /api/rag/index-tg — индексация telegram-партиции (chatRef: 1..200). */
@Serializable
data class RagIndexTgRequest(
    val chatRef: String,
    val topicId: Int? = null,
    val reset: Boolean? = null,
    val limit: Int? = null,
    val top: Int? = null,
)

/** done index-tg-стрима: mode 'single'|'whole'. */
@Serializable
data class RagIndexTgDoneDto(
    val mode: String,
    val chatKey: String,
    val indexed: Int = 0,
    val total: Int = 0,
    val dim: Int? = null,
)

/* ---------- Заметки (партиция notes) ---------- */

/** Счётчики чанков по партициям (GET /api/rag/notes → partitions). */
@Serializable
data class RagPartitionsDto(
    val fixed: Long = 0,
    val structure: Long = 0,
    val telegram: Long = 0,
    val notes: Long = 0,
    val docs: Long = 0,
    val faq: Long = 0,
)

/** Заметка в базе знаний; source — note://…, chunks — кол-во чанков. */
@Serializable
data class RagNoteDto(
    val source: String,
    val title: String,
    val chunks: Int = 0,
)

/** GET /api/rag/notes — счётчики партиций + список заметок. */
@Serializable
data class RagNotesResponse(
    val ok: Boolean,
    val partitions: RagPartitionsDto = RagPartitionsDto(),
    val notes: List<RagNoteDto> = emptyList(),
)

/** POST /api/rag/notes — JSON-форма добавления заметки (title: 1..120, text: 1..20000). */
@Serializable
data class RagNoteAddRequest(
    val title: String,
    val text: String,
)

@Serializable
data class RagNoteAddResponse(
    val ok: Boolean,
    val source: String,
    val title: String,
    val chunks: Int = 0,
)

/** DELETE /api/rag/notes — удаление заметки по source (note://…). */
@Serializable
data class RagNoteDeleteRequest(
    val source: String,
)

@Serializable
data class RagNoteDeleteResponse(
    val ok: Boolean,
    val deleted: Int = 0,
)

/* ---------- Сырые SSE-события ---------- */

/**
 * Сырой SSE-ивент всех RAG-стримов (query / rag-chat / index / index-tg):
 * дискриминатор — type, detail — произвольный JSON-фрагмент (web SseStageEvent.detail).
 */
@Serializable
data class RagSseEventDto(
    val type: String,
    val step: String? = null,
    val detail: JsonElement? = null,
    val delta: String? = null,
    val answer: String? = null,
    val sources: List<RagSourceDto> = emptyList(),
    val quotes: List<RagQuoteDto> = emptyList(),
    val result: List<RagIndexStatDto> = emptyList(),
    val mode: String? = null,
    val chatKey: String? = null,
    val indexed: Int? = null,
    val total: Int? = null,
    val dim: Int? = null,
    val message: String? = null,
)
