// ViewModels конвейера RAG (web /api/rag/*): свободный запрос, диалоги базы знаний,
// алиасы TG-чатов, индексация партиций, заметки. Стримы идут через repository.sseStream
// (path + raw-json body; события — сырые JSON → RagSseParser.parse), отмена — Job.cancel().
// Ошибки и статусы наружу — через notice/stage в StateFlow, без println/Log.
package ru.memo7.artel.ui.screens.rag

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.RagAliasDto
import ru.memo7.artel.data.api.RagChatDetailResponse
import ru.memo7.artel.data.api.RagChatPatchRequest
import ru.memo7.artel.data.api.RagChatSendRequest
import ru.memo7.artel.data.api.RagDialogChatDto
import ru.memo7.artel.data.api.RagIndexRequest
import ru.memo7.artel.data.api.RagIndexStatDto
import ru.memo7.artel.data.api.RagIndexTgDoneDto
import ru.memo7.artel.data.api.RagIndexTgRequest
import ru.memo7.artel.data.api.RagNotesResponse
import ru.memo7.artel.data.api.RagPartitionsDto
import ru.memo7.artel.data.api.RagQueryRequest
import ru.memo7.artel.data.api.RagQuoteDto
import ru.memo7.artel.data.api.RagSseParser
import ru.memo7.artel.data.api.RagStreamEvent
import ru.memo7.artel.data.api.RagSourceDto

/** Клиентский предел запроса — как ragQuerySchema.query.max(2000) на сервере. */
internal const val MAX_RAG_QUERY_LENGTH = 2000

/** Клиентский предел сообщения — как ragChatSendSchema.text.max(8000) на сервере. */
internal const val MAX_RAG_CHAT_INPUT_LENGTH = 8000

/** Клиентский предел task — как ragChatPatchSchema.task.max(500) на сервере. */
internal const val MAX_RAG_TASK_LENGTH = 500

/** Стратегии поиска — ровно те, что принимает ragQuerySchema.strategy. */
internal val RAG_STRATEGY_OPTIONS = listOf(
    "fixed" to "Документы",
    "structure" to "Структура",
    "telegram" to "Telegram",
    "notes" to "Заметки",
)

internal fun ragStrategyLabel(strategy: String): String =
    RAG_STRATEGY_OPTIONS.firstOrNull { it.first == strategy }?.second ?: strategy

/** Человекочитаемые подписи stage-шагов (пайплайн query/rag-chat + индексация tg). */
internal fun ragStageLabel(step: String): String = when (step) {
    "rewrite" -> "Переформулировка вопроса"
    "retrieve" -> "Поиск по базе"
    "filter" -> "Фильтрация фрагментов"
    "rerank" -> "Ранжирование"
    "guard" -> "Проверка ответа"
    "llm" -> "Ответ модели"
    "start" -> "Старт"
    "collect" -> "Сбор сообщений"
    "progress" -> "Индексация"
    "clear" -> "Очистка партиции"
    else -> step
}

/** Строка вида «Индексация · проиндексировано 12 · всего 40» из detail stage-ивента. */
internal fun ragStageDetailLine(step: String, detail: JsonElement?): String {
    val obj = detail as? JsonObject ?: return ragStageLabel(step)
    val parts = buildList {
        obj["chatTitle"]?.jsonPrimitive?.contentOrNull?.let { add(it) }
        obj["mode"]?.jsonPrimitive?.contentOrNull?.let { add(it) }
        obj["fetched"]?.jsonPrimitive?.intOrNull?.let { add("получено $it") }
        obj["newlyInserted"]?.jsonPrimitive?.intOrNull?.let { add("новых $it") }
        obj["indexed"]?.jsonPrimitive?.intOrNull?.let { add("проиндексировано $it") }
        obj["total"]?.jsonPrimitive?.intOrNull?.let { add("всего $it") }
        obj["cleared"]?.jsonPrimitive?.intOrNull?.let { add("очищено $it") }
    }
    return if (parts.isEmpty()) ragStageLabel(step) else parts.joinToString(" · ", prefix = "${ragStageLabel(step)} · ")
}

/* ---------- Хаб ---------- */

data class RagHubUiState(
    val partitions: UiState<RagPartitionsDto> = UiState.Loading,
    val notice: String? = null,
)

/** Статистика партиций базы знаний для хаба (GET /api/rag/notes → partitions). */
class RagHubViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(RagHubUiState())
    val state: StateFlow<RagHubUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(partitions = UiState.Loading, notice = null) }
        viewModelScope.launch {
            when (val result = repository.ragNotes()) {
                is ApiResult.Success -> _state.update {
                    it.copy(partitions = UiState.Success(result.data.partitions))
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(partitions = UiState.Error(result.error.message ?: "Не удалось загрузить статистику"))
                }
            }
        }
    }
}

/* ---------- Свободный запрос ---------- */

data class RagQueryUiState(
    val busy: Boolean = false,
    val stage: String? = null,
    val answer: String = "",
    val sources: List<RagSourceDto> = emptyList(),
    val quotes: List<RagQuoteDto> = emptyList(),
    val notice: String? = null,
)

/** Режим свободного запроса (web /rag): стрим токенов + источники/цитаты из done. */
class RagQueryViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(RagQueryUiState())
    val state: StateFlow<RagQueryUiState> = _state.asStateFlow()

    private var streamJob: Job? = null

    fun ask(query: String, strategy: String?, k: Int?) {
        val trimmed = query.trim()
        if (_state.value.busy || trimmed.isEmpty() || trimmed.length > MAX_RAG_QUERY_LENGTH) return
        _state.value = RagQueryUiState(busy = true)
        val body = ApiFactory.json.encodeToString(
            RagQueryRequest.serializer(),
            RagQueryRequest(query = trimmed, strategy = strategy, k = k),
        )
        streamJob = viewModelScope.launch {
            var accumulated = ""
            var doneAnswer: String? = null
            var doneSources = emptyList<RagSourceDto>()
            var doneQuotes = emptyList<RagQuoteDto>()
            var failure: String? = null
            val result = repository.sseStream("api/rag/query", body) { raw ->
                when (val event = RagSseParser.parse(raw)) {
                    is RagStreamEvent.Stage ->
                        _state.update { it.copy(stage = ragStageDetailLine(event.step, event.detail)) }
                    is RagStreamEvent.Token -> {
                        accumulated += event.delta
                        _state.update { it.copy(answer = accumulated) }
                    }
                    is RagStreamEvent.Done -> {
                        doneAnswer = event.answer
                        doneSources = event.sources
                        doneQuotes = event.quotes
                    }
                    is RagStreamEvent.Failure -> failure = event.message
                    null -> Unit
                }
            }
            _state.update {
                when {
                    failure != null -> it.copy(busy = false, stage = null, notice = failure)
                    result is ApiResult.Failure -> it.copy(
                        busy = false,
                        stage = null,
                        notice = result.error.message ?: "Не удалось выполнить запрос",
                    )
                    else -> it.copy(
                        busy = false,
                        stage = null,
                        answer = doneAnswer ?: accumulated,
                        sources = doneSources,
                        quotes = doneQuotes,
                    )
                }
            }
        }
    }

    /** «Остановить»: обрываем сокет; накопленный partial остаётся в ответе. */
    fun stop() {
        streamJob?.cancel()
        _state.update { if (it.busy) it.copy(busy = false, stage = null, notice = "Генерация остановлена") else it }
    }
}

/* ---------- Диалоги базы знаний: список + алиасы ---------- */

data class RagChatsUiState(
    val chats: UiState<List<RagDialogChatDto>> = UiState.Loading,
    val aliases: UiState<List<RagAliasDto>> = UiState.Loading,
    val titles: Map<String, String> = emptyMap(),
    val creating: Boolean = false,
    val aliasBusy: Boolean = false,
    val notice: String? = null,
)

/** Список диалогов (web /rag/chat) + алиасы TG-чатов (web /rag/chats). */
class RagChatsViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(RagChatsUiState())
    val state: StateFlow<RagChatsUiState> = _state.asStateFlow()

    init {
        refresh()
        refreshAliases()
    }

    fun refresh() {
        _state.update { it.copy(chats = UiState.Loading) }
        viewModelScope.launch {
            when (val result = repository.ragChats()) {
                is ApiResult.Success -> _state.update {
                    it.copy(chats = UiState.Success(result.data.chats))
                }
                is ApiResult.Failure -> _state.update {
                    val message = result.error.message ?: "Не удалось загрузить чаты"
                    if (it.chats is UiState.Success) it.copy(notice = message)
                    else it.copy(chats = UiState.Error(message))
                }
            }
        }
    }

    fun refreshAliases() {
        viewModelScope.launch {
            when (val result = repository.ragAliases()) {
                is ApiResult.Success -> _state.update {
                    it.copy(aliases = UiState.Success(result.data.aliases), titles = result.data.titles)
                }
                is ApiResult.Failure -> _state.update {
                    val message = result.error.message ?: "Не удалось загрузить алиасы"
                    if (it.aliases is UiState.Success) it.copy(notice = message)
                    else it.copy(aliases = UiState.Error(message))
                }
            }
        }
    }

    /** POST /api/rag/chat — создаём диалог и перечитываем список. */
    fun create(title: String?, onResult: (ApiResult<String>) -> Unit) {
        if (_state.value.creating) return
        _state.update { it.copy(creating = true, notice = null) }
        viewModelScope.launch {
            when (val result = repository.createRagChat(title?.takeIf { it.isNotBlank() })) {
                is ApiResult.Success -> {
                    _state.update { it.copy(creating = false) }
                    refresh()
                    onResult(ApiResult.Success(result.data.id))
                }
                is ApiResult.Failure -> {
                    val message = result.error.message ?: "Не удалось создать чат"
                    _state.update { it.copy(creating = false, notice = message) }
                    onResult(ApiResult.Failure(result.error))
                }
            }
        }
    }

    fun addAlias(name: String, chatKey: String, topicId: Int?) {
        if (_state.value.aliasBusy) return
        _state.update { it.copy(aliasBusy = true, notice = null) }
        viewModelScope.launch {
            when (val result = repository.ragAliasAdd(name.trim(), chatKey.trim(), topicId)) {
                is ApiResult.Success -> _state.update { it.copy(aliasBusy = false) }
                is ApiResult.Failure -> _state.update {
                    it.copy(aliasBusy = false, notice = result.error.message ?: "Не удалось добавить алиас")
                }
            }
            refreshAliases()
        }
    }

    fun removeAlias(name: String) {
        if (_state.value.aliasBusy) return
        _state.update { it.copy(aliasBusy = true, notice = null) }
        viewModelScope.launch {
            when (val result = repository.ragAliasRm(name)) {
                is ApiResult.Success -> _state.update { it.copy(aliasBusy = false) }
                is ApiResult.Failure -> _state.update {
                    it.copy(aliasBusy = false, notice = result.error.message ?: "Не удалось удалить алиас")
                }
            }
            refreshAliases()
        }
    }
}

/* ---------- Деталь диалога ---------- */

data class RagChatDetailUiState(
    val load: UiState<RagChatDetailResponse> = UiState.Loading,
    val busy: Boolean = false,
    val stage: String? = null,
    /** Эфемерный пузырь ассистента во время стрима (и после «Остановить» — partial). */
    val streamingAnswer: String? = null,
    val taskDraft: String = "",
    val taskBusy: Boolean = false,
    val notice: String? = null,
)

/** Переписка диалога базы знаний (web /rag/chat/[id]): стрим, task-панель. */
class RagChatDetailViewModel(
    private val repository: ArtelRepository,
    private val chatId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(RagChatDetailUiState())
    val state: StateFlow<RagChatDetailUiState> = _state.asStateFlow()

    private var streamJob: Job? = null

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(load = UiState.Loading, notice = null) }
        viewModelScope.launch {
            when (val result = repository.ragChat(chatId)) {
                is ApiResult.Success -> _state.update {
                    it.copy(load = UiState.Success(result.data), streamingAnswer = null)
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(load = UiState.Error(result.error.message ?: "Не удалось загрузить чат"))
                }
            }
        }
    }

    fun send(text: String, strategy: String?, k: Int?) {
        val trimmed = text.trim()
        if (_state.value.busy || trimmed.isEmpty() || trimmed.length > MAX_RAG_CHAT_INPUT_LENGTH) return
        _state.update { it.copy(busy = true, streamingAnswer = "", stage = null, notice = null) }
        val body = ApiFactory.json.encodeToString(
            RagChatSendRequest.serializer(),
            RagChatSendRequest(text = trimmed, strategy = strategy, k = k),
        )
        streamJob = viewModelScope.launch {
            var accumulated = ""
            var failure: String? = null
            val result = repository.sseStream("api/rag/chat/$chatId", body) { raw ->
                when (val event = RagSseParser.parse(raw)) {
                    is RagStreamEvent.Stage ->
                        _state.update { it.copy(stage = ragStageDetailLine(event.step, event.detail)) }
                    is RagStreamEvent.Token -> {
                        accumulated += event.delta
                        _state.update { it.copy(streamingAnswer = accumulated) }
                    }
                    is RagStreamEvent.Done -> Unit
                    is RagStreamEvent.Failure -> failure = event.message
                    null -> Unit
                }
            }
            when {
                failure != null -> _state.update {
                    it.copy(busy = false, stage = null, streamingAnswer = null, notice = failure)
                }
                result is ApiResult.Failure -> _state.update {
                    it.copy(
                        busy = false,
                        stage = null,
                        streamingAnswer = null,
                        notice = result.error.message ?: "Не удалось получить ответ",
                    )
                }
                else -> {
                    _state.update { it.copy(busy = false, stage = null, streamingAnswer = null) }
                    // Сервер уже сохранил пару в историю — перечитываем деталь,
                    // чтобы при повторном заходе увидеть каноническую переписку.
                    load()
                }
            }
        }
    }

    /** «Остановить»: обрываем сокет; partial остаётся в эфемерном пузыре. */
    fun stop() {
        streamJob?.cancel()
        _state.update { if (it.busy) it.copy(busy = false, stage = null, notice = "Генерация остановлена") else it }
    }

    fun onTaskDraftChange(text: String) {
        _state.update { it.copy(taskDraft = text.take(MAX_RAG_TASK_LENGTH)) }
    }

    /** PATCH task — задаём цель диалога (прочие секции сервер сохраняет). */
    fun saveTask() {
        val task = _state.value.taskDraft.trim()
        if (_state.value.taskBusy || task.isEmpty()) return
        patch(RagChatPatchRequest(task = task)) { it.copy(taskDraft = "") }
    }

    /** PATCH taskClear — полная очистка task-state диалога. */
    fun clearTask() {
        if (_state.value.taskBusy) return
        patch(RagChatPatchRequest(taskClear = true)) { it }
    }

    private fun patch(request: RagChatPatchRequest, andThen: (RagChatDetailUiState) -> RagChatDetailUiState) {
        _state.update { it.copy(taskBusy = true, notice = null) }
        viewModelScope.launch {
            when (val result = repository.patchRagChat(chatId, request)) {
                is ApiResult.Success -> {
                    _state.update { current ->
                        andThen(current.copy(taskBusy = false)).let { updated ->
                            val loaded = current.load as? UiState.Success
                            updated.copy(
                                load = UiState.Success(
                                    RagChatDetailResponse(
                                        chat = result.data.chat,
                                        messages = loaded?.data?.messages ?: emptyList(),
                                        taskStateText = result.data.taskStateText,
                                    ),
                                ),
                            )
                        }
                    }
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(taskBusy = false, notice = result.error.message ?: "Не удалось сохранить задачу")
                }
            }
        }
    }
}

/* ---------- Индексация ---------- */

data class RagIndexUiState(
    val running: Boolean = false,
    val stage: String? = null,
    val log: List<String> = emptyList(),
    val stats: List<RagIndexStatDto> = emptyList(),
    val tgDone: RagIndexTgDoneDto? = null,
    val notice: String? = null,
)

/** Индексация партиций (web /rag/index + /rag/index-tg): stage-лог + финальная статистика. */
class RagIndexViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(RagIndexUiState())
    val state: StateFlow<RagIndexUiState> = _state.asStateFlow()

    private var streamJob: Job? = null

    fun runIndex(strategies: Set<String>) {
        if (_state.value.running || strategies.isEmpty()) return
        _state.value = RagIndexUiState(running = true)
        val body = ApiFactory.json.encodeToString(
            RagIndexRequest.serializer(),
            RagIndexRequest(strategies = strategies.toList()),
        )
        streamJob = viewModelScope.launch {
            var failure: String? = null
            var stats = emptyList<RagIndexStatDto>()
            val result = repository.sseStream("api/rag/index", body) { raw ->
                when (val event = RagSseParser.parse(raw)) {
                    is RagStreamEvent.Stage -> _state.update {
                        val line = ragStageDetailLine(event.step, event.detail)
                        it.copy(stage = line, log = it.log + line)
                    }
                    is RagStreamEvent.Done -> stats = event.result
                    is RagStreamEvent.Token -> Unit
                    is RagStreamEvent.Failure -> failure = event.message
                    null -> Unit
                }
            }
            _state.update {
                when {
                    failure != null -> it.copy(running = false, stage = null, notice = failure)
                    result is ApiResult.Failure -> it.copy(
                        running = false,
                        stage = null,
                        notice = result.error.message ?: "Не удалось запустить индексацию",
                    )
                    else -> it.copy(running = false, stage = null, stats = stats)
                }
            }
        }
    }

    /** reset:true с topicId стирает ВЕСЬ telegram-раздел — предупреждение показывает экран. */
    fun runIndexTg(chatRef: String, topicId: Int?, limit: Int?, reset: Boolean) {
        if (_state.value.running) return
        _state.value = RagIndexUiState(running = true)
        val body = ApiFactory.json.encodeToString(
            RagIndexTgRequest.serializer(),
            RagIndexTgRequest(chatRef = chatRef.trim(), topicId = topicId, limit = limit, reset = reset),
        )
        streamJob = viewModelScope.launch {
            var failure: String? = null
            var done: RagIndexTgDoneDto? = null
            val result = repository.sseStream("api/rag/index-tg", body) { raw ->
                when (val event = RagSseParser.parse(raw)) {
                    is RagStreamEvent.Stage -> _state.update {
                        val line = ragStageDetailLine(event.step, event.detail)
                        it.copy(stage = line, log = it.log + line)
                    }
                    is RagStreamEvent.Done -> done = RagIndexTgDoneDto(
                        mode = event.mode ?: "single",
                        chatKey = event.chatKey ?: chatRef.trim(),
                        indexed = event.indexed ?: 0,
                        total = event.total ?: 0,
                        dim = event.dim,
                    )
                    is RagStreamEvent.Token -> Unit
                    is RagStreamEvent.Failure -> failure = event.message
                    null -> Unit
                }
            }
            _state.update {
                when {
                    failure != null -> it.copy(running = false, stage = null, notice = failure)
                    result is ApiResult.Failure -> it.copy(
                        running = false,
                        stage = null,
                        notice = result.error.message ?: "Не удалось запустить индексацию",
                    )
                    else -> it.copy(running = false, stage = null, tgDone = done)
                }
            }
        }
    }

    fun stop() {
        streamJob?.cancel()
        _state.update {
            if (it.running) it.copy(running = false, stage = null, notice = "Индексация остановлена") else it
        }
    }

    fun consumeNotice() {
        _state.update { it.copy(notice = null) }
    }
}

/* ---------- Заметки ---------- */

data class RagNotesUiState(
    val load: UiState<RagNotesResponse> = UiState.Loading,
    val adding: Boolean = false,
    val notice: String? = null,
)

/** Заметки базы знаний (web /rag/ingest): список + добавление (JSON-форма) + удаление. */
class RagNotesViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(RagNotesUiState())
    val state: StateFlow<RagNotesUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(load = UiState.Loading) }
        viewModelScope.launch {
            when (val result = repository.ragNotes()) {
                is ApiResult.Success -> _state.update { it.copy(load = UiState.Success(result.data)) }
                is ApiResult.Failure -> _state.update {
                    val message = result.error.message ?: "Не удалось загрузить заметки"
                    if (it.load is UiState.Success) it.copy(notice = message)
                    else it.copy(load = UiState.Error(message))
                }
            }
        }
    }

    fun add(title: String, text: String, onResult: (ApiResult<Unit>) -> Unit) {
        if (_state.value.adding) return
        _state.update { it.copy(adding = true, notice = null) }
        viewModelScope.launch {
            val result: ApiResult<Unit> = when (val res = repository.ragNoteAdd(title.trim(), text.trim())) {
                is ApiResult.Success -> ApiResult.Success(Unit)
                is ApiResult.Failure -> ApiResult.Failure(res.error)
            }
            _state.update {
                when (val r = result) {
                    is ApiResult.Success -> it.copy(adding = false)
                    is ApiResult.Failure ->
                        it.copy(adding = false, notice = r.error.message ?: "Не удалось добавить заметку")
                }
            }
            if (result is ApiResult.Success) refresh()
            onResult(result)
        }
    }

    fun remove(source: String) {
        _state.update { it.copy(notice = null) }
        viewModelScope.launch {
            when (val result = repository.ragNoteDelete(source)) {
                is ApiResult.Success -> Unit
                is ApiResult.Failure -> _state.update {
                    it.copy(notice = result.error.message ?: "Не удалось удалить заметку")
                }
            }
            refresh()
        }
    }
}
