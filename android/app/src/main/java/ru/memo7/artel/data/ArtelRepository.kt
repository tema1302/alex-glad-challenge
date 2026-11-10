package ru.memo7.artel.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import retrofit2.HttpException
import ru.memo7.artel.core.network.ApiError
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.api.ArtelApi
import ru.memo7.artel.data.api.AssistantRequest
import ru.memo7.artel.data.api.AssistantResponse
import ru.memo7.artel.data.api.AutomationConfigureRequest
import ru.memo7.artel.data.api.AutomationResponse
import ru.memo7.artel.data.api.AutomationRunRequest
import ru.memo7.artel.data.api.AutomationRunResponse
import ru.memo7.artel.data.api.BlogAgentPromptsResponse
import ru.memo7.artel.data.api.BlogCreateRequest
import ru.memo7.artel.data.api.BlogCreateResponse
import ru.memo7.artel.data.api.BlogDetailResponse
import ru.memo7.artel.data.api.BlogNewsRequest
import ru.memo7.artel.data.api.BlogPipelineDto
import ru.memo7.artel.data.api.BlogPipelineResetRequest
import ru.memo7.artel.data.api.BlogPipelineTransitionRequest
import ru.memo7.artel.data.api.BlogPostResponse
import ru.memo7.artel.data.api.BlogPostsResponse
import ru.memo7.artel.data.api.BlogPulseResponse
import ru.memo7.artel.data.api.BlogScheduleResponse
import ru.memo7.artel.data.api.BlogScoutRequest
import ru.memo7.artel.data.api.BlogsResponse
import ru.memo7.artel.data.api.BlogSseParser
import ru.memo7.artel.data.api.BlogStreamEvent
import ru.memo7.artel.data.api.BlogStyleRequest
import ru.memo7.artel.data.api.blogAgentPromptJson
import ru.memo7.artel.data.api.DigestGenerateRequest
import ru.memo7.artel.data.api.DigestResponse
import ru.memo7.artel.data.api.EvoluteAgentRequest
import ru.memo7.artel.data.api.EvoluteEvent
import ru.memo7.artel.data.api.EvoluteHistoryMessageDto
import ru.memo7.artel.data.api.GeneratePostsRequest
import ru.memo7.artel.data.api.GeneratePostsResponse
import ru.memo7.artel.data.api.McpCallRequest
import ru.memo7.artel.data.api.McpCallResponse
import ru.memo7.artel.data.api.McpToolsResponse
import ru.memo7.artel.data.api.PatchBlogResponse
import ru.memo7.artel.data.api.PutBlogAgentPromptResponse
import ru.memo7.artel.data.api.PatchPostRequest
import ru.memo7.artel.data.api.PatchPostResponse
import ru.memo7.artel.data.api.PublishPostResponse
import ru.memo7.artel.data.api.PutBlogScheduleRequest
import ru.memo7.artel.data.api.PutBlogScheduleResponse
import ru.memo7.artel.data.api.RagAliasActionRequest
import ru.memo7.artel.data.api.RagAliasActionResponse
import ru.memo7.artel.data.api.RagChatCreateRequest
import ru.memo7.artel.data.api.RagChatCreatedResponse
import ru.memo7.artel.data.api.RagChatDetailResponse
import ru.memo7.artel.data.api.RagChatListResponse
import ru.memo7.artel.data.api.RagChatPatchRequest
import ru.memo7.artel.data.api.RagChatPatchResponse
import ru.memo7.artel.data.api.RagChatsResponse
import ru.memo7.artel.data.api.RagNoteAddRequest
import ru.memo7.artel.data.api.RagNoteAddResponse
import ru.memo7.artel.data.api.RagNoteDeleteRequest
import ru.memo7.artel.data.api.RagNoteDeleteResponse
import ru.memo7.artel.data.api.RagNotesResponse
import ru.memo7.artel.data.api.SseParser
import ru.memo7.artel.data.api.AdminServersResponse
import ru.memo7.artel.data.api.AgentRequest
import ru.memo7.artel.data.api.AgentResponse
import ru.memo7.artel.data.api.AntonovRewriteRequest
import ru.memo7.artel.data.api.AntonovRewriteResponse
import ru.memo7.artel.data.api.AntonovThreadRequest
import ru.memo7.artel.data.api.AntonovThreadResponse
import ru.memo7.artel.data.api.BranchActionRequest
import ru.memo7.artel.data.api.BranchActionResponse
import ru.memo7.artel.data.api.BranchViewDto
import ru.memo7.artel.data.api.BriefingResponse
import ru.memo7.artel.data.api.ConstraintsActionRequest
import ru.memo7.artel.data.api.ConstraintsActionResponse
import ru.memo7.artel.data.api.ConstraintsViewDto
import ru.memo7.artel.data.api.CreateInboundHookRequest
import ru.memo7.artel.data.api.CreateInboundHookResponse
import ru.memo7.artel.data.api.CreateWebhookRequest
import ru.memo7.artel.data.api.InboundHooksResponse
import ru.memo7.artel.data.api.JokerResetRequest
import ru.memo7.artel.data.api.JokerSessionResponse
import ru.memo7.artel.data.api.MemoryActionRequest
import ru.memo7.artel.data.api.MemoryActionResponse
import ru.memo7.artel.data.api.MemoryViewDto
import ru.memo7.artel.data.api.ProfileActionRequest
import ru.memo7.artel.data.api.ProfileActionResponse
import ru.memo7.artel.data.api.ProfileViewDto
import ru.memo7.artel.data.api.SummaryPublishRequest
import ru.memo7.artel.data.api.SummaryPublishResponse
import ru.memo7.artel.data.api.SummaryResponse
import ru.memo7.artel.data.api.WebhooksResponse
import ru.memo7.artel.data.api.StyleSamplesResponse
import ru.memo7.artel.data.api.TelegramHistoryResponse
import ru.memo7.artel.data.api.TelegramPublishRequest
import ru.memo7.artel.data.api.TelegramPublishResponse
import ru.memo7.artel.data.api.TgCollectEvent
import ru.memo7.artel.data.api.TgCollectRequest
import ru.memo7.artel.data.api.TgSseParser
import ru.memo7.artel.data.api.TgTopResponse
import ru.memo7.artel.data.api.AddStyleSampleRequest
import ru.memo7.artel.data.api.AddStyleSampleResponse
import ru.memo7.artel.data.api.BootstrapResponse
import ru.memo7.artel.data.api.CalendarResponse
import ru.memo7.artel.data.api.CalendarSyncResponse
import ru.memo7.artel.data.api.CourseLessonResponse
import ru.memo7.artel.data.api.CourseLessonsResponse
import ru.memo7.artel.data.api.ChatCreateRequest
import ru.memo7.artel.data.api.ChatResetRequest
import ru.memo7.artel.data.api.ChatSessionCreatedResponse
import ru.memo7.artel.data.api.ChatSessionResponse
import ru.memo7.artel.data.api.ChatSendRequest
import ru.memo7.artel.data.api.ChatSessionsResponse
import ru.memo7.artel.data.api.ChatSseParser
import ru.memo7.artel.data.api.ChatStreamEvent
import ru.memo7.artel.data.api.CreateItemRequest
import ru.memo7.artel.data.api.CreateProjectRequest
import ru.memo7.artel.data.api.CreateTicketRequest
import ru.memo7.artel.data.api.CreatedIdResponse
import ru.memo7.artel.data.api.ErrorResponse
import ru.memo7.artel.data.api.FaqResponse
import ru.memo7.artel.data.api.GamificationResponse
import ru.memo7.artel.data.api.ItemsResponse
import ru.memo7.artel.data.api.NotificationActionRequest
import ru.memo7.artel.data.api.NotificationsResponse
import ru.memo7.artel.data.api.OkResponse
import ru.memo7.artel.data.api.PatchItemRequest
import ru.memo7.artel.data.api.ProjectsResponse
import ru.memo7.artel.data.api.TodoActionRequest
import ru.memo7.artel.data.api.TodoAddRequest
import ru.memo7.artel.data.api.TodosResponse

/**
 * Single repository over the web API. Resolves the Retrofit client from the
 * credentials currently stored in DataStore and keeps a small in-memory cache
 * of the last successful reads so screens can paint instantly on re-entry.
 */
class ArtelRepository(private val store: CredentialsStore) {

    /** Для PATCH blog: null = «сбросить» — сервер различает «не передано» и explicit null. */
    private val patchJson = Json { explicitNulls = true; encodeDefaults = true; ignoreUnknownKeys = true }

    @Volatile private var apiHolder: Pair<Credentials, ArtelApi>? = null

    /** Last successful payloads, keyed by endpoint. Invalidated on writes. */
    @Volatile var cachedBootstrap: BootstrapResponse? = null
        private set
    @Volatile var cachedProjects: ProjectsResponse? = null
        private set
    @Volatile var cachedNotifications: NotificationsResponse? = null
        private set
    @Volatile var cachedAutomation: AutomationResponse? = null
        private set
    @Volatile var cachedCalendar: CalendarResponse? = null
        private set
    @Volatile var cachedGamification: GamificationResponse? = null
        private set
    @Volatile var cachedTodos: TodosResponse? = null
        private set
    @Volatile var cachedCourseLessons: CourseLessonsResponse? = null
        private set

    private suspend fun api(): Pair<Credentials, ArtelApi> {
        val credentials = store.settings.first().credentials
            ?: throw ApiError.BadResponse("Нет сохранённого подключения к серверу")
        apiHolder?.let { (known, api) -> if (known == credentials) return known to api }
        val fresh = ApiFactory.create(credentials)
        apiHolder = credentials to fresh
        return credentials to fresh
    }

    private suspend fun <T> call(block: suspend (ArtelApi) -> T): ApiResult<T> =
        withContext(Dispatchers.IO) {
            var usedToken: String? = null
            try {
                val (credentials, api) = api()
                usedToken = credentials.token
                ApiResult.Success(block(api))
            } catch (e: CancellationException) {
                // Отмена (например, запрос вытеснен новым поиском) — не сетевая ошибка.
                throw e
            } catch (e: HttpException) {
                // Только если сессия всё ещё та, которой шёл запрос: поздний 401
                // от старого запроса не должен разлогинить после повторного входа.
                if (e.code() == 401) usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e.toApiError())
            } catch (e: ApiError.Unauthorized) {
                // requireSuccess тоже бросает Unauthorized, но внутри block — до call не «доходит мимо».
                usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e)
            } catch (e: ApiError) {
                ApiResult.Failure(e)
            } catch (e: java.io.IOException) {
                ApiResult.Failure(ApiError.Network(e))
            } catch (e: Exception) {
                ApiResult.Failure(ApiError.Network(e))
            }
        }

    private fun HttpException.toApiError(): ApiError {
        val body = try {
            response()?.errorBody()?.string().orEmpty()
        } catch (_: Exception) {
            ""
        }
        val message = runCatching {
            ApiFactory.json.decodeFromString(ErrorResponse.serializer(), body).error
        }.getOrNull()
        return when (code()) {
            401 -> ApiError.Unauthorized()
            else -> ApiError.Server(code(), message ?: body.take(200))
        }
    }

    /* ---------- Reads ---------- */

    suspend fun bootstrap(): ApiResult<BootstrapResponse> = call { api ->
        api.bootstrap().also { cachedBootstrap = it }
    }

    suspend fun projects(): ApiResult<ProjectsResponse> = call { api ->
        api.projects().also { cachedProjects = it }
    }

    suspend fun items(projectId: Long): ApiResult<ItemsResponse> = call { api ->
        api.items(projectId)
    }

    suspend fun notifications(): ApiResult<NotificationsResponse> = call { api ->
        api.notifications().also { cachedNotifications = it }
    }

    suspend fun automation(): ApiResult<AutomationResponse> = call { api ->
        api.automation().also { cachedAutomation = it }
    }

    suspend fun calendar(days: Int = 30): ApiResult<CalendarResponse> = call { api ->
        api.calendar(days).also { cachedCalendar = it }
    }

    suspend fun faq(query: String): ApiResult<FaqResponse> = call { api ->
        api.faq(query)
    }

    suspend fun gamification(limit: Int = 30): ApiResult<GamificationResponse> = call { api ->
        api.gamification(limit).also { cachedGamification = it }
    }

    suspend fun todos(): ApiResult<TodosResponse> = call { api ->
        api.todos().also { cachedTodos = it }
    }

    suspend fun courseLessons(): ApiResult<CourseLessonsResponse> = call { api ->
        api.courseLessons().also { cachedCourseLessons = it }
    }

    suspend fun courseLesson(slug: String): ApiResult<CourseLessonResponse> = call { api ->
        api.courseLesson(slug)
    }

    /* ---------- Writes ---------- */

    suspend fun createProject(name: String, description: String?, color: String?): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.createProject(CreateProjectRequest(name, description?.takeIf { it.isNotBlank() }, color))
            requireSuccess(response, "Не удалось создать проект")
        }

    suspend fun createItem(request: CreateItemRequest): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.createItem(request)
            requireSuccess(response, "Не удалось создать запись")
        }

    suspend fun setItemDone(id: Long, done: Boolean): ApiResult<OkResponse> =
        call { api ->
            // PATCH /api/workspace/items/[id]; id остаётся в body — требует схема.
            val response = api.patchItem(id, PatchItemRequest(id, done))
            requireSuccess(response, "Не удалось обновить запись")
        }

    suspend fun markAllNotificationsRead(): ApiResult<OkResponse> =
        call { api ->
            val response = api.notificationAction(NotificationActionRequest(action = "markAllRead"))
            requireSuccess(response, "Не удалось отметить уведомления")
        }.also { result -> if (result is ApiResult.Success) cachedNotifications = null }

    suspend fun markNotificationRead(id: Long): ApiResult<Unit> =
        call { api ->
            val response = api.notificationAction(NotificationActionRequest(action = "markRead", id = id))
            requireSuccess(response, "Не удалось отметить уведомление")
            Unit
        }.also { result -> if (result is ApiResult.Success) cachedNotifications = null }

    suspend fun runAutomation(blogId: Long): ApiResult<AutomationRunResponse> =
        call { api ->
            val response = api.automationAction(AutomationRunRequest(blogId = blogId))
            requireSuccess(response, "Не удалось запустить правило")
        }.also { cachedAutomation = null }

    suspend fun configureAutomation(blogId: Long, enabled: Boolean, intervalMinutes: Int, autoPublish: Boolean): ApiResult<OkResponse> =
        call { api ->
            val response = api.automationConfigure(
                AutomationConfigureRequest(blogId = blogId, enabled = enabled, intervalMinutes = intervalMinutes, autoPublish = autoPublish)
            )
            requireSuccess(response, "Не удалось сохранить настройки")
        }.also { cachedAutomation = null }

    suspend fun setStylePreset(slug: String, preset: String): ApiResult<Unit> =
        call { api ->
            val response = api.setBlogStyle(slug, BlogStyleRequest(preset))
            requireSuccess(response, "Не удалось сохранить стиль")
            Unit
        }.also { result -> if (result is ApiResult.Success) cachedAutomation = null }

    suspend fun syncCalendar(): ApiResult<CalendarSyncResponse> =
        call { api ->
            val response = api.calendarSync()
            requireSuccess(response, "Не удалось синхронизировать календарь")
        }.also { cachedCalendar = null }

    /** ICS-фид /api/calendar/feed.ics — байты файла для шеринга; чтение на Dispatchers.IO внутри call. */
    suspend fun downloadCalendarIcs(days: Int = 30): ApiResult<ByteArray> = call { api ->
        requireSuccess(api.calendarIcs(days), "Не удалось скачать календарь").bytes()
    }

    suspend fun addTodo(text: String, recurring: String?, intervalHours: Int?): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.addTodo(
                TodoAddRequest(text = text.trim(), recurring = recurring, intervalHours = intervalHours)
            )
            requireSuccess(response, "Не удалось добавить задачу")
        }.also { result -> if (result is ApiResult.Success) cachedTodos = null }

    suspend fun todoAction(id: Long, action: String): ApiResult<OkResponse> =
        call { api ->
            val response = api.todoAction(id, TodoActionRequest(action = action))
            requireSuccess(response, "Не удалось обновить задачу")
        }.also { result -> if (result is ApiResult.Success) cachedTodos = null }

    suspend fun askAssistant(message: String): ApiResult<AssistantResponse> = call { api ->
        api.assistant(AssistantRequest(message))
    }

    /* ---------- Chat ---------- */

    suspend fun chatSessions(): ApiResult<ChatSessionsResponse> = call { api ->
        api.chatSessions()
    }

    suspend fun createChatSession(strategy: String, system: String?): ApiResult<ChatSessionCreatedResponse> =
        call { api ->
            api.createChatSession(ChatCreateRequest(strategy = strategy, system = system?.takeIf { it.isNotBlank() }))
        }

    suspend fun chatSession(sessionId: String): ApiResult<ChatSessionResponse> = call { api ->
        api.chatSession(sessionId)
    }

    suspend fun resetChatSession(sessionId: String): ApiResult<ChatSessionResponse> = call { api ->
        api.patchChatSession(sessionId, ChatResetRequest(reset = true))
    }

    @Volatile private var chatStreamCall: Call? = null

    /** Отмена активного SSE-стрима («Остановить»): сервер обрывает LLM через req.signal. */
    fun cancelChatStream() {
        chatStreamCall?.cancel()
    }

    @Volatile private var sseCall: Call? = null

    /** Отмена активного generic SSE-стрима (rag/tg/blog/joker/evolute). */
    fun cancelSseStream() {
        sseCall?.cancel()
    }

    /**
     * Общий SSE-стрим для стриминговых endpoint'ов (rag/query, rag/chat/{id}, tg/collect,
     * evolute/agent, blog/news, blog/scout, joke/session): безымянные события `data: <JSON>`
     * через `\n\n`. [path] — относительный путь после base URL (напр. "api/rag/query"),
     * [bodyJson] — сериализованное тело POST, события — сырые JSON-payload'ы в [onEvent].
     * Отмена [cancelSseStream] возвращает Success с частичным результатом (как «Остановить» в чате).
     */
    suspend fun sseStream(path: String, bodyJson: String, onEvent: (String) -> Unit): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            var usedToken: String? = null
            try {
                val (credentials, _) = api()
                usedToken = credentials.token
                val request = Request.Builder()
                    .url(credentials.toRetrofitBaseUrl() + path)
                    .header("Authorization", "Bearer " + credentials.token.trim())
                    .post(bodyJson.toRequestBody("application/json".toMediaType()))
                    .build()
                // readTimeout = 0: паузы генерации не обрываем (холодный LLM, длинные пайплайны).
                val call = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build()
                    .newCall(request)
                sseCall = call
                call.execute().use { response ->
                    when {
                        response.code == 401 -> {
                            store.clearTokenIf(usedToken.orEmpty())
                            throw ApiError.Unauthorized()
                        }
                        !response.isSuccessful -> {
                            val raw = response.body?.string().orEmpty()
                            val message = runCatching {
                                ApiFactory.json.decodeFromString(ErrorResponse.serializer(), raw).error
                            }.getOrNull()
                            throw ApiError.Server(response.code, message ?: raw.take(200))
                        }
                    }
                    val source = response.body?.source() ?: throw ApiError.BadResponse("Пустой ответ сервера")
                    val buffer = StringBuilder()
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val line = source.readUtf8Line() ?: break
                        buffer.append(line).append('\n')
                        SseParser.drain(buffer, onEvent)
                    }
                    ApiResult.Success(Unit)
                }
            } catch (e: CancellationException) {
                sseCall?.cancel()
                throw e
            } catch (e: ApiError.Unauthorized) {
                usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e)
            } catch (e: ApiError) {
                ApiResult.Failure(e)
            } catch (e: java.io.IOException) {
                if (sseCall?.isCanceled() == true) ApiResult.Success(Unit) else ApiResult.Failure(ApiError.Network(e))
            } catch (e: Exception) {
                ApiResult.Failure(ApiError.Network(e))
            }
        }

    /**
     * SSE-стрим ответа POST /api/chat/{sessionId}: безымянные события `data: <JSON>`,
     * разделитель `\n\n`, конец потока = закрытие соединения сервером.
     * Токены отдаются в [onEvent] по мере поступления; HTTP-ошибки маппятся как в [call].
     */
    suspend fun chatStream(sessionId: String, text: String, onEvent: (ChatStreamEvent) -> Unit): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            var usedToken: String? = null
            try {
                val (credentials, _) = api()
                usedToken = credentials.token
                val request = Request.Builder()
                    .url(credentials.toRetrofitBaseUrl() + "api/chat/" + sessionId)
                    .header("Authorization", "Bearer " + credentials.token.trim())
                    .post(
                        ApiFactory.json
                            .encodeToString(ChatSendRequest.serializer(), ChatSendRequest(text = text))
                            .toRequestBody("application/json".toMediaType()),
                    )
                    .build()
                // Стрим: connect как у обычных запросов, readTimeout = 0 — паузы генерации не обрываем.
                val call = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build()
                    .newCall(request)
                chatStreamCall = call
                call.execute().use { response ->
                    when {
                        response.code == 401 -> {
                            store.clearTokenIf(usedToken.orEmpty())
                            throw ApiError.Unauthorized()
                        }
                        !response.isSuccessful -> {
                            val raw = response.body?.string().orEmpty()
                            val message = runCatching {
                                ApiFactory.json.decodeFromString(ErrorResponse.serializer(), raw).error
                            }.getOrNull()
                            throw ApiError.Server(response.code, message ?: raw.take(200))
                        }
                    }
                    val source = response.body?.source() ?: throw ApiError.BadResponse("Пустой ответ сервера")
                    val buffer = StringBuilder()
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val line = source.readUtf8Line() ?: break
                        buffer.append(line).append('\n')
                        ChatSseParser.drain(buffer, onEvent)
                    }
                    ApiResult.Success(Unit)
                }
            } catch (e: CancellationException) {
                chatStreamCall?.cancel()
                throw e
            } catch (e: ApiError.Unauthorized) {
                usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e)
            } catch (e: ApiError) {
                ApiResult.Failure(e)
            } catch (e: java.io.IOException) {
                // OkHttp cancel бьёт чтение сокета IOException("Canceled …") — это команда
                // «Остановить», а не сетевой сбой: незакрытый partial остаётся в UI.
                if (chatStreamCall?.isCanceled() == true) ApiResult.Success(Unit) else ApiResult.Failure(ApiError.Network(e))
            } catch (e: Exception) {
                ApiResult.Failure(ApiError.Network(e))
            }
        }

    /* ---------- RAG ---------- */

    suspend fun ragChats(): ApiResult<RagChatListResponse> = call { api ->
        api.ragChatList()
    }

    suspend fun ragAliases(): ApiResult<RagChatsResponse> = call { api ->
        api.ragChatCatalog()
    }

    suspend fun createRagChat(title: String?): ApiResult<RagChatCreatedResponse> = call { api ->
        api.createRagChat(RagChatCreateRequest(title))
    }

    suspend fun ragAliasAdd(name: String, chatKey: String, topicId: Int?): ApiResult<RagAliasActionResponse> =
        call { api ->
            api.ragAliasAction(RagAliasActionRequest(action = "add", name = name, chatKey = chatKey, topicId = topicId))
        }

    suspend fun ragAliasRm(name: String): ApiResult<RagAliasActionResponse> = call { api ->
        api.ragAliasAction(RagAliasActionRequest(action = "rm", name = name))
    }

    suspend fun ragChat(chatId: String): ApiResult<RagChatDetailResponse> = call { api ->
        api.ragChat(chatId)
    }

    suspend fun patchRagChat(chatId: String, request: RagChatPatchRequest): ApiResult<RagChatPatchResponse> =
        call { api -> api.patchRagChat(chatId, request) }

    suspend fun ragNotes(): ApiResult<RagNotesResponse> = call { api ->
        api.ragNotes()
    }

    suspend fun ragNoteAdd(title: String, text: String): ApiResult<RagNoteAddResponse> = call { api ->
        api.addRagNote(RagNoteAddRequest(title, text))
    }

    suspend fun ragNoteDelete(source: String): ApiResult<RagNoteDeleteResponse> = call { api ->
        api.deleteRagNote(RagNoteDeleteRequest(source))
    }

    /* ---------- Telegram ---------- */

    suspend fun tgTop(chatKey: String, topicId: Int?, limit: Int?, by: String?): ApiResult<TgTopResponse> =
        call { api -> api.tgTop(chatKey, topicId, limit, by) }

    suspend fun tgCollect(
        chatRef: String,
        topicId: Int?,
        limit: Int?,
        reset: Boolean?,
        onEvent: (TgCollectEvent) -> Unit,
    ): ApiResult<Unit> {
        val body = ApiFactory.json.encodeToString(TgCollectRequest.serializer(), TgCollectRequest(chatRef, topicId, limit, reset))
        return sseStream("api/tg/collect", body) { raw -> TgSseParser.parseCollect(raw)?.let(onEvent) }
    }

    suspend fun telegramHistory(limit: Int?): ApiResult<TelegramHistoryResponse> = call { api ->
        api.telegramHistory(limit)
    }

    suspend fun telegramPublish(text: String, parseMode: String?): ApiResult<TelegramPublishResponse> = call { api ->
        api.telegramPublish(TelegramPublishRequest(text, parseMode))
    }

    suspend fun evoluteAgent(
        query: String,
        history: List<EvoluteHistoryMessageDto>,
        k: Int?,
        llm: String?,
        noRag: Boolean,
        onEvent: (EvoluteEvent) -> Unit,
    ): ApiResult<Unit> {
        val body = ApiFactory.json.encodeToString(
            EvoluteAgentRequest.serializer(),
            EvoluteAgentRequest(query, history, k, llm, noRag),
        )
        return sseStream("api/evolute/agent", body) { raw -> TgSseParser.parseEvolute(raw)?.let(onEvent) }
    }

    /** «Остановить» для evolute-стрима: тот же generic SSE-cancel. */
    fun cancelEvoluteStream() {
        cancelSseStream()
    }

    /* ---------- MCP ---------- */

    suspend fun mcpTools(): ApiResult<McpToolsResponse> = call { api ->
        api.mcpTools()
    }

    suspend fun mcpCall(tool: String, args: JsonObject?): ApiResult<McpCallResponse> = call { api ->
        api.mcpCall(McpCallRequest(tool, args))
    }

    /* ---------- Blog ---------- */

    suspend fun blogs(): ApiResult<BlogsResponse> = call { api ->
        api.blogs()
    }

    suspend fun createBlog(request: BlogCreateRequest): ApiResult<BlogCreateResponse> = call { api ->
        api.createBlog(request)
    }

    suspend fun blogPulse(): ApiResult<BlogPulseResponse> = call { api ->
        api.blogPulse()
    }

    suspend fun blog(slug: String): ApiResult<BlogDetailResponse> = call { api ->
        api.blog(slug)
    }

    /** PATCH /api/blogs/{slug} с частичным телом: отправляем только изменённые ключи,
     *  иначе null-поля сбрасывают чужие настройки. */
    suspend fun patchBlog(slug: String, body: JsonObject): ApiResult<PatchBlogResponse> = call { api ->
        val request = patchJson.encodeToString(JsonObject.serializer(), body)
            .toRequestBody("application/json".toMediaType())
        api.patchBlog(slug, request)
    }

    suspend fun blogAgentPrompts(slug: String): ApiResult<BlogAgentPromptsResponse> = call { api ->
        api.blogAgentPrompts(slug)
    }

    suspend fun putBlogAgentPrompt(
        slug: String,
        agent: String,
        prompt: String?,
    ): ApiResult<PutBlogAgentPromptResponse> = call { api ->
        val body = patchJson.encodeToString(JsonObject.serializer(), blogAgentPromptJson(agent, prompt))
            .toRequestBody("application/json".toMediaType())
        api.putBlogAgentPrompt(slug, body)
    }

    suspend fun blogPosts(limit: Int?, blog: String?): ApiResult<BlogPostsResponse> = call { api ->
        api.blogPosts(limit, blog)
    }

    suspend fun blogPost(id: Long): ApiResult<BlogPostResponse> = call { api ->
        api.blogPost(id)
    }

    suspend fun patchBlogPost(id: Long, content: String): ApiResult<PatchPostResponse> = call { api ->
        api.patchBlogPost(id, PatchPostRequest(content))
    }

    suspend fun deleteBlogPost(id: Long): ApiResult<OkResponse> = call { api ->
        requireSuccess(api.deleteBlogPost(id), "Не удалось удалить пост")
    }

    suspend fun publishBlogPost(id: Long): ApiResult<PublishPostResponse> = call { api ->
        api.publishBlogPost(id)
    }

    suspend fun generateBlogPosts(slug: String, request: GeneratePostsRequest): ApiResult<GeneratePostsResponse> =
        call { api -> api.generateBlogPosts(slug, request) }

    suspend fun blogStyle(blog: String?): ApiResult<StyleSamplesResponse> = call { api ->
        api.blogStyle(blog)
    }

    suspend fun addBlogStyle(request: AddStyleSampleRequest): ApiResult<AddStyleSampleResponse> = call { api ->
        api.addBlogStyle(request)
    }

    suspend fun generateDigest(request: DigestGenerateRequest): ApiResult<DigestResponse> = call { api ->
        api.generateDigest(request)
    }

    suspend fun blogNews(request: BlogNewsRequest, onEvent: (BlogStreamEvent.NewsEvent) -> Unit): ApiResult<Unit> {
        val body = ApiFactory.json.encodeToString(BlogNewsRequest.serializer(), request)
        val buffer = StringBuilder()
        return sseStream("api/blog/news", body) { raw ->
            buffer.append(raw).append("\n\n")
            BlogSseParser.drainNews(buffer, onEvent)
        }
    }

    suspend fun blogScout(request: BlogScoutRequest, onEvent: (BlogStreamEvent.ScoutEvent) -> Unit): ApiResult<Unit> {
        val body = ApiFactory.json.encodeToString(BlogScoutRequest.serializer(), request)
        val buffer = StringBuilder()
        return sseStream("api/blog/scout", body) { raw ->
            buffer.append(raw).append("\n\n")
            BlogSseParser.drainScout(buffer, onEvent)
        }
    }

    suspend fun blogPipeline(): ApiResult<BlogPipelineDto> = call { api ->
        api.blogPipeline()
    }

    suspend fun blogPipelineAction(request: BlogPipelineTransitionRequest): ApiResult<BlogPipelineDto> = call { api ->
        api.blogPipelineTransition(request)
    }

    suspend fun blogPipelineAction(request: BlogPipelineResetRequest): ApiResult<BlogPipelineDto> = call { api ->
        api.blogPipelineReset(request)
    }

    suspend fun blogSchedule(slug: String): ApiResult<BlogScheduleResponse> = call { api ->
        api.blogSchedule(slug)
    }

    suspend fun putBlogSchedule(slug: String, request: PutBlogScheduleRequest): ApiResult<PutBlogScheduleResponse> =
        call { api -> api.putBlogSchedule(slug, request) }

    /* ---------- SYS ---------- */

    suspend fun agent(prompt: String, llm: String?): ApiResult<AgentResponse> = call { api ->
        api.agent(AgentRequest(prompt, llm))
    }

    suspend fun briefing(chatKey: String?, topicId: Int?): ApiResult<BriefingResponse> = call { api ->
        api.briefing(chatKey, topicId)
    }

    suspend fun summary(): ApiResult<SummaryResponse> = call { api ->
        api.summary()
    }

    /** POST /api/summary {publish:true} — внешний эффект (отправка в канал). */
    suspend fun publishSummary(): ApiResult<SummaryPublishResponse> = call { api ->
        api.publishSummary(SummaryPublishRequest(publish = true))
    }

    suspend fun adminServers(): ApiResult<AdminServersResponse> = call { api ->
        api.adminServers()
    }

    /* ---------- Integrations ---------- */

    suspend fun webhooks(): ApiResult<WebhooksResponse> = call { api ->
        api.webhooks()
    }

    suspend fun createWebhook(request: CreateWebhookRequest): ApiResult<CreatedIdResponse> = call { api ->
        requireSuccess(api.createWebhook(request), "Не удалось создать webhook")
    }

    suspend fun deleteWebhook(id: Long): ApiResult<OkResponse> = call { api ->
        requireSuccess(api.deleteWebhook(id), "Не удалось удалить webhook")
    }

    suspend fun inboundHooks(): ApiResult<InboundHooksResponse> = call { api ->
        api.inboundHooks()
    }

    suspend fun createInboundHook(request: CreateInboundHookRequest): ApiResult<CreateInboundHookResponse> = call { api ->
        requireSuccess(api.createInboundHook(request), "Не удалось создать inbound-хук")
    }

    suspend fun deleteInboundHook(id: Long): ApiResult<OkResponse> = call { api ->
        requireSuccess(api.deleteInboundHook(id), "Не удалось удалить inbound-хук")
    }

    /* ---------- Chat extras ---------- */

    suspend fun jokerSession(): ApiResult<JokerSessionResponse> = call { api ->
        api.jokerSession()
    }

    suspend fun resetJokerSession(): ApiResult<JokerSessionResponse> = call { api ->
        api.resetJokerSession(JokerResetRequest(reset = true))
    }

    suspend fun antonovRewrite(request: AntonovRewriteRequest): ApiResult<AntonovRewriteResponse> = call { api ->
        api.antonovRewrite(request)
    }

    suspend fun antonovThread(request: AntonovThreadRequest): ApiResult<AntonovThreadResponse> = call { api ->
        api.antonovThread(request)
    }

    suspend fun chatMemory(sessionId: String): ApiResult<MemoryViewDto> = call { api ->
        api.chatMemory(sessionId)
    }

    suspend fun chatMemoryAction(sessionId: String, request: MemoryActionRequest): ApiResult<MemoryActionResponse> =
        call { api -> api.chatMemoryAction(sessionId, request) }

    suspend fun chatBranches(sessionId: String): ApiResult<BranchViewDto> = call { api ->
        api.chatBranches(sessionId)
    }

    suspend fun chatBranchAction(sessionId: String, request: BranchActionRequest): ApiResult<BranchActionResponse> =
        call { api -> api.chatBranchAction(sessionId, request) }

    suspend fun chatProfile(sessionId: String): ApiResult<ProfileViewDto> = call { api ->
        api.chatProfile(sessionId)
    }

    suspend fun chatProfileAction(sessionId: String, request: ProfileActionRequest): ApiResult<ProfileActionResponse> =
        call { api -> api.chatProfileAction(sessionId, request) }

    /** Глобальный список ограничений — sessionId сервером игнорируется. */
    suspend fun constraints(): ApiResult<ConstraintsViewDto> = call { api ->
        api.chatConstraints("global")
    }

    suspend fun constraintsAction(request: ConstraintsActionRequest): ApiResult<ConstraintsActionResponse> = call { api ->
        api.chatConstraintsAction("global", request)
    }

    suspend fun createTicket(subject: String, body: String, contact: String?): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.createTicket(
                CreateTicketRequest(subject, body, contact?.takeIf { it.isNotBlank() })
            )
            requireSuccess(response, "Не удалось создать обращение")
        }

    private fun <T> requireSuccess(response: retrofit2.Response<T>, fallback: String): T {
        if (!response.isSuccessful) {
            val raw = response.errorBody()?.string().orEmpty()
            val message = runCatching {
                ApiFactory.json.decodeFromString(ErrorResponse.serializer(), raw).error
            }.getOrNull()
            throw when (response.code()) {
                401 -> ApiError.Unauthorized()
                else -> ApiError.Server(response.code(), message ?: raw.take(200).ifBlank { fallback })
            }
        }
        return response.body() ?: throw ApiError.BadResponse(fallback)
    }
}
