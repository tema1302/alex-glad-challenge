// Парсер SSE-событий шутника POST /api/joke/session: события `{type, …}` в
// терминах клиента. Битый/чужой payload молча пропускается: стрим не должен
// ронять экран. Контракт события совпадает с чатовым ChatSseEventDto — реюзаем
// его декодирование, не дублируя DTO.
package ru.memo7.artel.data.api

import ru.memo7.artel.core.network.ApiFactory

/** Событие стрима шутника. */
sealed interface JokerStreamEvent {
    /** Очередной фрагмент шутки. */
    data class Token(val delta: String) : JokerStreamEvent

    /** Ответ завершён: канонический текст и счётчик токенов. */
    data class Done(val answer: String?, val usage: ChatUsageDto?) : JokerStreamEvent

    /** Ошибка, сообщённая сервером внутри стрима. */
    data class Failure(val message: String) : JokerStreamEvent
}

object JokerSseParser {

    /** Один сырой `data:`-payload (JSON-строка) → событие или null при битом JSON. */
    fun parse(raw: String): JokerStreamEvent? = runCatching {
        val event = ApiFactory.json.decodeFromString(ChatSseEventDto.serializer(), raw)
        when (event.type) {
            "token" -> JokerStreamEvent.Token(event.delta ?: "")
            "done" -> JokerStreamEvent.Done(event.answer, event.usage)
            "error" -> JokerStreamEvent.Failure(event.message ?: "Ответ сервера не описал ошибку")
            else -> null
        }
    }.getOrNull()
}
