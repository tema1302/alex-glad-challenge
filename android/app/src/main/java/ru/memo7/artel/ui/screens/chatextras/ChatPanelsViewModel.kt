// ViewModel панелей чата (memory/branch/profile/constraints) для выбранной
// сессии. Каждая панель — свой UiState + notice; обязательные поля проверяются
// локально ДО сети (ChatExtrasValidator) с русскими подсказками. После успешного
// branch switch вызывается onBranchesChanged — экран чата снаружи перезагружает
// историю (orchestrator подключает колбэк).
package ru.memo7.artel.ui.screens.chatextras

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.BranchActionRequest
import ru.memo7.artel.data.api.BranchViewDto
import ru.memo7.artel.data.api.ConstraintsActionRequest
import ru.memo7.artel.data.api.ConstraintsViewDto
import ru.memo7.artel.data.api.MemoryActionRequest
import ru.memo7.artel.data.api.MemoryViewDto
import ru.memo7.artel.data.api.ProfileActionRequest
import ru.memo7.artel.data.api.ProfileViewDto

/* ---------- Локальная валидация (чистые функции, без сети) ---------- */

/**
 * Обязательные поля по контрактам POST memory и POST constraints. Возвращает
 * null, если запрос валиден, либо русскую подсказку — её показываем как notice,
 * сеть не трогаем.
 */
object ChatExtrasValidator {

    private const val MEMORY_KEY_MAX = 200
    private const val MEMORY_VALUE_MAX = 2000
    private const val MEMORY_DESCRIPTION_MAX = 2000
    private const val CONSTRAINT_TITLE_MAX = 200
    private const val CONSTRAINT_DESCRIPTION_MAX = 2000
    private const val CONSTRAINT_ID_MAX = 100

    private val constraintTypes = setOf("architecture", "tech_decision", "stack", "business", "custom")

    fun validateMemoryAction(request: MemoryActionRequest): String? = when (request.action) {
        "remember" -> requireKey(request.key) ?: requireValue(request.value)
        "forget" -> requireKey(request.key)
        "task" -> requireDescription(request.description)
        "task-add" -> requireKey(request.key) ?: requireValue(request.value)
        "fact-rm" -> requireKey(request.key)
        "on", "off", "task-clear" -> null
        else -> "Неизвестное действие памяти: ${request.action}"
    }

    /** add: type из enum + title 1..200 (description ≤2000 опционален); rm: id 1..100. */
    fun validateConstraintsAction(request: ConstraintsActionRequest): String? = when (request.action) {
        "add" -> {
            val type = request.type?.trim().orEmpty()
            if (type !in constraintTypes) {
                "Выберите тип ограничения"
            } else {
                validateTitle(request.title) ?: validateDescription(request.description)
            }
        }
        "rm" -> {
            val id = request.id?.trim().orEmpty()
            when {
                id.isEmpty() -> "Укажите id ограничения"
                id.length > CONSTRAINT_ID_MAX -> "id слишком длинный: максимум $CONSTRAINT_ID_MAX знаков"
                else -> null
            }
        }
        else -> "Неизвестное действие ограничений: ${request.action}"
    }

    private fun requireKey(key: String?): String? {
        val value = key?.trim().orEmpty()
        return when {
            value.isEmpty() -> "Укажите ключ"
            value.length > MEMORY_KEY_MAX -> "Ключ слишком длинный: максимум $MEMORY_KEY_MAX знаков"
            else -> null
        }
    }

    private fun requireValue(value: String?): String? {
        val v = value?.trim().orEmpty()
        return when {
            v.isEmpty() -> "Укажите значение"
            v.length > MEMORY_VALUE_MAX -> "Значение слишком длинное: максимум $MEMORY_VALUE_MAX знаков"
            else -> null
        }
    }

    private fun requireDescription(description: String?): String? {
        val v = description?.trim().orEmpty()
        return when {
            v.isEmpty() -> "Укажите описание задачи"
            v.length > MEMORY_DESCRIPTION_MAX -> "Описание слишком длинное: максимум $MEMORY_DESCRIPTION_MAX знаков"
            else -> null
        }
    }

    private fun validateTitle(title: String?): String? {
        val v = title?.trim().orEmpty()
        return when {
            v.isEmpty() -> "Укажите название"
            v.length > CONSTRAINT_TITLE_MAX -> "Название слишком длинное: максимум $CONSTRAINT_TITLE_MAX знаков"
            else -> null
        }
    }

    private fun validateDescription(description: String?): String? {
        val v = description?.trim().orEmpty()
        return if (v.length > CONSTRAINT_DESCRIPTION_MAX) {
            "Описание слишком длинное: максимум $CONSTRAINT_DESCRIPTION_MAX знаков"
        } else null
    }
}

/* ---------- UI state ---------- */

data class ChatPanelsUiState(
    val memory: UiState<MemoryViewDto> = UiState.Loading,
    val branches: UiState<BranchViewDto> = UiState.Loading,
    val profile: UiState<ProfileViewDto> = UiState.Loading,
    val constraints: UiState<ConstraintsViewDto> = UiState.Loading,
    val memoryNotice: String? = null,
    val branchNotice: String? = null,
    val profileNotice: String? = null,
    val constraintsNotice: String? = null,
    val memoryBusy: Boolean = false,
    val branchBusy: Boolean = false,
    val profileBusy: Boolean = false,
    val constraintsBusy: Boolean = false,
)

class ChatPanelsViewModel(
    private val repository: ArtelRepository,
    private val sessionId: String,
    private val onBranchesChanged: () -> Unit = {},
) : ViewModel() {

    private val _state = MutableStateFlow(ChatPanelsUiState())
    val state: StateFlow<ChatPanelsUiState> = _state.asStateFlow()

    init {
        loadAll()
    }

    fun loadAll() {
        loadMemory()
        loadBranches()
        loadProfile()
        loadConstraints()
    }

    fun loadMemory() {
        _state.update { it.copy(memory = UiState.Loading, memoryNotice = null) }
        viewModelScope.launch {
            when (val result = repository.chatMemory(sessionId)) {
                is ApiResult.Success ->
                    _state.update { it.copy(memory = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(memory = UiState.Error(result.error.message ?: "Не удалось загрузить память"))
                    }
            }
        }
    }

    fun loadBranches() {
        _state.update { it.copy(branches = UiState.Loading, branchNotice = null) }
        viewModelScope.launch {
            when (val result = repository.chatBranches(sessionId)) {
                is ApiResult.Success ->
                    _state.update { it.copy(branches = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(branches = UiState.Error(result.error.message ?: "Не удалось загрузить ветки"))
                    }
            }
        }
    }

    fun loadProfile() {
        _state.update { it.copy(profile = UiState.Loading, profileNotice = null) }
        viewModelScope.launch {
            when (val result = repository.chatProfile(sessionId)) {
                is ApiResult.Success ->
                    _state.update { it.copy(profile = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(profile = UiState.Error(result.error.message ?: "Не удалось загрузить профили"))
                    }
            }
        }
    }

    fun loadConstraints() {
        _state.update { it.copy(constraints = UiState.Loading, constraintsNotice = null) }
        viewModelScope.launch {
            when (val result = repository.constraints()) {
                is ApiResult.Success ->
                    _state.update { it.copy(constraints = UiState.Success(result.data)) }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(constraints = UiState.Error(result.error.message ?: "Не удалось загрузить ограничения"))
                    }
            }
        }
    }

    /** Любое действие памяти: локальная валидация → POST → view из ответа. */
    fun memoryAction(request: MemoryActionRequest) {
        if (_state.value.memoryBusy) return
        val error = ChatExtrasValidator.validateMemoryAction(request)
        if (error != null) {
            _state.update { it.copy(memoryNotice = error) }
            return
        }
        _state.update { it.copy(memoryBusy = true, memoryNotice = null) }
        viewModelScope.launch {
            when (val result = repository.chatMemoryAction(sessionId, request)) {
                is ApiResult.Success ->
                    _state.update {
                        it.copy(memoryBusy = false, memory = UiState.Success(result.data.view))
                    }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(
                            memoryBusy = false,
                            memoryNotice = result.error.message ?: "Действие не выполнено",
                        )
                    }
            }
        }
    }

    /** Чекпоинт — снапшот, НЕ переключает ветку; колбэк не дергаем. */
    fun branchCheckpoint(label: String) {
        if (_state.value.branchBusy) return
        val trimmed = label.trim()
        if (trimmed.isEmpty()) {
            _state.update { it.copy(branchNotice = "Укажите название чекпоинта") }
            return
        }
        if (trimmed.length > BRANCH_LABEL_MAX) {
            _state.update {
                it.copy(branchNotice = "Название слишком длинное: максимум $BRANCH_LABEL_MAX знаков")
            }
            return
        }
        _state.update { it.copy(branchBusy = true, branchNotice = null) }
        viewModelScope.launch {
            val request = BranchActionRequest(action = "checkpoint", label = trimmed)
            when (val result = repository.chatBranchAction(sessionId, request)) {
                is ApiResult.Success ->
                    _state.update {
                        it.copy(
                            branchBusy = false,
                            branches = UiState.Success(result.data.view),
                            branchNotice = "Чекпоинт создан",
                        )
                    }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(
                            branchBusy = false,
                            branchNotice = result.error.message ?: "Не удалось создать чекпоинт",
                        )
                    }
            }
        }
    }

    /** Switch меняет активную ветку — снаружи перезагружаем экран чата. */
    fun branchSwitch(id: Int) {
        if (_state.value.branchBusy) return
        if (id < 0) {
            _state.update { it.copy(branchNotice = "Некорректный id ветки") }
            return
        }
        _state.update { it.copy(branchBusy = true, branchNotice = null) }
        viewModelScope.launch {
            val request = BranchActionRequest(action = "switch", id = id)
            when (val result = repository.chatBranchAction(sessionId, request)) {
                is ApiResult.Success -> {
                    _state.update {
                        it.copy(
                            branchBusy = false,
                            branches = UiState.Success(result.data.view),
                            branchNotice = "Ветка переключена",
                        )
                    }
                    onBranchesChanged()
                }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(
                            branchBusy = false,
                            branchNotice = result.error.message ?: "Не удалось переключить ветку",
                        )
                    }
            }
        }
    }

    /** Действие профиля: use|edit|new|copy|delete|reset|note. edit/note — асинхронные (LLM). */
    fun profileAction(request: ProfileActionRequest) {
        if (_state.value.profileBusy) return
        val error = validateProfileAction(request)
        if (error != null) {
            _state.update { it.copy(profileNotice = error) }
            return
        }
        _state.update { it.copy(profileBusy = true, profileNotice = null) }
        viewModelScope.launch {
            when (val result = repository.chatProfileAction(sessionId, request)) {
                is ApiResult.Success ->
                    _state.update {
                        it.copy(
                            profileBusy = false,
                            profile = UiState.Success(result.data.view),
                            profileNotice = result.data.summary,
                        )
                    }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(
                            profileBusy = false,
                            profileNotice = result.error.message ?: "Действие не выполнено",
                        )
                    }
            }
        }
    }

    /** add/rm ограничений: локальная валидация → POST → view из ответа. */
    fun constraintsAction(request: ConstraintsActionRequest) {
        if (_state.value.constraintsBusy) return
        val error = ChatExtrasValidator.validateConstraintsAction(request)
        if (error != null) {
            _state.update { it.copy(constraintsNotice = error) }
            return
        }
        _state.update { it.copy(constraintsBusy = true, constraintsNotice = null) }
        viewModelScope.launch {
            when (val result = repository.constraintsAction(request)) {
                is ApiResult.Success ->
                    _state.update {
                        it.copy(constraintsBusy = false, constraints = UiState.Success(result.data.view))
                    }
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(
                            constraintsBusy = false,
                            constraintsNotice = result.error.message ?: "Действие не выполнено",
                        )
                    }
            }
        }
    }

    private fun validateProfileAction(request: ProfileActionRequest): String? {
        fun nameError(value: String?, required: Boolean): String? {
            val v = value?.trim().orEmpty()
            return when {
                v.isEmpty() -> if (required) "Укажите имя профиля" else null
                v.length > PROFILE_NAME_MAX -> "Имя слишком длинное: максимум $PROFILE_NAME_MAX знаков"
                else -> null
            }
        }
        return when (request.action) {
            "use", "delete" -> nameError(request.name, required = true)
            "new" -> nameError(request.name, required = true)
            "copy" -> nameError(request.name, required = true)
                ?: nameError(request.base, required = true)?.let { "Укажите исходный профиль" }
            "edit" -> nameError(request.name, required = true)
                ?: if (request.instruction?.trim().orEmpty().isEmpty()) "Укажите инструкцию" else null
            "note" -> if (request.text?.trim().orEmpty().isEmpty()) "Введите текст заметки" else null
            "reset" -> null
            else -> "Неизвестное действие профиля: ${request.action}"
        }
    }

    private companion object {
        const val BRANCH_LABEL_MAX = 100
        const val PROFILE_NAME_MAX = 100
    }
}
