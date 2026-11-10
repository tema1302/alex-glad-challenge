package ru.memo7.artel.data.api

import okhttp3.ResponseBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/** Endpoints of the web API shared in the project contract. */
interface ArtelApi {

    @GET("api/mobile/bootstrap")
    suspend fun bootstrap(): BootstrapResponse

    @GET("api/workspace/projects")
    suspend fun projects(): ProjectsResponse

    @POST("api/workspace/projects")
    suspend fun createProject(@Body body: CreateProjectRequest): Response<CreatedIdResponse>

    @GET("api/workspace/items")
    suspend fun items(@Query("projectId") projectId: Long): ItemsResponse

    @POST("api/workspace/items")
    suspend fun createItem(@Body body: CreateItemRequest): Response<CreatedIdResponse>

    @PATCH("api/workspace/items/{id}")
    suspend fun patchItem(@Path("id") id: Long, @Body body: PatchItemRequest): Response<OkResponse>

    @GET("api/notifications")
    suspend fun notifications(): NotificationsResponse

    @POST("api/notifications")
    suspend fun notificationAction(@Body body: NotificationActionRequest): Response<OkResponse>

    @GET("api/automation")
    suspend fun automation(): AutomationResponse

    @POST("api/automation")
    suspend fun automationAction(@Body body: AutomationRunRequest): Response<AutomationRunResponse>

    @POST("api/automation")
    suspend fun automationConfigure(@Body body: AutomationConfigureRequest): Response<OkResponse>

    @PATCH("api/blogs/{slug}")
    suspend fun setBlogStyle(@Path("slug") slug: String, @Body body: BlogStyleRequest): Response<OkResponse>

    @GET("api/calendar")
    suspend fun calendar(@Query("days") days: Int = 30): CalendarResponse

    @Streaming
    @GET("api/calendar/feed.ics")
    suspend fun calendarIcs(@Query("days") days: Int = 30): Response<ResponseBody>

    @GET("api/gamification")
    suspend fun gamification(@Query("limit") limit: Int = 30): GamificationResponse

    @GET("api/todos")
    suspend fun todos(): TodosResponse

    @POST("api/todos")
    suspend fun addTodo(@Body body: TodoAddRequest): Response<CreatedIdResponse>

    @POST("api/todos/{id}")
    suspend fun todoAction(@Path("id") id: Long, @Body body: TodoActionRequest): Response<OkResponse>

    @POST("api/calendar/sync")
    suspend fun calendarSync(): Response<CalendarSyncResponse>

    @POST("api/assistant")
    suspend fun assistant(@Body body: AssistantRequest): AssistantResponse

    /* ---------- Chat ---------- */

    @GET("api/chat")
    suspend fun chatSessions(): ChatSessionsResponse

    @POST("api/chat")
    suspend fun createChatSession(@Body body: ChatCreateRequest): ChatSessionCreatedResponse

    @GET("api/chat/{sessionId}")
    suspend fun chatSession(@Path("sessionId") sessionId: String): ChatSessionResponse

    @PATCH("api/chat/{sessionId}")
    suspend fun patchChatSession(@Path("sessionId") sessionId: String, @Body body: ChatResetRequest): ChatSessionResponse

    @GET("api/support/faq")
    suspend fun faq(@Query("q") query: String): FaqResponse

    @POST("api/support/tickets")
    suspend fun createTicket(@Body body: CreateTicketRequest): Response<CreatedIdResponse>

    @GET("api/course/lessons")
    suspend fun courseLessons(): CourseLessonsResponse

    @GET("api/course/lessons/{slug}")
    suspend fun courseLesson(@Path("slug") slug: String): CourseLessonResponse

    /* ---------- RAG ---------- */

    @GET("api/rag/chats")
    suspend fun ragChatCatalog(): RagChatsResponse

    @POST("api/rag/chats")
    suspend fun ragAliasAction(@Body body: RagAliasActionRequest): RagAliasActionResponse

    @GET("api/rag/chat")
    suspend fun ragChatList(): RagChatListResponse

    @POST("api/rag/chat")
    suspend fun createRagChat(@Body body: RagChatCreateRequest): RagChatCreatedResponse

    @GET("api/rag/chat/{id}")
    suspend fun ragChat(@Path("id") id: String): RagChatDetailResponse

    @PATCH("api/rag/chat/{id}")
    suspend fun patchRagChat(@Path("id") id: String, @Body body: RagChatPatchRequest): RagChatPatchResponse

    @GET("api/rag/notes")
    suspend fun ragNotes(): RagNotesResponse

    @POST("api/rag/notes")
    suspend fun addRagNote(@Body body: RagNoteAddRequest): RagNoteAddResponse

    @HTTP(method = "DELETE", path = "api/rag/notes", hasBody = true)
    suspend fun deleteRagNote(@Body body: RagNoteDeleteRequest): RagNoteDeleteResponse

    /* ---------- Telegram ---------- */

    @GET("api/tg/top")
    suspend fun tgTop(
        @Query("chatKey") chatKey: String,
        @Query("topicId") topicId: Int? = null,
        @Query("limit") limit: Int? = null,
        @Query("by") by: String? = null,
    ): TgTopResponse

    @GET("api/telegram/history")
    suspend fun telegramHistory(@Query("limit") limit: Int? = null): TelegramHistoryResponse

    @POST("api/telegram/publish")
    suspend fun telegramPublish(@Body body: TelegramPublishRequest): TelegramPublishResponse

    /* ---------- MCP ---------- */

    @GET("api/mcp/tools")
    suspend fun mcpTools(): McpToolsResponse

    @POST("api/mcp/call")
    suspend fun mcpCall(@Body body: McpCallRequest): McpCallResponse

    /* ---------- Blog ---------- */

    @GET("api/blogs")
    suspend fun blogs(): BlogsResponse

    @POST("api/blogs")
    suspend fun createBlog(@Body body: BlogCreateRequest): BlogCreateResponse

    @GET("api/blogs/{slug}")
    suspend fun blog(@Path("slug") slug: String): BlogDetailResponse

    @PATCH("api/blogs/{slug}")
    suspend fun patchBlog(@Path("slug") slug: String, @Body body: RequestBody): PatchBlogResponse

    @GET("api/blogs/{slug}/agent-prompts")
    suspend fun blogAgentPrompts(@Path("slug") slug: String): BlogAgentPromptsResponse

    @PUT("api/blogs/{slug}/agent-prompts")
    suspend fun putBlogAgentPrompt(
        @Path("slug") slug: String,
        @Body body: RequestBody,
    ): PutBlogAgentPromptResponse

    @GET("api/blog/pulse")
    suspend fun blogPulse(): BlogPulseResponse

    @GET("api/blog/posts")
    suspend fun blogPosts(
        @Query("limit") limit: Int? = null,
        @Query("blog") blog: String? = null,
    ): BlogPostsResponse

    @GET("api/blog/posts/{id}")
    suspend fun blogPost(@Path("id") id: Long): BlogPostResponse

    @PATCH("api/blog/posts/{id}")
    suspend fun patchBlogPost(@Path("id") id: Long, @Body body: PatchPostRequest): PatchPostResponse

    @DELETE("api/blog/posts/{id}")
    suspend fun deleteBlogPost(@Path("id") id: Long): Response<OkResponse>

    @POST("api/blog/posts/{id}/publish")
    suspend fun publishBlogPost(@Path("id") id: Long): PublishPostResponse

    @POST("api/blogs/{slug}/posts")
    suspend fun generateBlogPosts(
        @Path("slug") slug: String,
        @Body body: GeneratePostsRequest,
    ): GeneratePostsResponse

    @GET("api/blog/style")
    suspend fun blogStyle(@Query("blog") blog: String? = null): StyleSamplesResponse

    @POST("api/blog/style")
    suspend fun addBlogStyle(@Body body: AddStyleSampleRequest): AddStyleSampleResponse

    @POST("api/blog/digest/generate")
    suspend fun generateDigest(@Body body: DigestGenerateRequest): DigestResponse

    @GET("api/blog/pipeline")
    suspend fun blogPipeline(): BlogPipelineDto

    @POST("api/blog/pipeline")
    suspend fun blogPipelineTransition(@Body body: BlogPipelineTransitionRequest): BlogPipelineDto

    @POST("api/blog/pipeline")
    suspend fun blogPipelineReset(@Body body: BlogPipelineResetRequest): BlogPipelineDto

    @GET("api/blogs/{slug}/schedule")
    suspend fun blogSchedule(@Path("slug") slug: String): BlogScheduleResponse

    @PUT("api/blogs/{slug}/schedule")
    suspend fun putBlogSchedule(
        @Path("slug") slug: String,
        @Body body: PutBlogScheduleRequest,
    ): PutBlogScheduleResponse

    /* ---------- SYS (agent / briefing / summary / admin servers) ---------- */

    @POST("api/agent")
    suspend fun agent(@Body body: AgentRequest): AgentResponse

    @GET("api/briefing")
    suspend fun briefing(
        @Query("chatKey") chatKey: String? = null,
        @Query("topicId") topicId: Int? = null,
    ): BriefingResponse

    @GET("api/summary")
    suspend fun summary(): SummaryResponse

    @POST("api/summary")
    suspend fun publishSummary(@Body body: SummaryPublishRequest): SummaryPublishResponse

    @GET("api/admin/servers")
    suspend fun adminServers(): AdminServersResponse

    /* ---------- Integrations ---------- */

    @GET("api/integrations/webhooks")
    suspend fun webhooks(): WebhooksResponse

    @POST("api/integrations/webhooks")
    suspend fun createWebhook(@Body body: CreateWebhookRequest): Response<CreatedIdResponse>

    @DELETE("api/integrations/webhooks/{id}")
    suspend fun deleteWebhook(@Path("id") id: Long): Response<OkResponse>

    @GET("api/integrations/inbound")
    suspend fun inboundHooks(): InboundHooksResponse

    @POST("api/integrations/inbound")
    suspend fun createInboundHook(@Body body: CreateInboundHookRequest): Response<CreateInboundHookResponse>

    @DELETE("api/integrations/inbound/{id}")
    suspend fun deleteInboundHook(@Path("id") id: Long): Response<OkResponse>

    /* ---------- Chat extras (joker / antonov / panels) ---------- */

    @GET("api/joke/session")
    suspend fun jokerSession(): JokerSessionResponse

    @PATCH("api/joke/session")
    suspend fun resetJokerSession(@Body body: JokerResetRequest): JokerSessionResponse

    @POST("api/antonov/rewrite")
    suspend fun antonovRewrite(@Body body: AntonovRewriteRequest): AntonovRewriteResponse

    @POST("api/antonov/thread")
    suspend fun antonovThread(@Body body: AntonovThreadRequest): AntonovThreadResponse

    @GET("api/chat/{sessionId}/memory")
    suspend fun chatMemory(@Path("sessionId") sessionId: String): MemoryViewDto

    @POST("api/chat/{sessionId}/memory")
    suspend fun chatMemoryAction(@Path("sessionId") sessionId: String, @Body body: MemoryActionRequest): MemoryActionResponse

    @GET("api/chat/{sessionId}/branch")
    suspend fun chatBranches(@Path("sessionId") sessionId: String): BranchViewDto

    @POST("api/chat/{sessionId}/branch")
    suspend fun chatBranchAction(@Path("sessionId") sessionId: String, @Body body: BranchActionRequest): BranchActionResponse

    @GET("api/chat/{sessionId}/profile")
    suspend fun chatProfile(@Path("sessionId") sessionId: String): ProfileViewDto

    @POST("api/chat/{sessionId}/profile")
    suspend fun chatProfileAction(@Path("sessionId") sessionId: String, @Body body: ProfileActionRequest): ProfileActionResponse

    @GET("api/chat/{sessionId}/constraints")
    suspend fun chatConstraints(@Path("sessionId") sessionId: String): ConstraintsViewDto

    @POST("api/chat/{sessionId}/constraints")
    suspend fun chatConstraintsAction(@Path("sessionId") sessionId: String, @Body body: ConstraintsActionRequest): ConstraintsActionResponse
}
