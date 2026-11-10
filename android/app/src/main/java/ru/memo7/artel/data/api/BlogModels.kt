// DTO блог-поверхностей web API (#146): /api/blogs, /api/blog/posts, style,
// digest/generate, news/scout (SSE), pipeline, blogs/{slug}/schedule.
// Поля — как в ответах сервера: snake_case через @SerialName, camelCase как есть.
// Контракты сверены с web/app/api/blog/** и web/app/api/blogs/**.
package ru.memo7.artel.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ---------- Блоги ---------- */

/**
 * GET /api/blogs (строка списка) и GET/PATCH /api/blogs/{slug} (деталь).
 * Деталь добавляет tgChatId/systemPrompt/contextPrompt/sources — в списке их нет,
 * дефолты закрывают оба случая одним классом.
 */
@Serializable
data class BlogCountsDto(
    val posts: Int = 0,
    val news: Int = 0,
    val styleSamples: Int = 0,
    val postsLast7Days: Int = 0,
    val lastPostAt: String? = null,
)

@Serializable
data class BlogDto(
    val id: Long,
    val slug: String,
    val name: String,
    val profile: String? = null,
    val hasProfile: Boolean = false,
    val sourcesCount: Int = 0,
    val tgChatIdSet: Boolean = false,
    val tgChatId: String? = null,
    val stylePreset: String = "default",
    val systemPrompt: String? = null,
    val contextPrompt: String? = null,
    val sources: List<String> = emptyList(),
    val status: String = "active",
    val archivedAt: String? = null,
    val counts: BlogCountsDto = BlogCountsDto(),
    val lastPostAt: String? = null,
    val agentPromptsCount: Int = 0,
    val readyForNews: Boolean = false,
    val createdAt: String = "",
)

@Serializable
data class BlogsResponse(
    val blogs: List<BlogDto> = emptyList(),
)

@Serializable
data class BlogDetailResponse(
    val blog: BlogDto,
)

/** PATCH /api/blogs/{slug}. null у profile/systemPrompt/contextPrompt/sources — сброс;
 * tgChatId "" — сброс (маппинг на сервере). Кодирование тела — с explicitNulls=true. */
@Serializable
data class PatchBlogRequest(
    val name: String? = null,
    val profile: String? = null,
    val tgChatId: String? = null,
    val stylePreset: String? = null,
    val systemPrompt: String? = null,
    val contextPrompt: String? = null,
    val sources: List<String>? = null,
)

@Serializable
data class PatchBlogResponse(
    val ok: Boolean,
    val blog: BlogDto,
)

/** POST /api/blogs — создание; null-поля не отправляются (ApiFactory.json). */
@Serializable
data class BlogCreateRequest(
    val slug: String,
    val name: String,
    val profile: String? = null,
    val tgChatId: String? = null,
    val stylePreset: String? = null,
    val sources: List<String>? = null,
)

@Serializable
data class BlogCreateResponse(
    val ok: Boolean = false,
    val blog: BlogDto,
)

/** GET /api/blogs/{slug}/agent-prompts — один агент реестра. */
@Serializable
data class BlogAgentPromptDto(
    val agent: String,
    val label: String = "",
    val description: String = "",
    val group: String = "content",
    val defaultPrompt: String = "",
    val prompt: String? = null,
    val effectivePrompt: String = "",
    val source: String = "default",
    val isOverridden: Boolean = false,
    val updatedAt: String? = null,
    val maxLength: Int = 8000,
    val editableScope: String = "",
)

@Serializable
data class BlogAgentPromptsResponse(
    val blog: BlogRefDto? = null,
    val prompts: List<BlogAgentPromptDto> = emptyList(),
)

@Serializable
data class BlogRefDto(
    val slug: String = "",
    val name: String = "",
)

/** PUT /api/blogs/{slug}/agent-prompts; prompt=null — сброс. */
@Serializable
data class PutBlogAgentPromptRequest(
    val agent: String,
    val prompt: String? = null,
)

@Serializable
data class PutBlogAgentPromptResponse(
    val ok: Boolean = false,
    val blog: BlogRefDto? = null,
    val prompt: BlogAgentPromptDto,
)

/** GET /api/blog/pulse — сводка для dashboard. */
@Serializable
data class BlogPulseTotalsDto(
    val blogs: Int = 0,
    val active: Int = 0,
    val needsAttention: Int = 0,
    val posts: Int = 0,
    val postsLast7Days: Int = 0,
    val customPrompts: Int = 0,
)

@Serializable
data class BlogPulseItemDto(
    val id: Long,
    val slug: String,
    val name: String,
    val hasProfile: Boolean = false,
    val sourcesCount: Int = 0,
    val readyForNews: Boolean = false,
    val counts: BlogCountsDto = BlogCountsDto(),
    val lastPostAt: String? = null,
    val agentPromptsCount: Int = 0,
)

@Serializable
data class BlogPulseResponse(
    val generatedAt: String = "",
    val totals: BlogPulseTotalsDto = BlogPulseTotalsDto(),
    val blogs: List<BlogPulseItemDto> = emptyList(),
)

/* ---------- Посты ---------- */

/** PostRow из core db.ts — колонки posts буквально. */
@Serializable
data class PostDto(
    val id: Long,
    @SerialName("news_id") val newsId: Long? = null,
    val content: String,
    val verdict: String? = null,
    val topic: String? = null,
    val variant: Int = 0,
    @SerialName("created_at") val createdAt: String,
    @SerialName("blog_id") val blogId: Long? = null,
)

/** blog поста: список отдаёт {id,slug,name}, деталь добавляет tgChatId. */
@Serializable
data class PostBlogRefDto(
    val id: Long,
    val slug: String,
    val name: String,
    val tgChatId: String? = null,
)

/** Последняя TG-публикация поста из outbox (status ok|error). */
@Serializable
data class PostTgDto(
    val status: String,
    val messageId: Long? = null,
    val createdAt: String,
    val error: String? = null,
)

/** GET /api/blog/posts — PostRow & {blog, tg}. */
@Serializable
data class PostListItemDto(
    val id: Long,
    @SerialName("news_id") val newsId: Long? = null,
    val content: String,
    val verdict: String? = null,
    val topic: String? = null,
    val variant: Int = 0,
    @SerialName("created_at") val createdAt: String,
    @SerialName("blog_id") val blogId: Long? = null,
    val blog: PostBlogRefDto? = null,
    val tg: PostTgDto? = null,
)

@Serializable
data class BlogPostsResponse(
    val posts: List<PostListItemDto> = emptyList(),
)

/** GET /api/blog/posts/{id} — post, blog и tg лежат рядом, не вложены. */
@Serializable
data class BlogPostResponse(
    val post: PostDto,
    val blog: PostBlogRefDto? = null,
    val tg: PostTgDto? = null,
)

/** PATCH /api/blog/posts/{id} — контент 1..8000. */
@Serializable
data class PatchPostRequest(
    val content: String,
)

@Serializable
data class PatchPostResponse(
    val ok: Boolean,
    val post: PostDto,
)

/** POST /api/blog/posts/{id}/publish. Успех 200 {ok,messageId};
 * 400/429/502 — {ok:false,error,errorKind?,retryAfter?} (тело HTTP-ошибки). */
@Serializable
data class PublishPostResponse(
    val ok: Boolean,
    val messageId: Long? = null,
    val error: String? = null,
    val errorKind: String? = null,
    val retryAfter: Long? = null,
)

/* ---------- Генерация по теме ---------- */

/** POST /api/blogs/{slug}/posts — topic 3..500, comment ≤1000, variants 1..3. */
@Serializable
data class GeneratePostsRequest(
    val topic: String,
    val comment: String? = null,
    val variants: Int? = null,
    val publishNow: Boolean? = null,
)

@Serializable
data class GeneratedPostDto(
    val id: Long,
    val variant: Int,
    val angle: String? = null,
    val content: String,
)

/** Результат publishNow: TgPublishOutcome сервера (ok/error/errorKind/retryAfter). */
@Serializable
data class PublishedOutcomeDto(
    val ok: Boolean,
    val messageId: Long? = null,
    val error: String? = null,
    val errorKind: String? = null,
    val retryAfter: Long? = null,
)

/** 201 {ok, posts, published}; published=null, если publishNow не задан. */
@Serializable
data class GeneratePostsResponse(
    val ok: Boolean,
    val posts: List<GeneratedPostDto> = emptyList(),
    val published: PublishedOutcomeDto? = null,
)

/* ---------- Стиль ---------- */

/** StyleSampleRow core db.ts: id, text, created_at, blog_id. */
@Serializable
data class StyleSampleDto(
    val id: Long,
    val text: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("blog_id") val blogId: Long? = null,
)

@Serializable
data class StyleSamplesResponse(
    val samples: List<StyleSampleDto> = emptyList(),
)

/** POST /api/blog/style — text 1..4000. 201 {ok:true,duplicated:false} /
 * 200 {ok:false,duplicated:true} — дубликат UNIQUE, не ошибка. */
@Serializable
data class AddStyleSampleRequest(
    val text: String,
    val blog: String? = null,
)

@Serializable
data class AddStyleSampleResponse(
    val ok: Boolean,
    val duplicated: Boolean = false,
)

/* ---------- Дайджест ---------- */

/** POST /api/blog/digest/generate — days 1..30 (дефолт сервера 7). */
@Serializable
data class DigestGenerateRequest(
    val days: Int? = null,
    val blog: String? = null,
)

@Serializable
data class DigestSourceDto(
    val title: String,
    val url: String,
)

/** 200 {ok,digest,newsCount,sources,truncated}; 409 empty-window; 502 LLM. */
@Serializable
data class DigestResponse(
    val ok: Boolean,
    val digest: String = "",
    val newsCount: Int = 0,
    val sources: List<DigestSourceDto> = emptyList(),
    val truncated: Boolean = false,
)

/* ---------- News (SSE) ---------- */

/** POST /api/blog/news — hours 1..168, top 1..50, forIndex ≥0, llm local|cloud. */
@Serializable
data class BlogNewsRequest(
    val hours: Int? = null,
    val top: Int? = null,
    val forIndex: Int? = null,
    val llm: String? = null,
    val blog: String? = null,
)

/** post в done-событии news: {id, content} либо null. */
@Serializable
data class NewsPostDto(
    val id: Long,
    val content: String,
)

@Serializable
data class TopNewsDto(
    val title: String,
    val score: Double = 0.0,
    val why: String = "",
)

/** Сырое SSE-событие news: stage {step} / done {post,topNews,verdict,notice?} / error {message}. */
@Serializable
data class BlogNewsEventDto(
    val type: String,
    val step: String? = null,
    val post: NewsPostDto? = null,
    val topNews: List<TopNewsDto> = emptyList(),
    val verdict: String? = null,
    val notice: String? = null,
    val message: String? = null,
)

/* ---------- Scout (SSE) ---------- */

/** POST /api/blog/scout — hours 1..168, topK 1..10, query ≤500;
 * enableTelegram по умолчанию выключен (MTProto), enableForum — включён. */
@Serializable
data class BlogScoutRequest(
    val hours: Int? = null,
    val topK: Int? = null,
    val query: String? = null,
    val enableTelegram: Boolean? = null,
    val enableForum: Boolean? = null,
    val llm: String? = null,
)

@Serializable
data class ScoutRankedDto(
    val title: String,
    val source: String,
    val hypeScore: Double = 0.0,
    val hypeReason: String = "",
    val orchestratorScore: Double = 0.0,
    val orchestratorReason: String = "",
    val url: String? = null,
)

@Serializable
data class ScoutAgentDto(
    val agent: String,
    val count: Int = 0,
    val error: String? = null,
)

/** Сырое SSE-событие scout: stage {step} / done {ranked,agents} / error {message}. */
@Serializable
data class BlogScoutEventDto(
    val type: String,
    val step: String? = null,
    val ranked: List<ScoutRankedDto> = emptyList(),
    val agents: List<ScoutAgentDto> = emptyList(),
    val message: String? = null,
)

/* ---------- Пайплайн (FSM) ---------- */

/** Элемент history FSM: переход со стадии на стадию. */
@Serializable
data class PipelineHistoryEntryDto(
    val stage: String,
    val step: String,
    val timestamp: String,
    val detail: String,
)

/**
 * GET/POST /api/blog/pipeline отдают проекцию состояния напрямую (без {ok}):
 * stage/step/expectedAction/allowed/revisionCount/history/labels[/sandbox:true].
 * sandbox:true — гостевой режим (запросы без записи на диск).
 */
@Serializable
data class BlogPipelineDto(
    val stage: String,
    val step: String,
    val expectedAction: String,
    val allowed: List<String> = emptyList(),
    val revisionCount: Int = 0,
    val history: List<PipelineHistoryEntryDto> = emptyList(),
    val labels: Map<String, String> = emptyMap(),
    val sandbox: Boolean = false,
)

@Serializable
data class BlogPipelineTransitionRequest(
    val action: String = "transition",
    val to: String,
    val from: String? = null,
    val detail: String? = null,
)

@Serializable
data class BlogPipelineResetRequest(
    val action: String = "reset",
)

/* ---------- Расписание ---------- */

@Serializable
data class BlogScheduleDto(
    val id: Long,
    val dayOfWeek: Int,
    val timeLocal: String,
    val timezone: String,
    val topic: String? = null,
    val variants: Int = 1,
    val enabled: Boolean = true,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class BlogScheduleRunDto(
    val id: Long,
    val scheduleId: Long,
    val status: String,
    val attempts: Int = 0,
    val postId: Long? = null,
    val message: String? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
)

/** GET /api/blogs/{slug}/schedule → {ok,blog,schedules,runs}. */
@Serializable
data class BlogScheduleResponse(
    val ok: Boolean,
    val blog: PostBlogRefDto? = null,
    val schedules: List<BlogScheduleDto> = emptyList(),
    val runs: List<BlogScheduleRunDto> = emptyList(),
)

/** PUT /api/blogs/{slug}/schedule — ПОЛНАЯ замена, max 14 entries. */
@Serializable
data class BlogScheduleEntryDto(
    val dayOfWeek: Int,
    val timeLocal: String,
    val timezone: String? = null,
    val topic: String? = null,
    val variants: Int? = null,
    val enabled: Boolean? = null,
)

@Serializable
data class PutBlogScheduleRequest(
    val entries: List<BlogScheduleEntryDto>,
)

@Serializable
data class PutBlogScheduleResponse(
    val ok: Boolean,
    val schedules: List<BlogScheduleDto> = emptyList(),
)
