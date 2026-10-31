// ViewModel Антонова (web /antonov): rewrite (один пост) и thread (список постов).
// Оба endpoint'а НЕ стримятся; ошибки 429/502/503 маппятся в русские строки.
// Обязательные поля проверяются локально ДО сети с русскими подсказками.
package ru.memo7.artel.ui.screens.chatextras

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.network.ApiError
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.AntonovRewriteRequest
import ru.memo7.artel.data.api.AntonovThreadRequest

/** Клиентский предел текста — как на сервере (antonovSchema.text 1..15000). */
internal const val ANTONOV_MAX_TEXT_LENGTH = 15000

internal const val ANTONOV_MAX_AUTHOR_LENGTH = 120
internal const val ANTONOV_MAX_SOURCE_LENGTH = 300
internal const val ANTONOV_MAX_IMAGES = 12

data class AntonovUiState(
    val busy: Boolean = false,
    val notice: String? = null,
    val rewritePost: String? = null,
    val rewriteProvider: String? = null,
    val threadPosts: List<String> = emptyList(),
    val threadProvider: String? = null,
)

class AntonovViewModel(
    private val repository: ArtelRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(AntonovUiState())
    val state: StateFlow<AntonovUiState> = _state.asStateFlow()

    fun rewrite(
        text: String,
        mode: String?,
        format: String?,
        signature: Boolean,
        llm: String?,
    ) {
        val trimmed = text.trim()
        if (_state.value.busy) return
        val validationError = validateAntonovText(trimmed)
        if (validationError != null) {
            _state.update { it.copy(notice = validationError) }
            return
        }
        _state.update { it.copy(busy = true, notice = null, rewritePost = null, rewriteProvider = null) }
        viewModelScope.launch {
            val request = AntonovRewriteRequest(
                text = trimmed,
                mode = mode,
                format = format,
                signature = if (signature) true else null,
                llm = llm,
            )
            when (val result = repository.antonovRewrite(request)) {
                is ApiResult.Success -> {
                    val response = result.data
                    if (response.ok) {
                        _state.update {
                            it.copy(
                                busy = false,
                                rewritePost = response.post,
                                rewriteProvider = response.provider,
                            )
                        }
                    } else {
                        _state.update {
                            it.copy(busy = false, notice = response.error ?: "Не удалось переписать текст")
                        }
                    }
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(busy = false, notice = antonovErrorMessage(result.error))
                }
            }
        }
    }

    fun thread(
        text: String,
        author: String,
        source: String,
        mode: String?,
        llm: String?,
    ) {
        val trimmed = text.trim()
        if (_state.value.busy) return
        val validationError = validateAntonovText(trimmed)
            ?: validateLength("Автор", author.trim(), ANTONOV_MAX_AUTHOR_LENGTH)
            ?: validateLength("Источник", source.trim(), ANTONOV_MAX_SOURCE_LENGTH)
        if (validationError != null) {
            _state.update { it.copy(notice = validationError) }
            return
        }
        _state.update { it.copy(busy = true, notice = null, threadPosts = emptyList(), threadProvider = null) }
        viewModelScope.launch {
            val request = AntonovThreadRequest(
                text = trimmed,
                author = author.trim(),
                source = source.trim(),
                mode = mode,
                llm = llm,
            )
            when (val result = repository.antonovThread(request)) {
                is ApiResult.Success -> {
                    val response = result.data
                    if (response.ok) {
                        _state.update {
                            it.copy(
                                busy = false,
                                threadPosts = response.posts,
                                threadProvider = response.provider,
                            )
                        }
                    } else {
                        _state.update {
                            it.copy(busy = false, notice = response.error ?: "Не удалось собрать тред")
                        }
                    }
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(busy = false, notice = antonovErrorMessage(result.error))
                }
            }
        }
    }

    fun clearNotice() {
        _state.update { it.copy(notice = null) }
    }

    private fun validateAntonovText(text: String): String? = when {
        text.isEmpty() -> "Введите текст"
        text.length > ANTONOV_MAX_TEXT_LENGTH ->
            "Текст слишком длинный: максимум $ANTONOV_MAX_TEXT_LENGTH знаков"
        else -> null
    }

    private fun validateLength(field: String, value: String, max: Int): String? =
        if (value.length > max) "$field слишком длинный: максимум $max знаков" else null
}

/**
 * 429/502/503 маппятся в фиксированные русские строки: точный retryAfterSec до
 * VM не доходит (ApiError.Server несёт только код и сообщение), поэтому даём
 * детерминированную подсказку по коду; прочие ошибки показываем как есть.
 */
internal fun antonovErrorMessage(error: ApiError): String = when (error) {
    is ApiError.Server -> when (error.code) {
        429 -> "Слишком много запросов — попробуйте снова через несколько минут."
        502 -> "Не удалось получить ответ от модели (502). Попробуйте ещё раз."
        503 -> "LLM не настроен: задайте облачный ключ или поднимите локальную модель."
        else -> error.message ?: "Ошибка сервера"
    }
    else -> error.message ?: "Сетевая ошибка"
}
