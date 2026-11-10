// ViewModel блог-блока (#146). Один VM на блок: под-состояния — отдельные
// StateFlow'ы (списки через UiState, мутации через OpState, LLM/SSE-запуски
// через StreamState/ActionState). Все вызовы — через методы ArtelRepository,
// которые добавит orchestrator на интеграции (blogPosts, blogPost,
// patchBlogPost, deleteBlogPost, publishBlogPost, generateBlogPosts, blogStyle,
// addBlogStyle, generateDigest, blogNews, blogScout, blogPipeline,
// blogPipelineAction, blogSchedule, putBlogSchedule).
// Не-идемпотентные операции (publish, generate с publishNow) — guard от повторного
// тапа до ответа; SSE-запуски только по кнопке, никогда автоматически.
package ru.memo7.artel.ui.screens.blog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.AddStyleSampleRequest
import ru.memo7.artel.data.api.BlogAgentPromptsResponse
import ru.memo7.artel.data.api.BlogCreateRequest
import ru.memo7.artel.data.api.BlogDto
import ru.memo7.artel.data.api.BlogNewsRequest
import ru.memo7.artel.data.api.BlogPipelineDto
import ru.memo7.artel.data.api.BlogPipelineResetRequest
import ru.memo7.artel.data.api.BlogPipelineTransitionRequest
import ru.memo7.artel.data.api.BlogPostResponse
import ru.memo7.artel.data.api.BlogScheduleEntryDto
import ru.memo7.artel.data.api.BlogScheduleResponse
import ru.memo7.artel.data.api.BlogScoutRequest
import ru.memo7.artel.data.api.BlogStreamEvent
import ru.memo7.artel.data.api.DigestGenerateRequest
import ru.memo7.artel.data.api.DigestResponse
import ru.memo7.artel.data.api.GeneratePostsRequest
import ru.memo7.artel.data.api.GeneratePostsResponse
import ru.memo7.artel.data.api.NewsPostDto
import ru.memo7.artel.data.api.PostListItemDto
import ru.memo7.artel.data.api.PutBlogScheduleRequest
import ru.memo7.artel.data.api.ScoutAgentDto
import ru.memo7.artel.data.api.ScoutRankedDto
import ru.memo7.artel.data.api.StyleSampleDto
import ru.memo7.artel.data.api.TopNewsDto
import ru.memo7.artel.data.api.blogStatusPatchJson

/** Простая мутация без результата: кнопка → Busy → Done/Failed (один тап до ответа). */
sealed interface OpState {
    data object Idle : OpState
    data object Busy : OpState
    data class Done(val message: String) : OpState
    data class Failed(val message: String) : OpState
}

/** Мутация с результатом (генерация постов, дайджест). */
sealed interface ActionState<out R> {
    data object Idle : ActionState<Nothing>
    data object Busy : ActionState<Nothing>
    data class Done<R>(val result: R) : ActionState<R>
    data class Failed(val message: String) : ActionState<Nothing>
}

/** LLM/SSE-запуск по кнопке: Idle → Running(stage) → Done(result)/Failed. */
sealed interface StreamState<out R> {
    data object Idle : StreamState<Nothing>
    data class Running(val stage: String) : StreamState<Nothing>
    data class Done<R>(val result: R) : StreamState<R>
    data class Failed(val message: String) : StreamState<Nothing>
}

data class NewsResult(
    val post: NewsPostDto?,
    val topNews: List<TopNewsDto>,
    val verdict: String?,
    val notice: String?,
)

data class ScoutResult(
    val ranked: List<ScoutRankedDto>,
    val agents: List<ScoutAgentDto>,
)

/** step SSE-событий сервера → человекочитаемая стадия. */
internal fun streamStageLabel(step: String): String = when (step) {
    "start" -> "Запуск пайплайна…"
    else -> step
}

class BlogViewModel(
    private val repository: ArtelRepository,
    private val blogSlug: String?,
) : ViewModel() {

    /* ---------- Хаб: список блогов ---------- */

    private val _blogs = MutableStateFlow<UiState<List<BlogDto>>>(UiState.Loading)
    val blogs: StateFlow<UiState<List<BlogDto>>> = _blogs.asStateFlow()

    /* ---------- Настройки блога ---------- */

    private val _blogDetail = MutableStateFlow<UiState<BlogDto>>(UiState.Loading)
    val blogDetail: StateFlow<UiState<BlogDto>> = _blogDetail.asStateFlow()

    private val _patchBlog = MutableStateFlow<OpState>(OpState.Idle)
    val patchBlog: StateFlow<OpState> = _patchBlog.asStateFlow()

    private val _createBlog = MutableStateFlow<ActionState<BlogDto>>(ActionState.Idle)
    val createBlog: StateFlow<ActionState<BlogDto>> = _createBlog.asStateFlow()

    /* ---------- Промпты агентов ---------- */

    private val _prompts = MutableStateFlow<UiState<BlogAgentPromptsResponse>>(UiState.Loading)
    val prompts: StateFlow<UiState<BlogAgentPromptsResponse>> = _prompts.asStateFlow()

    private val _putPrompt = MutableStateFlow<OpState>(OpState.Idle)
    val putPrompt: StateFlow<OpState> = _putPrompt.asStateFlow()

    /* ---------- Посты ---------- */

    private val _posts = MutableStateFlow<UiState<List<PostListItemDto>>>(UiState.Loading)
    val posts: StateFlow<UiState<List<PostListItemDto>>> = _posts.asStateFlow()

    private val _postDetail = MutableStateFlow<UiState<BlogPostResponse>>(UiState.Loading)
    val postDetail: StateFlow<UiState<BlogPostResponse>> = _postDetail.asStateFlow()

    private val _savePost = MutableStateFlow<OpState>(OpState.Idle)
    val savePost: StateFlow<OpState> = _savePost.asStateFlow()

    private val _deletePost = MutableStateFlow<OpState>(OpState.Idle)
    val deletePost: StateFlow<OpState> = _deletePost.asStateFlow()

    /** Публикация НЕ идемпотентна: каждый вызов переотправляет пост в TG. */
    private val _publishPost = MutableStateFlow<OpState>(OpState.Idle)
    val publishPost: StateFlow<OpState> = _publishPost.asStateFlow()

    /* ---------- Генерация по теме ---------- */

    private val _generate = MutableStateFlow<ActionState<GeneratePostsResponse>>(ActionState.Idle)
    val generate: StateFlow<ActionState<GeneratePostsResponse>> = _generate.asStateFlow()

    /* ---------- Стиль ---------- */

    private val _styleSamples = MutableStateFlow<UiState<List<StyleSampleDto>>>(UiState.Loading)
    val styleSamples: StateFlow<UiState<List<StyleSampleDto>>> = _styleSamples.asStateFlow()

    private val _addStyle = MutableStateFlow<OpState>(OpState.Idle)
    val addStyle: StateFlow<OpState> = _addStyle.asStateFlow()

    /* ---------- Дайджест ---------- */

    private val _digest = MutableStateFlow<ActionState<DigestResponse>>(ActionState.Idle)
    val digest: StateFlow<ActionState<DigestResponse>> = _digest.asStateFlow()

    /* ---------- News / Scout (SSE) ---------- */

    private val _news = MutableStateFlow<StreamState<NewsResult>>(StreamState.Idle)
    val news: StateFlow<StreamState<NewsResult>> = _news.asStateFlow()

    private val _scout = MutableStateFlow<StreamState<ScoutResult>>(StreamState.Idle)
    val scout: StateFlow<StreamState<ScoutResult>> = _scout.asStateFlow()

    /* ---------- Пайплайн (FSM) ---------- */

    private val _pipeline = MutableStateFlow<UiState<BlogPipelineDto>>(UiState.Loading)
    val pipeline: StateFlow<UiState<BlogPipelineDto>> = _pipeline.asStateFlow()

    private val _pipelineOp = MutableStateFlow<OpState>(OpState.Idle)
    val pipelineOp: StateFlow<OpState> = _pipelineOp.asStateFlow()

    /* ---------- Расписание ---------- */

    private val _schedule = MutableStateFlow<UiState<BlogScheduleResponse>>(UiState.Loading)
    val schedule: StateFlow<UiState<BlogScheduleResponse>> = _schedule.asStateFlow()

    /** PUT идемпотентен — guard только от параллельных вызовов (Busy). */
    private val _putSchedule = MutableStateFlow<OpState>(OpState.Idle)
    val putSchedule: StateFlow<OpState> = _putSchedule.asStateFlow()

    /* ---------- Загрузки (GET) ---------- */

    fun loadBlogs() {
        _blogs.value = UiState.Loading
        viewModelScope.launch {
            _blogs.value = when (val result = repository.blogs()) {
                is ApiResult.Success -> UiState.Success(result.data.blogs)
                is ApiResult.Failure ->
                    UiState.Error(result.error.message ?: "Не удалось загрузить блоги")
            }
        }
    }

    fun loadBlogDetail() {
        val slug = blogSlug ?: run {
            _blogDetail.value = UiState.Error("Блог не выбран")
            return
        }
        _blogDetail.value = UiState.Loading
        viewModelScope.launch {
            _blogDetail.value = when (val result = repository.blog(slug)) {
                is ApiResult.Success -> UiState.Success(result.data.blog)
                is ApiResult.Failure ->
                    UiState.Error(result.error.message ?: "Не удалось загрузить настройки блога")
            }
        }
    }

    fun loadPosts(limit: Int = 20) {
        _posts.value = UiState.Loading
        viewModelScope.launch {
            _posts.value = when (val result = repository.blogPosts(limit, blogSlug)) {
                is ApiResult.Success -> UiState.Success(result.data.posts)
                is ApiResult.Failure -> UiState.Error(result.error.message ?: "Не удалось загрузить посты")
            }
        }
    }

    fun loadPost(id: Long) {
        _postDetail.value = UiState.Loading
        viewModelScope.launch {
            _postDetail.value = when (val result = repository.blogPost(id)) {
                is ApiResult.Success -> UiState.Success(result.data)
                is ApiResult.Failure -> UiState.Error(result.error.message ?: "Не удалось загрузить пост")
            }
        }
    }

    fun loadStyle() {
        _styleSamples.value = UiState.Loading
        viewModelScope.launch {
            _styleSamples.value = when (val result = repository.blogStyle(blogSlug)) {
                is ApiResult.Success -> UiState.Success(result.data.samples)
                is ApiResult.Failure ->
                    UiState.Error(result.error.message ?: "Не удалось загрузить образцы стиля")
            }
        }
    }

    fun loadPipeline() {
        _pipeline.value = UiState.Loading
        viewModelScope.launch {
            _pipeline.value = when (val result = repository.blogPipeline()) {
                is ApiResult.Success -> UiState.Success(result.data)
                is ApiResult.Failure ->
                    UiState.Error(result.error.message ?: "Не удалось загрузить пайплайн")
            }
        }
    }

    fun loadSchedule() {
        val slug = blogSlug ?: run {
            _schedule.value = UiState.Error("Блог не выбран")
            return
        }
        _schedule.value = UiState.Loading
        viewModelScope.launch {
            _schedule.value = when (val result = repository.blogSchedule(slug)) {
                is ApiResult.Success -> UiState.Success(result.data)
                is ApiResult.Failure ->
                    UiState.Error(result.error.message ?: "Не удалось загрузить расписание")
            }
        }
    }

    /* ---------- Настройки блога (PATCH) ---------- */

    fun patchBlog(body: JsonObject) {
        val slug = blogSlug ?: run {
            _patchBlog.value = OpState.Failed("Блог не выбран")
            return
        }
        if (_patchBlog.value is OpState.Busy) return
        _patchBlog.value = OpState.Busy
        viewModelScope.launch {
            _patchBlog.value = when (val result = repository.patchBlog(slug, body)) {
                is ApiResult.Success -> {
                    _blogDetail.value = UiState.Success(result.data.blog)
                    loadBlogs()
                    OpState.Done("Настройки блога сохранены")
                }
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось сохранить настройки")
            }
        }
    }

    fun setArchived(archived: Boolean) = patchBlog(blogStatusPatchJson(if (archived) "archived" else "active"))

    fun createBlog(request: BlogCreateRequest) {
        if (_createBlog.value is ActionState.Busy) return
        _createBlog.value = ActionState.Busy
        viewModelScope.launch {
            _createBlog.value = when (val result = repository.createBlog(request)) {
                is ApiResult.Success -> {
                    loadBlogs()
                    ActionState.Done(result.data.blog)
                }
                is ApiResult.Failure ->
                    ActionState.Failed(result.error.message ?: "Не удалось создать блог")
            }
        }
    }

    fun loadPrompts() {
        val slug = blogSlug ?: run {
            _prompts.value = UiState.Error("Блог не выбран")
            return
        }
        _prompts.value = UiState.Loading
        viewModelScope.launch {
            _prompts.value = when (val result = repository.blogAgentPrompts(slug)) {
                is ApiResult.Success -> UiState.Success(result.data)
                is ApiResult.Failure ->
                    UiState.Error(result.error.message ?: "Не удалось загрузить промпты")
            }
        }
    }

    fun putPrompt(agent: String, prompt: String?) {
        val slug = blogSlug ?: run {
            _putPrompt.value = OpState.Failed("Блог не выбран")
            return
        }
        if (_putPrompt.value is OpState.Busy) return
        _putPrompt.value = OpState.Busy
        viewModelScope.launch {
            _putPrompt.value = when (val result = repository.putBlogAgentPrompt(slug, agent, prompt)) {
                is ApiResult.Success -> {
                    loadPrompts()
                    loadBlogDetail()
                    OpState.Done(if (prompt == null) "Промпт сброшен" else "Промпт сохранён")
                }
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось сохранить промпт")
            }
        }
    }

    /* ---------- Посты: правка / удаление / публикация ---------- */

    fun savePost(id: Long, content: String) {
        if (_savePost.value is OpState.Busy) return
        _savePost.value = OpState.Busy
        viewModelScope.launch {
            _savePost.value = when (val result = repository.patchBlogPost(id, content)) {
                is ApiResult.Success -> {
                    val current = _postDetail.value
                    if (current is UiState.Success) {
                        _postDetail.value = UiState.Success(current.data.copy(post = result.data.post))
                    }
                    OpState.Done("Пост сохранён")
                }
                is ApiResult.Failure -> OpState.Failed(result.error.message ?: "Не удалось сохранить пост")
            }
        }
    }

    fun deletePost(id: Long) {
        if (_deletePost.value is OpState.Busy) return
        _deletePost.value = OpState.Busy
        viewModelScope.launch {
            _deletePost.value = when (val result = repository.deleteBlogPost(id)) {
                is ApiResult.Success -> OpState.Done("Пост удалён")
                is ApiResult.Failure -> OpState.Failed(result.error.message ?: "Не удалось удалить пост")
            }
        }
    }

    /** Каждый вызов переотправляет пост — повторный тап заблокирован до ответа. */
    fun publishPost(id: Long) {
        if (_publishPost.value is OpState.Busy) return
        _publishPost.value = OpState.Busy
        viewModelScope.launch {
            _publishPost.value = when (val result = repository.publishBlogPost(id)) {
                is ApiResult.Success -> {
                    val data = result.data
                    if (data.ok) {
                        loadPost(id)
                        OpState.Done("Опубликовано в Telegram, сообщение №${data.messageId ?: "?"}")
                    } else {
                        val retry = data.retryAfter?.let { " Повторите через $it с." }.orEmpty()
                        OpState.Failed("Публикация не удалась: ${data.error ?: "неизвестная ошибка"}.$retry")
                    }
                }
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось опубликовать пост")
            }
        }
    }

    /* ---------- Генерация по теме ---------- */

    fun generatePosts(topic: String, comment: String?, variants: Int, publishNow: Boolean) {
        val slug = blogSlug ?: run {
            _generate.value = ActionState.Failed("Блог не выбран")
            return
        }
        if (_generate.value is ActionState.Busy) return
        _generate.value = ActionState.Busy
        viewModelScope.launch {
            _generate.value = when (
                val result = repository.generateBlogPosts(
                    slug,
                    GeneratePostsRequest(
                        topic = topic,
                        comment = comment?.takeIf { it.isNotBlank() },
                        variants = variants,
                        publishNow = publishNow,
                    ),
                )
            ) {
                is ApiResult.Success -> ActionState.Done(result.data)
                is ApiResult.Failure ->
                    ActionState.Failed(result.error.message ?: "Не удалось сгенерировать посты")
            }
        }
    }

    /* ---------- Стиль ---------- */

    fun addStyle(text: String) {
        if (_addStyle.value is OpState.Busy) return
        _addStyle.value = OpState.Busy
        viewModelScope.launch {
            _addStyle.value = when (
                val result = repository.addBlogStyle(AddStyleSampleRequest(text = text, blog = blogSlug))
            ) {
                is ApiResult.Success ->
                    if (result.data.duplicated) {
                        OpState.Done("Такой образец уже добавлен")
                    } else {
                        loadStyle()
                        OpState.Done("Образец стиля добавлен")
                    }
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось добавить образец")
            }
        }
    }

    /* ---------- Дайджест ---------- */

    fun generateDigest(days: Int) {
        if (_digest.value is ActionState.Busy) return
        _digest.value = ActionState.Busy
        viewModelScope.launch {
            _digest.value = when (
                val result = repository.generateDigest(DigestGenerateRequest(days = days, blog = blogSlug))
            ) {
                is ApiResult.Success -> ActionState.Done(result.data)
                is ApiResult.Failure ->
                    // 409 empty-window приходит сюда с человекочитаемым текстом сервера.
                    ActionState.Failed(result.error.message ?: "Не удалось собрать дайджест")
            }
        }
    }

    /* ---------- News / Scout: SSE только по кнопке ---------- */

    fun runNews(hours: Int?, top: Int?, forIndex: Int?, llm: String?) {
        if (_news.value is StreamState.Running) return
        _news.value = StreamState.Running(streamStageLabel("start"))
        viewModelScope.launch {
            var done: NewsResult? = null
            var failure: String? = null
            val streamResult = repository.blogNews(
                BlogNewsRequest(hours = hours, top = top, forIndex = forIndex, llm = llm, blog = blogSlug),
            ) { event ->
                when (event) {
                    is BlogStreamEvent.NewsEvent.Stage ->
                        _news.value = StreamState.Running(streamStageLabel(event.step))
                    is BlogStreamEvent.NewsEvent.Done ->
                        done = NewsResult(event.post, event.topNews, event.verdict, event.notice)
                    is BlogStreamEvent.NewsEvent.Failure -> failure = event.message
                }
            }
            val result = done
            _news.value = when {
                failure != null -> StreamState.Failed(failure.orEmpty())
                streamResult is ApiResult.Failure ->
                    StreamState.Failed(streamResult.error.message ?: "Не удалось запустить news-пайплайн")
                result != null -> StreamState.Done(result)
                else -> StreamState.Failed("Соединение закрыто без результата")
            }
        }
    }

    fun runScout(hours: Int?, topK: Int?, query: String?, enableTelegram: Boolean, enableForum: Boolean, llm: String?) {
        if (_scout.value is StreamState.Running) return
        _scout.value = StreamState.Running(streamStageLabel("start"))
        viewModelScope.launch {
            var done: ScoutResult? = null
            var failure: String? = null
            val streamResult = repository.blogScout(
                BlogScoutRequest(
                    hours = hours,
                    topK = topK,
                    query = query?.takeIf { it.isNotBlank() },
                    blog = blogSlug,
                    enableTelegram = enableTelegram,
                    enableForum = enableForum,
                    llm = llm,
                ),
            ) { event ->
                when (event) {
                    is BlogStreamEvent.ScoutEvent.Stage ->
                        _scout.value = StreamState.Running(streamStageLabel(event.step))
                    is BlogStreamEvent.ScoutEvent.Done ->
                        done = ScoutResult(event.ranked, event.agents)
                    is BlogStreamEvent.ScoutEvent.Failure -> failure = event.message
                }
            }
            val result = done
            _scout.value = when {
                failure != null -> StreamState.Failed(failure.orEmpty())
                streamResult is ApiResult.Failure ->
                    StreamState.Failed(streamResult.error.message ?: "Не удалось запустить scout")
                result != null -> StreamState.Done(result)
                else -> StreamState.Failed("Соединение закрыто без результата")
            }
        }
    }

    /* ---------- Пайплайн: переходы и сброс ---------- */

    fun transitionPipeline(to: String, detail: String?) {
        if (_pipelineOp.value is OpState.Busy) return
        _pipelineOp.value = OpState.Busy
        viewModelScope.launch {
            _pipelineOp.value = when (
                val result = repository.blogPipelineAction(
                    BlogPipelineTransitionRequest(to = to, detail = detail?.takeIf { it.isNotBlank() }),
                )
            ) {
                is ApiResult.Success -> {
                    _pipeline.value = UiState.Success(result.data)
                    OpState.Done("Переход выполнен: ${result.data.stage}")
                }
                // 400 при недопустимом переходе — текст сервера, состояние не трогаем.
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось выполнить переход")
            }
        }
    }

    fun resetPipeline() {
        if (_pipelineOp.value is OpState.Busy) return
        _pipelineOp.value = OpState.Busy
        viewModelScope.launch {
            _pipelineOp.value = when (val result = repository.blogPipelineAction(BlogPipelineResetRequest())) {
                is ApiResult.Success -> {
                    _pipeline.value = UiState.Success(result.data)
                    OpState.Done("Пайплайн сброшен")
                }
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось сбросить пайплайн")
            }
        }
    }

    /* ---------- Расписание: полная замена (PUT) ---------- */

    fun putSchedule(entries: List<BlogScheduleEntryDto>) {
        val slug = blogSlug ?: run {
            _putSchedule.value = OpState.Failed("Блог не выбран")
            return
        }
        if (_putSchedule.value is OpState.Busy) return
        _putSchedule.value = OpState.Busy
        viewModelScope.launch {
            _putSchedule.value = when (
                val result = repository.putBlogSchedule(slug, PutBlogScheduleRequest(entries))
            ) {
                is ApiResult.Success -> {
                    val current = _schedule.value
                    if (current is UiState.Success) {
                        _schedule.value = UiState.Success(current.data.copy(schedules = result.data.schedules))
                    }
                    OpState.Done("Расписание сохранено")
                }
                is ApiResult.Failure ->
                    OpState.Failed(result.error.message ?: "Не удалось сохранить расписание")
            }
        }
    }
}
