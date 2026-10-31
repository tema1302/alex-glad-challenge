package ru.memo7.artel.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ---------- Agent (POST /api/agent, stateless single-shot) ---------- */

/** POST /api/agent: промпт 1..8000; llm 'local'|'cloud', серверный дефолт — 'cloud'. */
@Serializable
data class AgentRequest(
    val prompt: String,
    val llm: String? = null,
)

/** 200 {ok:true, answer}; 502 {ok:false, error} — маппится репозиторием в Failure. */
@Serializable
data class AgentResponse(
    val ok: Boolean,
    val answer: String = "",
    val error: String? = null,
)

/* ---------- Briefing (GET /api/briefing?chatKey&topicId) ---------- */

/** Плоские счётчики blog/rag/tg/dialog — как на dashboard. */
@Serializable
data class BriefingStatsDto(
    val news: Int = 0,
    val posts: Int = 0,
    val ragFixed: Int = 0,
    val ragStructure: Int = 0,
    val ragTelegram: Int = 0,
    val tgMessages: Int = 0,
    val tgChats: Int = 0,
    val tgTopics: Int = 0,
    val dialogChats: Int = 0,
    val dialogMessages: Int = 0,
)

/** Топ по реакциям; snake_case — формат сервера, не переименовывать. */
@Serializable
data class TopTgMessageDto(
    @SerialName("msg_id") val msgId: Long,
    @SerialName("from_name") val fromName: String,
    val text: String,
    @SerialName("date_iso") val dateIso: String,
    @SerialName("reaction_total") val reactionTotal: Int = 0,
)

/** topTg отсутствует, пока не задан chatKey; chatKey/topicId эхом от сервера. */
@Serializable
data class BriefingResponse(
    val todoSummary: String,
    val stats: BriefingStatsDto,
    val topTg: List<TopTgMessageDto>? = null,
    val chatKey: String? = null,
    val topicId: Int = 1,
)

/* ---------- Summary (GET/POST /api/summary) ---------- */

@Serializable
data class SummaryResponse(
    val summary: String,
    val publishable: Boolean,
)

/** Сервер принимает только publish:true (иначе 400) — поле обязательно, без дефолта. */
@Serializable
data class SummaryPublishRequest(
    val publish: Boolean,
)

/**
 * Успех 200 {ok:true, messageId}; ошибки 400/429/502 — {ok:false, error, errorKind?, retryAfter?}
 * (тело HTTP-ошибки, см. tg-publish.ts): not-configured (400) | rate-limit (429, retryAfter — секунды) |
 * unauthorized | chat-not-found | forbidden | network | unknown (502).
 */
@Serializable
data class SummaryPublishResponse(
    val ok: Boolean,
    val messageId: Long? = null,
    val error: String? = null,
    val errorKind: String? = null,
    val retryAfter: Int? = null,
)

/* ---------- Admin servers (GET /api/admin/servers, только статусы) ---------- */

@Serializable
data class McpServerStatusDto(
    val configured: Boolean,
    val host: String? = null,
    val authConfigured: Boolean,
)

/** cloud/local/embed: configured + опциональные provider/model. */
@Serializable
data class ServerStatusDto(
    val configured: Boolean,
    val provider: String? = null,
    val model: String? = null,
)

@Serializable
data class BotApiStatusDto(
    val configured: Boolean,
    val channelLabel: String? = null,
)

/** Админ-доступ решает сервер по сессии (401 → авто-логаут репозитория); секретов здесь нет. */
@Serializable
data class AdminServersResponse(
    val mcp: McpServerStatusDto,
    val cloud: ServerStatusDto,
    val local: ServerStatusDto,
    val embed: ServerStatusDto,
    val mtproto: ServerStatusDto,
    val botApi: BotApiStatusDto,
    val activeModel: String? = null,
    val activeProvider: String? = null,
)
