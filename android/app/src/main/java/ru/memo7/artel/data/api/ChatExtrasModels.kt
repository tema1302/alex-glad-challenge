// DTO дополнительных персон и панелей чата: шутник (SSE), Антонов (rewrite/thread)
// и панели memory/branch/profile/contraints для сессии /api/chat/{sessionId}.
// Контракты — web/app/api/joke|antonov|chat/*; сессия шутника переиспользует
// ChatSessionDto/ChatUsageDto из ApiModels.kt. null-поля кодируются как absent
// (ApiFactory.json: explicitNulls = false).
package ru.memo7.artel.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/* ---------- Joker (Шутник) ---------- */

/** GET/PATCH /api/joke/session → {session}. Сервер сам создаёт единственную сессию. */
@Serializable
data class JokerSessionResponse(
    val session: ChatSessionDto,
)

/** POST /api/joke/session (SSE): llm жёстко 'local' на сервере, не принимается. */
@Serializable
data class JokerSendRequest(
    val text: String,
    val temperature: Double? = null,
)

/** PATCH /api/joke/session {reset:true} — очистка сообщений и usage. */
@Serializable
data class JokerResetRequest(
    val reset: Boolean = true,
)

/* ---------- Antonov (rewrite / thread) ---------- */

/** POST /api/antonov/rewrite: mode soft|normal|hard, format auto|post|essay|guide|calm. */
@Serializable
data class AntonovRewriteRequest(
    val text: String,
    val mode: String? = null,
    val format: String? = null,
    val signature: Boolean? = null,
    val llm: String? = null,
)

/** Успех {ok:true, post, provider}; ошибки приходят не-2xx и маппятся в ApiResult.Failure. */
@Serializable
data class AntonovRewriteResponse(
    val ok: Boolean,
    val post: String = "",
    val provider: String = "",
    val error: String? = null,
    val retryAfterSec: Int? = null,
)

/** POST /api/antonov/thread: тред постов по ссылке/тексту (author/source — подписи). */
@Serializable
data class AntonovThreadRequest(
    val text: String,
    val author: String = "",
    val source: String = "",
    val images: List<String> = emptyList(),
    val mode: String? = null,
    val llm: String? = null,
)

@Serializable
data class AntonovThreadResponse(
    val ok: Boolean,
    val posts: List<String> = emptyList(),
    val provider: String = "",
    val error: String? = null,
    val retryAfterSec: Int? = null,
)

/* ---------- Memory panel ---------- */

/** GET/POST /api/chat/{sessionId}/memory → view. */
@Serializable
data class MemoryViewDto(
    val memoryEnabled: Boolean,
    val task: String? = null,
    val working: Map<String, String> = emptyMap(),
    val longTerm: List<LongTermItemDto> = emptyList(),
)

@Serializable
data class LongTermItemDto(
    val key: String,
    val value: String,
    val updatedAt: String,
)

/**
 * POST /api/chat/{sessionId}/memory. action: remember|forget|task|task-add|
 * task-clear|fact-rm|on|off. Обязательные поля по action проверяет
 * ChatExtrasValidator ДО сети; сервер дублирует проверку (400 на русском).
 */
@Serializable
data class MemoryActionRequest(
    val action: String,
    val key: String? = null,
    val value: String? = null,
    val description: String? = null,
)

@Serializable
data class MemoryActionResponse(
    val ok: Boolean,
    val view: MemoryViewDto,
)

/* ---------- Branch panel ---------- */

@Serializable
data class BranchViewDto(
    val branches: List<BranchDto> = emptyList(),
    val activeId: Int = 0,
)

@Serializable
data class BranchDto(
    val id: Int,
    val label: String,
    val parentId: Int? = null,
    val active: Boolean,
    val messageCount: Int = 0,
)

/**
 * POST /api/chat/{sessionId}/branch: checkpoint (label 1..100, НЕ переключает,
 * ответ дополнительно несёт branchId) | switch (id ≥ 0, ответ {ok, view}).
 */
@Serializable
data class BranchActionRequest(
    val action: String,
    val label: String? = null,
    val id: Int? = null,
)

@Serializable
data class BranchActionResponse(
    val ok: Boolean,
    val branchId: Int? = null,
    val view: BranchViewDto,
)

/* ---------- Profile panel ---------- */

/**
 * GET/POST /api/chat/{sessionId}/profile → view. snapshot — свободный JSON
 * (UserProfile целиком), summary — пояснение LLM к edit.
 */
@Serializable
data class ProfileViewDto(
    val profiles: List<String> = emptyList(),
    val active: String? = null,
    val snapshot: JsonElement? = null,
    val summary: String? = null,
)

/**
 * POST /api/chat/{sessionId}/profile: use|edit|new|copy|delete|reset|note.
 * use/delete → name; new/copy → name (+base для copy); edit → name+instruction
 * (llm cloud|local); note → text (добавить факт в активный профиль).
 */
@Serializable
data class ProfileActionRequest(
    val action: String,
    val name: String? = null,
    val base: String? = null,
    val instruction: String? = null,
    val text: String? = null,
    val llm: String? = null,
)

@Serializable
data class ProfileActionResponse(
    val ok: Boolean,
    val view: ProfileViewDto,
    val summary: String? = null,
)

/* ---------- Constraints panel ---------- */

/** GET /api/chat/{sessionId}/constraints — глобальный список, sessionId игнорируется. */
@Serializable
data class ConstraintDto(
    val id: String,
    val type: String,
    val title: String,
    val description: String,
    val createdAt: String,
)

@Serializable
data class ConstraintsViewDto(
    val items: List<ConstraintDto> = emptyList(),
)

/** POST /api/chat/{sessionId}/constraints: add (type+title, description опц.) | rm (id). */
@Serializable
data class ConstraintsActionRequest(
    val action: String,
    val type: String? = null,
    val title: String? = null,
    val description: String? = null,
    val id: String? = null,
)

@Serializable
data class ConstraintsActionResponse(
    val ok: Boolean,
    val item: ConstraintDto? = null,
    val view: ConstraintsViewDto,
)
