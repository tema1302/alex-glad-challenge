// Общий парсер SSE-событий `data: <JSON>` через `\n\n` для всех стриминговых
// endpoint'ов web API (rag/query, rag/chat, blog/news, blog/scout, tg/collect,
// evolute/agent, joke/session). Feed-based: [drain] вырезает из буфера все
// ПОЛНЫЕ блоки, хвост недописанного события остаётся. Буфер в \n-нормализованном
// виде (OkHttp readUtf8Line срезает \r). Битый payload пропускается молча:
// стрим не должен ронять экран. Контракт события — набор полей {type, …} в JSON.
package ru.memo7.artel.data.api

/** Сырое событие стрима: payload одного `data:`-блока (JSON-строка). */
fun interface SseRawHandler {
    fun onEvent(rawJson: String)
}

object SseParser {

    fun drain(buffer: StringBuilder, onEvent: (String) -> Unit) {
        var index = buffer.indexOf(BLOCK_SEPARATOR)
        while (index >= 0) {
            val block = buffer.substring(0, index)
            buffer.delete(0, index + BLOCK_SEPARATOR.length)
            eventPayload(block)?.let(onEvent)
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

    private const val BLOCK_SEPARATOR = "\n\n"
}
