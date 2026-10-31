package ru.memo7.artel.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** GET /api/mcp/tools: один инструмент; description/inputSchema опциональны на сервере. */
@Serializable
data class McpToolDto(
    val name: String,
    val description: String? = null,
    val inputSchema: JsonElement? = null,
)

/**
 * GET /api/mcp/tools: 200 в трёх формах — сервер не настроен (configured:false + error),
 * норма (configured:true + tools) и апстрим-ошибка (configured:true, пустой список + error).
 */
@Serializable
data class McpToolsResponse(
    val configured: Boolean,
    val tools: List<McpToolDto> = emptyList(),
    val error: String? = null,
)

/** POST /api/mcp/call: tool — имя инструмента (1..200 на сервере), args — JSON-объект или null. */
@Serializable
data class McpCallRequest(
    val tool: String,
    val args: JsonObject? = null,
)

/** POST /api/mcp/call: ok:true + result — контент-блок ответа; ok:false + error — ошибка MCP-сервера (502). */
@Serializable
data class McpCallResponse(
    val ok: Boolean,
    val result: String? = null,
    val error: String? = null,
)
