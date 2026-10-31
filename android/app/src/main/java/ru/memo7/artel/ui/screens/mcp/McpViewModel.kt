package ru.memo7.artel.ui.screens.mcp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.McpCallResponse
import ru.memo7.artel.data.api.McpToolsResponse

/**
 * Локальная валидация args вызова MCP до сети: пустой ввод — пустой объект,
 * валидный не-объект (массив/строка/число) и битый JSON — ошибки «Проверьте JSON».
 */
object McpArgsValidator {

    sealed interface Result {
        /** args готовы к отправке; пустой ввод — пустой объект `{}`. */
        data class Ok(val args: JsonObject) : Result

        /** Локальная ошибка валидации — вызов не должен уходить в сеть. */
        data class Invalid(val message: String) : Result
    }

    private val json = ApiFactory.json

    fun parse(raw: String): Result {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return Result.Ok(JsonObject(emptyMap()))
        return try {
            when (val element = json.parseToJsonElement(trimmed)) {
                is JsonObject -> Result.Ok(element)
                else -> Result.Invalid("Проверьте JSON: аргументы должны быть объектом {...}")
            }
        } catch (e: SerializationException) {
            Result.Invalid("Проверьте JSON: синтаксическая ошибка")
        }
    }
}

/** Состояние панели вызова: выбранный инструмент, busy, локальная ошибка args, результат/ошибка вызова. */
data class McpCallState(
    val tool: String? = null,
    val busy: Boolean = false,
    val argsError: String? = null,
    val result: String? = null,
    val error: String? = null,
)

class McpViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _tools = MutableStateFlow<UiState<McpToolsResponse>>(UiState.Loading)
    val tools: StateFlow<UiState<McpToolsResponse>> = _tools.asStateFlow()

    private val _callState = MutableStateFlow(McpCallState())
    val callState: StateFlow<McpCallState> = _callState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _tools.value = UiState.Loading
        viewModelScope.launch {
            when (val result = repository.mcpTools()) {
                is ApiResult.Success -> _tools.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    _tools.value = UiState.Error(result.error.message ?: "Не удалось загрузить инструменты")
            }
        }
    }

    /** Тап по карточке: выбор инструмента; результат прошлого вызова сбрасывается. */
    fun selectTool(name: String) {
        _callState.value = McpCallState(tool = name)
    }

    fun clearSelection() {
        _callState.value = McpCallState()
    }

    /** Живая валидация по мере ввода — ошибка parse без сетевого вызова. */
    fun onArgsChanged(raw: String) {
        val parsed = McpArgsValidator.parse(raw)
        _callState.update {
            it.copy(argsError = (parsed as? McpArgsValidator.Result.Invalid)?.message)
        }
    }

    fun call(tool: String, argsRaw: String) {
        if (_callState.value.busy || tool.isBlank()) return
        when (val parsed = McpArgsValidator.parse(argsRaw)) {
            is McpArgsValidator.Result.Invalid ->
                _callState.update { it.copy(argsError = parsed.message) }
            is McpArgsValidator.Result.Ok -> {
                _callState.update {
                    it.copy(
                        tool = tool,
                        busy = true,
                        argsError = null,
                        result = null,
                        error = null,
                    )
                }
                viewModelScope.launch {
                    when (val result = repository.mcpCall(tool, parsed.args)) {
                        is ApiResult.Success -> _callState.update { applyResponse(it, result.data) }
                        is ApiResult.Failure ->
                            _callState.update {
                                it.copy(busy = false, error = result.error.message ?: "Не удалось вызвать инструмент")
                            }
                    }
                }
            }
        }
    }

    /** 200 всегда декодируется в McpCallResponse: ok:true — результат, ok:false — ошибка MCP-сервера. */
    private fun applyResponse(state: McpCallState, data: McpCallResponse): McpCallState =
        if (data.ok) {
            state.copy(busy = false, result = data.result ?: "")
        } else {
            state.copy(busy = false, error = data.error ?: "Инструмент вернул ошибку")
        }
}
