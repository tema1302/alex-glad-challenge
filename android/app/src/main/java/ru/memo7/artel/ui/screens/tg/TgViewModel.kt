// ViewModel пяти Telegram-поверхностей (#145): топ сообщений топика, сбор топика
// (SSE), публикация в канал, история outbox и RAG-чат «Эволюция бота» (SSE).
// Все вызовы — через ArtelRepository; tg-методы (tgTop/tgCollect/telegramHistory/
// telegramPublish/evoluteAgent + cancelEvoluteStream) добавляются на интеграции.
// Ошибки провайдера маппятся в русские строки без URL/секретов и уходят в StateFlow.
package ru.memo7.artel.ui.screens.tg

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiError
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.EvoluteEvent
import ru.memo7.artel.data.api.EvoluteHistoryMessageDto
import ru.memo7.artel.data.api.TelegramHistoryResponse
import ru.memo7.artel.data.api.TelegramPublishError
import ru.memo7.artel.data.api.TgCollectEvent
import ru.memo7.artel.data.api.TgTopResponse
import ru.memo7.artel.ui.screens.assistant.ChatMessage

/** Клиентский предел текста поста — как на сервере (tgPublishSchema.text.max(4096)). */
private const val MAX_PUBLISH_LENGTH = 4096

/** Клиентский предел вопроса — как на сервере (evoluteAgentSchema.query.max(2000)). */
private const val MAX_EVOLUTE_INPUT_LENGTH = 2000

/** Клиентский предел истории — как на сервере (history max 20). */
private const val MAX_EVOLUTE_HISTORY = 20

/** Верхняя граница журнала сбора, чтобы прогресс-лог не рос бесконечно. */
private const val MAX_COLLECT_LOG_LINES = 200

/** Пустой топ до первого запроса: экран показывает empty-hint с подсказкой про chatKey. */
private val EMPTY_TOP = TgTopResponse()

data class TgTopSection(
    val load: UiState<TgTopResponse> = UiState.Success(EMPTY_TOP),
    val chatKey: String = "",
    val topicId: String = "",
    val by: String = "reactions",
)

data class TgCollectSection(
    val running: Boolean = false,
    val chatRef: String = "",
    val topicId: String = "",
    val limit: String = "",
    val reset: Boolean = false,
    val log: List<String> = emptyList(),
    val summary: TgCollectEvent.Done? = null,
    val error: String? = null,
)

data class TgHistorySection(
    val load: UiState<TelegramHistoryResponse> = UiState.Loading,
)

data class TgPublishSection(
    val text: String = "",
    // 'HTML' (default) | 'none' — серверный дефолт тот же.
    val parseMode: String = "HTML",
    val submitting: Boolean = false,
    val result: String? = null,
    val error: String? = null,
)

data class EvoluteSection(
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val notice: String? = null,
)

data class TgUiState(
    val top: TgTopSection = TgTopSection(),
    val collect: TgCollectSection = TgCollectSection(),
    val history: TgHistorySection = TgHistorySection(),
    val publish: TgPublishSection = TgPublishSection(),
    val evolute: EvoluteSection = EvoluteSection(),
)

class TgViewModel(
    private val repository: ArtelRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(TgUiState())
    val state: StateFlow<TgUiState> = _state.asStateFlow()

    private var nextMessageId = 1L

    /** История диалога эволюции в памяти VM — сервер хранит её в client (без DialogDb). */
    private val evoluteHistory = ArrayDeque<EvoluteHistoryMessageDto>()

    init {
        reloadHistory()
    }

    /* ---------- Топ сообщений ---------- */

    fun setTopChatKey(value: String) {
        _state.update { it.copy(top = it.top.copy(chatKey = value.take(200))) }
    }

    fun setTopTopicId(value: String) {
        _state.update { it.copy(top = it.top.copy(topicId = value.filter { ch -> ch.isDigit() }.take(10))) }
    }

    fun setTopBy(value: String) {
        if (value == "reactions" || value == "date") {
            _state.update { it.copy(top = it.top.copy(by = value)) }
        }
    }

    /** Параметры берутся из секции top: chatKey/topicId/limit/by; ошибка 400 = плохие параметры. */
    fun reloadTop(limit: Int = 20) {
        val section = _state.value.top
        val chatKey = section.chatKey.trim()
        if (chatKey.isEmpty()) {
            _state.update { it.copy(top = it.top.copy(load = UiState.Success(EMPTY_TOP))) }
            return
        }
        val topicId = section.topicId.toIntOrNull()
        val by = section.by
        _state.update { it.copy(top = it.top.copy(load = UiState.Loading)) }
        viewModelScope.launch {
            when (val result = repository.tgTop(chatKey, topicId, limit, by)) {
                is ApiResult.Success ->
                    _state.update { it.copy(top = it.top.copy(load = UiState.Success(result.data))) }
                is ApiResult.Failure ->
                    _state.update { it.copy(top = it.top.copy(load = UiState.Error(tgGenericErrorText(result.error)))) }
            }
        }
    }

    /* ---------- Сбор топика (SSE) ---------- */

    fun setCollectChatRef(value: String) {
        _state.update { it.copy(collect = it.collect.copy(chatRef = value.take(200))) }
    }

    fun setCollectTopicId(value: String) {
        _state.update { it.copy(collect = it.collect.copy(topicId = value.filter { ch -> ch.isDigit() }.take(10))) }
    }

    fun setCollectLimit(value: String) {
        _state.update { it.copy(collect = it.collect.copy(limit = value.filter { ch -> ch.isDigit() }.take(4))) }
    }

    fun setCollectReset(value: Boolean) {
        _state.update { it.copy(collect = it.collect.copy(reset = value)) }
    }

    /** Старт сбора: параметры из секции collect; повторный запуск заблокирован до конца стрима. */
    fun runCollect() {
        val section = _state.value.collect
        val chatRef = section.chatRef.trim()
        if (section.running || chatRef.isEmpty()) return
        val topicId = section.topicId.toIntOrNull()
        val limit = section.limit.toIntOrNull()
        _state.update {
            it.copy(
                collect = it.collect.copy(
                    running = true,
                    log = listOf("Сбор запущен…"),
                    summary = null,
                    error = null,
                ),
            )
        }
        viewModelScope.launch {
            var streamFailure: String? = null
            val streamResult = repository.tgCollect(chatRef, topicId, limit, section.reset) { event ->
                when (event) {
                    is TgCollectEvent.Stage -> appendCollectLog(collectStageLine(event))
                    is TgCollectEvent.Done ->
                        _state.update { st -> st.copy(collect = st.collect.copy(summary = event)) }
                    is TgCollectEvent.Failure -> streamFailure = event.message
                }
            }
            val networkError = (streamResult as? ApiResult.Failure)?.let { tgGenericErrorText(it.error) }
            _state.update {
                it.copy(collect = it.collect.copy(running = false, error = streamFailure ?: networkError))
            }
        }
    }

    private fun collectStageLine(event: TgCollectEvent.Stage): String {
        val detail = event.detail
        return when (event.step) {
            "start" -> buildString {
                append("Сбор начат")
                if (detail?.chatTitle != null) append(": ${detail.chatTitle}")
                if (detail?.topicId != null) append(" (топик ${detail.topicId})")
            }
            "progress" -> buildString {
                append("Прочитано сообщений: ${detail?.fetched ?: 0}")
                if (detail?.newlyInserted != null) append(", новых: ${detail.newlyInserted}")
            }
            else -> "Этап: ${event.step}"
        }
    }

    private fun appendCollectLog(line: String) {
        _state.update { current ->
            val log = (current.collect.log + line).takeLast(MAX_COLLECT_LOG_LINES)
            current.copy(collect = current.collect.copy(log = log))
        }
    }

    /* ---------- История outbox ---------- */

    fun reloadHistory(limit: Int = 20) {
        _state.update { it.copy(history = it.history.copy(load = UiState.Loading)) }
        viewModelScope.launch {
            when (val result = repository.telegramHistory(limit)) {
                is ApiResult.Success ->
                    _state.update { it.copy(history = it.history.copy(load = UiState.Success(result.data))) }
                is ApiResult.Failure ->
                    _state.update { it.copy(history = it.history.copy(load = UiState.Error(tgGenericErrorText(result.error)))) }
            }
        }
    }

    /* ---------- Публикация в канал ---------- */

    fun setPublishText(value: String) {
        _state.update { it.copy(publish = it.publish.copy(text = value.take(MAX_PUBLISH_LENGTH))) }
    }

    fun setPublishParseMode(value: String) {
        if (value == "HTML" || value == "none") {
            _state.update { it.copy(publish = it.publish.copy(parseMode = value)) }
        }
    }

    /** НЕ идемпотентен: экран обязан спросить подтверждение; двойной тап закрыт submitting-флагом. */
    fun submitPublish() {
        val section = _state.value.publish
        val text = section.text.trim()
        if (section.submitting || text.isEmpty() || text.length > MAX_PUBLISH_LENGTH) return
        _state.update {
            it.copy(publish = it.publish.copy(submitting = true, result = null, error = null))
        }
        viewModelScope.launch {
            when (val result = repository.telegramPublish(text, section.parseMode)) {
                is ApiResult.Success ->
                    _state.update {
                        it.copy(
                            publish = it.publish.copy(
                                submitting = false,
                                text = "",
                                result = "Пост опубликован (id сообщения: ${result.data.messageId})",
                            ),
                        )
                    }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(
                            publish = it.publish.copy(
                                submitting = false,
                                error = telegramPublishErrorText(result.error),
                            ),
                        )
                    }
            }
        }
    }

    /* ---------- Эволюция бота (SSE-чат) ---------- */

    fun sendEvolute(text: String) {
        val trimmed = text.trim()
        val section = _state.value.evolute
        if (section.busy || trimmed.isEmpty() || trimmed.length > MAX_EVOLUTE_INPUT_LENGTH) return
        val userMessage = ChatMessage(id = nextMessageId++, fromUser = true, text = trimmed)
        val assistantMessage = ChatMessage(id = nextMessageId++, fromUser = false, text = "", pending = true)
        _state.update {
            it.copy(
                evolute = it.evolute.copy(
                    messages = it.evolute.messages + userMessage + assistantMessage,
                    busy = true,
                    notice = null,
                ),
            )
        }
        viewModelScope.launch {
            val historySnapshot = evoluteHistory.toList()
            var accumulated = ""
            var streamAnswer: String? = null
            var streamFailure: String? = null
            val streamResult = repository.evoluteAgent(
                query = trimmed,
                history = historySnapshot,
                k = null,
                llm = null,
                noRag = false,
            ) { event ->
                when (event) {
                    is EvoluteEvent.Token -> {
                        accumulated += event.delta
                        replaceEvoluteMessage(assistantMessage.id) { it.copy(text = accumulated) }
                    }
                    is EvoluteEvent.Done -> streamAnswer = event.answer ?: accumulated
                    is EvoluteEvent.Failure -> streamFailure = event.message
                    is EvoluteEvent.Stage -> Unit // стадии пайплайна не рисуем — ответ это поток токенов
                }
            }
            val (finalText, isError) = when {
                streamFailure != null -> streamFailure.orEmpty() to true
                streamResult is ApiResult.Failure ->
                    tgGenericErrorText((streamResult as ApiResult.Failure).error) to true
                else -> (streamAnswer ?: accumulated).ifBlank { "Пустой ответ сервера" } to false
            }
            if (!isError) {
                evoluteHistory.addLast(EvoluteHistoryMessageDto(role = "user", content = trimmed))
                evoluteHistory.addLast(EvoluteHistoryMessageDto(role = "assistant", content = finalText))
                while (evoluteHistory.size > MAX_EVOLUTE_HISTORY) evoluteHistory.removeFirst()
            }
            replaceEvoluteMessage(assistantMessage.id) {
                it.copy(text = finalText, isError = isError, pending = false)
            }
            _state.update { it.copy(evolute = it.evolute.copy(busy = false)) }
        }
    }

    /** «Остановить»: обрываем сокет; сервер глушит LLM по req.signal, partial остаётся в пузыре. */
    fun stopEvolute() {
        repository.cancelEvoluteStream()
    }

    private fun replaceEvoluteMessage(id: Long, transform: (ChatMessage) -> ChatMessage) {
        _state.update { current ->
            current.copy(
                evolute = current.evolute.copy(
                    messages = current.evolute.messages.map { if (it.id == id) transform(it) else it },
                ),
            )
        }
    }
}

/**
 * Локализованный текст обычной сетевой/серверной ошибки — без URL, тел ответов
 * провайдера и секретов (Антиутечка: ApiError.Network несёт cause.message с хостами).
 */
internal fun tgGenericErrorText(error: ApiError): String = when (error) {
    is ApiError.Unauthorized -> "Сессия истекла. Войдите заново."
    is ApiError.Network -> "Сервер недоступен. Проверьте соединение."
    is ApiError.BadResponse -> error.message ?: "Некорректный ответ сервера"
    is ApiError.Server ->
        if (error.code == 400) "Параметры запроса отклонены сервером."
        else "Ошибка сервера (код ${error.code}). Повторите позже."
}

/**
 * Карта ошибок publish (ТЗ §7.4): errorKind + retryAfter из тела ошибки → русская строка.
 * Repository отдаёт ApiError.Server с человекочитаемым message, поэтому errorKind
 * ищем тремя способами: JSON тела, ключевые слова kind, русские тексты сервера;
 * дальше — по HTTP-коду (400/429/502). Никаких URL и токенов наружу.
 */
internal fun telegramPublishErrorText(error: ApiError): String = when (error) {
    is ApiError.Unauthorized -> "Сессия истекла. Войдите заново."
    is ApiError.Network -> "Не удалось связаться с сервером. Повторите позже."
    is ApiError.BadResponse -> error.message ?: "Не удалось опубликовать пост"
    is ApiError.Server -> telegramPublishServerText(error.code, error.message)
}

private val PUBLISH_ERROR_KINDS = listOf(
    "not-configured", "rate-limit", "unauthorized", "chat-not-found", "forbidden", "network", "unknown",
)

private fun telegramPublishServerText(code: Int, message: String?): String {
    val raw = message.orEmpty()
    val decoded = runCatching {
        ApiFactory.json.decodeFromString<TelegramPublishError>(raw)
    }.getOrNull()
    val kind = decoded?.errorKind
        ?: PUBLISH_ERROR_KINDS.firstOrNull { raw.contains(it) }
        ?: when {
            raw.contains("не настроен", ignoreCase = true) -> "not-configured"
            raw.contains("подождать", ignoreCase = true) -> "rate-limit"
            else -> null
        }
    val retryAfter = decoded?.retryAfter
        ?: Regex("подождите\\s+(\\d+)\\s+с", RegexOption.IGNORE_CASE)
            .find(raw)
            ?.groupValues
            ?.get(1)
            ?.toIntOrNull()
    return when (kind) {
        "not-configured" -> "Telegram-бот не настроен на сервере."
        "rate-limit" ->
            if (retryAfter != null) "Слишком много отправок. Подождите $retryAfter с и повторите."
            else "Слишком много отправок. Подождите минуту и повторите."
        "unauthorized" -> "Telegram отклонил авторизацию бота. Проверьте токен бота на сервере."
        "chat-not-found" -> "Канал не найден. Проверьте настройки Telegram на сервере."
        "forbidden" -> "Бот не имеет прав публиковать в этот канал."
        "network" -> "Не удалось связаться с Telegram. Повторите позже."
        else -> when (code) {
            400 -> "Telegram-бот не настроен на сервере."
            429 ->
                if (retryAfter != null) "Слишком много отправок. Подождите $retryAfter с и повторите."
                else "Слишком много отправок. Подождите минуту и повторите."
            502 -> "Telegram не смог опубликовать пост (авторизация, канал или сеть). Повторите позже."
            else -> "Не удалось опубликовать пост. Повторите позже."
        }
    }
}
