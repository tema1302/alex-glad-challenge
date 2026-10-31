package ru.memo7.artel.ui.screens.sys

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
import ru.memo7.artel.data.api.AdminServersResponse
import ru.memo7.artel.data.api.BriefingResponse
import ru.memo7.artel.data.api.SummaryPublishResponse
import ru.memo7.artel.data.api.SummaryResponse

/** Клиентский предел промпта — как agentSchema.prompt.max(8000) на сервере. */
internal const val MAX_AGENT_PROMPT_LENGTH = 8000

internal const val LLM_CLOUD = "cloud"
internal const val LLM_LOCAL = "local"

/** Один шот агента: последний запрос, ответ/ошибка, busy-гард от повторной отправки. */
data class AgentUiState(
    val busy: Boolean = false,
    val lastPrompt: String? = null,
    val answer: String? = null,
    val error: String? = null,
)

/** Сводка: загрузка текста + publishable; публикация с подтверждением снаружи (экран). */
data class SummaryUiState(
    val load: UiState<SummaryResponse> = UiState.Loading,
    val publishing: Boolean = false,
    val publishResult: String? = null,
    val publishError: String? = null,
)

/**
 * VM четырёх sys-поверхностей (эпик #134, #148): agent / briefing / summary / admin servers.
 * Экраны получают каждый свою область через отдельные StateFlow; загрузки ленивые —
 * экран сам зовёт load* при входе, чтобы агент не дёргал briefing/summary/servers.
 */
class SysViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _agent = MutableStateFlow(AgentUiState())
    val agent: StateFlow<AgentUiState> = _agent.asStateFlow()

    private val _briefing = MutableStateFlow<UiState<BriefingResponse>>(UiState.Loading)
    val briefing: StateFlow<UiState<BriefingResponse>> = _briefing.asStateFlow()

    private val _summary = MutableStateFlow(SummaryUiState())
    val summary: StateFlow<SummaryUiState> = _summary.asStateFlow()

    private val _servers = MutableStateFlow<UiState<AdminServersResponse>>(UiState.Loading)
    val servers: StateFlow<UiState<AdminServersResponse>> = _servers.asStateFlow()

    /* ---------- Agent ---------- */

    /** Stateless single-shot: сервер не хранит историю, каждый запрос — с нуля. */
    fun sendAgent(prompt: String, llm: String) {
        val trimmed = prompt.trim()
        if (_agent.value.busy || trimmed.isEmpty() || trimmed.length > MAX_AGENT_PROMPT_LENGTH) return
        _agent.update { it.copy(busy = true, lastPrompt = trimmed, answer = null, error = null) }
        viewModelScope.launch {
            when (val result = repository.agent(trimmed, llm)) {
                is ApiResult.Success -> {
                    val data = result.data
                    if (data.ok) {
                        _agent.update { it.copy(busy = false, answer = data.answer.ifBlank { "Пустой ответ сервера" }) }
                    } else {
                        _agent.update {
                            it.copy(busy = false, error = data.error ?: "Не удалось получить ответ")
                        }
                    }
                }
                is ApiResult.Failure -> _agent.update {
                    it.copy(busy = false, error = agentFailureText(result.error))
                }
            }
        }
    }

    /* ---------- Briefing ---------- */

    fun loadBriefing(chatKey: String? = null, topicId: Int? = null) {
        _briefing.value = UiState.Loading
        viewModelScope.launch {
            when (val result = repository.briefing(chatKey?.trim()?.ifBlank { null }, topicId)) {
                is ApiResult.Success -> _briefing.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    _briefing.value = UiState.Error(result.error.message ?: "Не удалось загрузить брифинг")
            }
        }
    }

    /* ---------- Summary ---------- */

    fun loadSummary() {
        _summary.update { it.copy(load = UiState.Loading, publishResult = null, publishError = null) }
        viewModelScope.launch {
            when (val result = repository.summary()) {
                is ApiResult.Success -> _summary.update { it.copy(load = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _summary.update {
                        it.copy(load = UiState.Error(result.error.message ?: "Не удалось загрузить сводку"))
                    }
            }
        }
    }

    /**
     * Публикация в канал — внешний эффект: экран обязан показать confirm-диалог до вызова.
     * Двойной тап отсекается busy-гардом; сервер дополнительно гейтит in-memory rate-limit.
     */
    fun publishSummary() {
        val current = _summary.value
        if (current.publishing) return
        val loaded = (current.load as? UiState.Success)?.data
        if (loaded == null || !loaded.publishable) return
        _summary.update { it.copy(publishing = true, publishResult = null, publishError = null) }
        viewModelScope.launch {
            when (val result = repository.publishSummary()) {
                is ApiResult.Success -> {
                    val data = result.data
                    if (data.ok && data.messageId != null) {
                        _summary.update {
                            it.copy(publishing = false, publishResult = "Сводка опубликована (сообщение #${data.messageId})")
                        }
                    } else {
                        _summary.update {
                            it.copy(
                                publishing = false,
                                publishError = summaryPublishKindText(data.errorKind, null, data.retryAfter)
                                    ?: data.error
                                    ?: "Не удалось опубликовать сводку",
                            )
                        }
                    }
                }
                is ApiResult.Failure -> _summary.update {
                    it.copy(publishing = false, publishError = summaryPublishErrorText(result.error))
                }
            }
        }
    }

    /* ---------- Admin servers ---------- */

    /** Админ-раздел не обходится клиентом: показываем данные сервера, 401 уйдёт в авто-логаут. */
    fun loadServers() {
        _servers.value = UiState.Loading
        viewModelScope.launch {
            when (val result = repository.adminServers()) {
                is ApiResult.Success -> _servers.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    _servers.value = UiState.Error(result.error.message ?: "Не удалось загрузить статусы серверов")
            }
        }
    }
}

/* ---------- Локализация ошибок (без URL, тел ответов и секретов) ---------- */

/** Обычная ошибка агента: 400/502 сервер уже человекочитаемым safeMessage отдаёт. */
private fun agentFailureText(error: ApiError): String = when (error) {
    is ApiError.Unauthorized -> "Сессия истекла. Войдите заново."
    is ApiError.Network -> "Сервер недоступен. Проверьте соединение."
    is ApiError.BadResponse -> error.message ?: "Некорректный ответ сервера"
    is ApiError.Server -> "Не удалось получить ответ: ${error.message}"
}

/**
 * Карта ошибок публикации сводки (ТЗ §7.4): errorKind + retryAfter → русская строка.
 * Repository отдаёт ApiError.Server с человекочитаемым message, поэтому errorKind ищем
 * тремя способами: JSON тела, ключевые слова kind, русские тексты сервера; дальше —
 * по HTTP-коду (400/429/502). Никаких URL и токенов наружу.
 */
internal fun summaryPublishErrorText(error: ApiError): String = when (error) {
    is ApiError.Unauthorized -> "Сессия истекла. Войдите заново."
    is ApiError.Network -> "Не удалось связаться с сервером. Повторите позже."
    is ApiError.BadResponse -> error.message ?: "Не удалось опубликовать сводку"
    is ApiError.Server -> summaryPublishServerText(error.code, error.message)
}

private val SUMMARY_ERROR_KINDS = listOf(
    "not-configured", "rate-limit", "unauthorized", "chat-not-found", "forbidden", "network", "unknown",
)

private fun summaryPublishServerText(code: Int, message: String?): String {
    val raw = message.orEmpty()
    val decoded = runCatching {
        ApiFactory.json.decodeFromString<SummaryPublishResponse>(raw)
    }.getOrNull()
    val kind = decoded?.errorKind
        ?: SUMMARY_ERROR_KINDS.firstOrNull { raw.contains(it) }
        ?: when {
            raw.contains("не настроен", ignoreCase = true) -> "not-configured"
            raw.contains("подождать", ignoreCase = true) ||
                raw.contains("подождите", ignoreCase = true) -> "rate-limit"
            else -> null
        }
    val retryAfter = decoded?.retryAfter
        ?: Regex("""(\d+)\s*с""").find(raw)?.groupValues?.get(1)?.toIntOrNull()
    return summaryPublishKindText(kind, code, retryAfter)
        ?: "Не удалось опубликовать сводку. Повторите позже."
}

/** Известный kind → русская строка; null — развернуть fallback по HTTP-коду. */
internal fun summaryPublishKindText(kind: String?, code: Int?, retryAfter: Int?): String? = when (kind) {
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
        502 -> "Telegram не смог опубликовать сводку (авторизация, канал или сеть). Повторите позже."
        else -> null
    }
}
