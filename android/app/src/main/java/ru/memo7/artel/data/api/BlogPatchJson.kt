// Частичные JSON-тела для blog API. Обычный PatchBlogRequest с encodeDefaults
// отправлял все ключи (null → сброс чужих полей), поэтому общие настройки и
// промпты собираются только из реально изменённых ключей.
package ru.memo7.artel.data.api

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal fun blogStatusPatchJson(status: String): JsonObject = buildJsonObject {
    put("status", status)
}

/**
 * Общие поля блога. `profileChanged`/`tgChanged` нужны, чтобы отличить
 * «не менять» от «сбросить в null»: null без флага не отправляется.
 */
internal fun blogGeneralPatchJson(
    name: String? = null,
    profile: String? = null,
    profileChanged: Boolean = false,
    tgChatId: String? = null,
    tgChanged: Boolean = false,
    stylePreset: String? = null,
    sources: List<String>? = null,
    contextPrompt: String? = null,
): JsonObject = buildJsonObject {
    name?.let { put("name", it) }
    if (profileChanged) {
        if (profile == null) put("profile", JsonNull) else put("profile", profile)
    }
    if (tgChanged) {
        if (tgChatId == null) put("tgChatId", JsonNull) else put("tgChatId", tgChatId)
    }
    stylePreset?.let { put("stylePreset", it) }
    sources?.let { list ->
        put("sources", kotlinx.serialization.json.JsonArray(list.map { JsonPrimitive(it) }))
    }
    contextPrompt?.let { put("contextPrompt", it) }
}

/** PUT agent-prompts: prompt=null должен уйти явно как JSON null (сброс). */
internal fun blogAgentPromptJson(agent: String, prompt: String?): JsonObject = buildJsonObject {
    put("agent", agent)
    if (prompt == null) put("prompt", JsonNull) else put("prompt", prompt)
}
