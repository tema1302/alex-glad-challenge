// ViewModel шутника (web /joke): единственная серверная сессия, SSE-стрим
// ответов, температура 0.3..1.2, сброс истории. Отдельная VM — стриминг и
// отмена не трогают ChatScreen. Отмена («Остановить») идёт через общий
// repository.cancelSseStream(), как у rag/evolute.
package ru.memo7.artel.ui.screens.chatextras

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.ChatSessionDto
import ru.memo7.artel.data.api.JokerSendRequest
import ru.memo7.artel.data.api.JokerSseParser
import ru.memo7.artel.data.api.JokerStreamEvent
import ru.memo7.artel.ui.screens.assistant.ChatMessage

/** Клиентский предел сообщения — как на сервере (jokeSchema.text 1..8000). */
internal const val JOKER_MAX_TEXT_LENGTH = 8000

/** Диапазон temperature — как на сервере (jokeSchema 0.3..1.2). */
internal const val JOKER_TEMPERATURE_MIN = 0.3
internal const val JOKER_TEMPERATURE_MAX = 1.2

/** Дефолт сервера (JOKER_KNOBS) — показываем на слайдере до первого изменения. */
internal const val JOKER_TEMPERATURE_DEFAULT = 0.9

data class JokerUiState(
    val load: UiState<ChatSessionDto> = UiState.Loading,
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val notice: String? = null,
    val temperature: Double = JOKER_TEMPERATURE_DEFAULT,
)

class JokerViewModel(
    private val repository: ArtelRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(JokerUiState())
    val state: StateFlow<JokerUiState> = _state.asStateFlow()

    private var nextId = 1L

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(load = UiState.Loading, messages = emptyList(), notice = null) }
        viewModelScope.launch {
            when (val result = repository.jokerSession()) {
                is ApiResult.Success -> _state.value = JokerUiState(
                    load = UiState.Success(result.data.session),
                    temperature = _state.value.temperature,
                    messages = result.data.session.messages
                        .filter { it.role != "system" }
                        .map {
                            ChatMessage(
                                id = nextId++,
                                fromUser = it.role == "user",
                                text = it.content,
                            )
                        },
                )
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(load = UiState.Error(result.error.message ?: "Не удалось загрузить шутника"))
                    }
            }
        }
    }

    fun setTemperature(value: Double) {
        _state.update { it.copy(temperature = value.coerceIn(JOKER_TEMPERATURE_MIN, JOKER_TEMPERATURE_MAX)) }
    }

    fun send(text: String) {
        val trimmed = text.trim()
        if (_state.value.busy || trimmed.isEmpty() || trimmed.length > JOKER_MAX_TEXT_LENGTH) return
        val userMessage = ChatMessage(id = nextId++, fromUser = true, text = trimmed)
        val assistantMessage = ChatMessage(id = nextId++, fromUser = false, text = "", pending = true)
        _state.update {
            it.copy(
                messages = it.messages + userMessage + assistantMessage,
                busy = true,
                notice = null,
            )
        }

        viewModelScope.launch {
            var accumulated = ""
            var streamAnswer: String? = null
            var streamFailure: String? = null
            val body = ApiFactory.json.encodeToString(
                JokerSendRequest.serializer(),
                JokerSendRequest(text = trimmed, temperature = _state.value.temperature),
            )
            val streamResult = repository.sseStream("api/joke/session", body) { raw ->
                when (val event = JokerSseParser.parse(raw)) {
                    is JokerStreamEvent.Token -> {
                        accumulated += event.delta
                        replaceMessage(assistantMessage.id) { it.copy(text = accumulated) }
                    }
                    is JokerStreamEvent.Done -> {
                        streamAnswer = event.answer ?: accumulated
                    }
                    is JokerStreamEvent.Failure -> streamFailure = event.message
                    null -> Unit
                }
            }
            val (finalText, isError) = when {
                streamFailure != null -> streamFailure.orEmpty() to true
                streamResult is ApiResult.Failure -> {
                    val reason = (streamResult as ApiResult.Failure).error.message
                    val text = if (reason != null) "Не удалось получить ответ: $reason" else "Не удалось получить ответ"
                    text to true
                }
                else -> (streamAnswer ?: accumulated).ifBlank { "Пустой ответ сервера" } to false
            }
            replaceMessage(assistantMessage.id) { it.copy(text = finalText, isError = isError, pending = false) }
            _state.update { it.copy(busy = false) }
        }
    }

    /** «Остановить»: обрываем сокет; частичный ответ остаётся в пузыре. */
    fun stop() {
        repository.cancelSseStream()
    }

    /** PATCH reset:true — сервер чистит историю и usage; локально перечитываем сессию. */
    fun reset() {
        if (_state.value.busy) return
        viewModelScope.launch {
            when (val result = repository.resetJokerSession()) {
                is ApiResult.Success -> _state.update {
                    it.copy(
                        messages = emptyList(),
                        load = UiState.Success(result.data.session),
                        notice = "История очищена",
                    )
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(notice = result.error.message ?: "Не удалось очистить историю")
                }
            }
        }
    }

    private fun replaceMessage(id: Long, transform: (ChatMessage) -> ChatMessage) {
        _state.update { current ->
            current.copy(messages = current.messages.map { if (it.id == id) transform(it) else it })
        }
    }
}
