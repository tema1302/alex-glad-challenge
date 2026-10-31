package ru.memo7.artel.ui.screens.integrations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.CreateInboundHookRequest
import ru.memo7.artel.data.api.CreateWebhookRequest
import ru.memo7.artel.data.api.InboundHooksResponse
import ru.memo7.artel.data.api.WebhooksResponse

internal const val MAX_WEBHOOK_NAME_LENGTH = 120
internal const val MAX_WEBHOOK_URL_LENGTH = 2000
internal const val MAX_WEBHOOK_SECRET_LENGTH = 200
internal const val MAX_WEBHOOK_EVENTS = 20
internal const val MAX_INBOUND_NAME_LENGTH = 120

/** События, на которые сервер разрешает подписать вебхук (синхронно с web). */
internal val WEBHOOK_EVENTS = listOf("post_published", "todo_completed", "automation_run")

/** Допустимые цели входящего хука: 'notification' | 'todo'. */
internal val INBOUND_TARGETS = listOf("notification", "todo")

internal fun isValidWebhookUrl(url: String): Boolean =
    url.length <= MAX_WEBHOOK_URL_LENGTH &&
        (url.startsWith("https://") || url.startsWith("http://"))

/** Результат создания inbound-хука: секрет живёт только здесь, до закрытия диалога. */
data class CreatedInboundHook(
    val id: Long,
    val url: String,
    val secret: String,
)

data class IntegrationsUiState(
    val webhooks: UiState<WebhooksResponse> = UiState.Loading,
    val inbound: UiState<InboundHooksResponse> = UiState.Loading,
    val webhookForm: WebhookFormState = WebhookFormState.Idle,
    val inboundForm: InboundFormState = InboundFormState.Idle,
    // Transient: стирается dismissCreatedInbound() при закрытии диалога. Никуда не сохраняется.
    val createdInbound: CreatedInboundHook? = null,
)

sealed interface WebhookFormState {
    data object Idle : WebhookFormState
    data object Busy : WebhookFormState
    data class Failure(val message: String) : WebhookFormState
    data object Done : WebhookFormState
}

sealed interface InboundFormState {
    data object Idle : InboundFormState
    data object Busy : InboundFormState
    data class Failure(val message: String) : InboundFormState
    data object Done : InboundFormState
}

class IntegrationsViewModel(
    private val repository: ArtelRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(IntegrationsUiState())
    val state: StateFlow<IntegrationsUiState> = _state.asStateFlow()

    /** Одноразовые сообщения для snackbar-хоста (удаление, сбои перечитывания). */
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    init { load() }

    fun load() {
        _state.update { it.copy(webhooks = UiState.Loading, inbound = UiState.Loading) }
        viewModelScope.launch {
            when (val result = repository.webhooks()) {
                is ApiResult.Success -> _state.update { it.copy(webhooks = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _state.update { it.copy(webhooks = UiState.Error(result.error.message ?: "Не удалось загрузить вебхуки")) }
            }
            when (val result = repository.inboundHooks()) {
                is ApiResult.Success -> _state.update { it.copy(inbound = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _state.update { it.copy(inbound = UiState.Error(result.error.message ?: "Не удалось загрузить inbound-хуки")) }
            }
        }
    }

    /** Локальная валидация до сети (паритет с серверным zod). */
    fun validateWebhook(name: String, url: String, secret: String, events: List<String>): String? {
        val trimmedName = name.trim()
        if (trimmedName.isEmpty()) return "Введите название"
        if (trimmedName.length > MAX_WEBHOOK_NAME_LENGTH) return "Название слишком длинное (максимум $MAX_WEBHOOK_NAME_LENGTH символов)"
        if (!isValidWebhookUrl(url.trim())) return "URL должен начинаться с http:// или https://"
        if (secret.isNotEmpty() && secret.length > MAX_WEBHOOK_SECRET_LENGTH)
            return "Секрет слишком длинный (максимум $MAX_WEBHOOK_SECRET_LENGTH символов)"
        if (events.size > MAX_WEBHOOK_EVENTS) return "Слишком много событий (максимум $MAX_WEBHOOK_EVENTS)"
        if (events.any { it !in WEBHOOK_EVENTS }) return "Неизвестное событие вебхука"
        return null
    }

    fun createWebhook(name: String, url: String, secret: String, events: List<String>) {
        if (_state.value.webhookForm is WebhookFormState.Busy) return
        val validationError = validateWebhook(name, url, secret, events)
        if (validationError != null) {
            _state.update { it.copy(webhookForm = WebhookFormState.Failure(validationError)) }
            return
        }
        val trimmedSecret = secret.trim()
        _state.update { it.copy(webhookForm = WebhookFormState.Busy) }
        viewModelScope.launch {
            when (
                val result = repository.createWebhook(
                    CreateWebhookRequest(
                        name = name.trim(),
                        url = url.trim(),
                        secret = trimmedSecret.ifEmpty { null },
                        events = events,
                    )
                )
            ) {
                is ApiResult.Success -> {
                    _state.update { it.copy(webhookForm = WebhookFormState.Done) }
                    reloadWebhooks()
                }
                is ApiResult.Failure ->
                    _state.update { it.copy(webhookForm = WebhookFormState.Failure(result.error.message ?: "Не удалось создать вебхук")) }
            }
        }
    }

    fun deleteWebhook(id: Long) {
        viewModelScope.launch {
            when (val result = repository.deleteWebhook(id)) {
                is ApiResult.Success -> reloadWebhooks()
                is ApiResult.Failure -> _messages.send(result.error.message ?: "Не удалось удалить вебхук")
            }
        }
    }

    fun validateInbound(name: String, target: String): String? {
        val trimmedName = name.trim()
        if (trimmedName.isEmpty()) return "Введите название"
        if (trimmedName.length > MAX_INBOUND_NAME_LENGTH) return "Название слишком длинное (максимум $MAX_INBOUND_NAME_LENGTH символов)"
        if (target !in INBOUND_TARGETS) return "Неизвестная цель хука"
        return null
    }

    fun createInbound(name: String, target: String) {
        if (_state.value.inboundForm is InboundFormState.Busy) return
        val validationError = validateInbound(name, target)
        if (validationError != null) {
            _state.update { it.copy(inboundForm = InboundFormState.Failure(validationError)) }
            return
        }
        _state.update { it.copy(inboundForm = InboundFormState.Busy) }
        viewModelScope.launch {
            when (val result = repository.createInboundHook(CreateInboundHookRequest(name = name.trim(), target = target))) {
                is ApiResult.Success -> {
                    // Секрет — только в transient-стейт; после закрытия диалога стирается.
                    _state.update {
                        it.copy(
                            inboundForm = InboundFormState.Done,
                            createdInbound = CreatedInboundHook(
                                id = result.data.id,
                                url = result.data.url,
                                secret = result.data.secret,
                            ),
                        )
                    }
                    reloadInbound()
                }
                is ApiResult.Failure ->
                    _state.update { it.copy(inboundForm = InboundFormState.Failure(result.error.message ?: "Не удалось создать хук")) }
            }
        }
    }

    fun deleteInbound(id: Long) {
        viewModelScope.launch {
            when (val result = repository.deleteInboundHook(id)) {
                is ApiResult.Success -> reloadInbound()
                is ApiResult.Failure -> _messages.send(result.error.message ?: "Не удалось удалить хук")
            }
        }
    }

    /** Закрытие диалога «Сохраните секрет»: стирает секрет из состояния. */
    fun dismissCreatedInbound() {
        _state.update { it.copy(createdInbound = null) }
    }

    fun resetWebhookForm() {
        _state.update { it.copy(webhookForm = WebhookFormState.Idle) }
    }

    fun resetInboundForm() {
        _state.update { it.copy(inboundForm = InboundFormState.Idle) }
    }

    private suspend fun reloadWebhooks() {
        when (val result = repository.webhooks()) {
            is ApiResult.Success -> _state.update { it.copy(webhooks = UiState.Success(result.data)) }
            // Список в фоне не роняем: создание прошло, покажем snackbar.
            is ApiResult.Failure -> _messages.send(result.error.message ?: "Не удалось обновить вебхуки")
        }
    }

    private suspend fun reloadInbound() {
        when (val result = repository.inboundHooks()) {
            is ApiResult.Success -> _state.update { it.copy(inbound = UiState.Success(result.data)) }
            is ApiResult.Failure -> _messages.send(result.error.message ?: "Не удалось обновить inbound-хуки")
        }
    }
}
