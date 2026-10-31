// Экраны блог-блока (#146). Хаб со списком блогов → меню разделов →
// посты (список/деталь/правка/публикация/удаление), генерация по теме,
// news/scout (SSE: кнопка → стадия → результат), дайджест, стиль, пайплайн FSM,
// расписание (PUT целиком), настройки блога (PATCH). Не-идемпотентные операции —
// с подтверждением и guard от двойного тапа (в VM). Все строки — русские,
// каждая поверхность имеет loading/error/empty.
package ru.memo7.artel.ui.screens.blog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.memo7.artel.core.UiState
import ru.memo7.artel.data.api.BlogDto
import ru.memo7.artel.data.api.BlogPipelineDto
import ru.memo7.artel.data.api.BlogScheduleEntryDto
import ru.memo7.artel.data.api.BlogScheduleResponse
import ru.memo7.artel.data.api.DigestResponse
import ru.memo7.artel.data.api.GeneratePostsResponse
import ru.memo7.artel.data.api.PatchBlogRequest
import ru.memo7.artel.data.api.PostListItemDto
import ru.memo7.artel.data.api.PostTgDto
import ru.memo7.artel.data.api.PublishedOutcomeDto
import ru.memo7.artel.data.api.StyleSampleDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.projects.formatRuDate
import ru.memo7.artel.ui.theme.ArtelShapes

/* ---------- Лимиты полей (зеркало zod-схем сервера) ---------- */

private const val MAX_POST_CONTENT_LENGTH = 8000
private const val MAX_TOPIC_LENGTH = 500
private const val MIN_TOPIC_LENGTH = 3
private const val MAX_COMMENT_LENGTH = 1000
private const val MAX_STYLE_TEXT_LENGTH = 4000
private const val MAX_BLOG_NAME_LENGTH = 120
private const val MAX_BLOG_PROMPT_LENGTH = 8000
private const val MAX_SOURCES_COUNT = 20
private const val MAX_SCHEDULE_ENTRIES = 14
private const val MAX_TRANSITION_DETAIL_LENGTH = 500
private const val DEFAULT_POSTS_LIMIT = 20

private val TIME_LOCAL_REGEX = Regex("""^([01]\d|2[0-3]):[0-5]\d$""")
private val DAY_NAMES = listOf("Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб")

/** Разделы меню блога — входы из хаба. */
private enum class BlogSection(val label: String, val hint: String) {
    POSTS("Посты", "Лента постов с статусом отправки в Telegram"),
    GENERATE("Генерация по теме", "Ручной пост по теме, до 3 вариантов"),
    NEWS("Новости", "News-пайплайн: RSS → агенты → пост"),
    SCOUT("Scout", "Разведка хайповых тем по источникам"),
    DIGEST("Дайджест", "Сводка новостей за N дней"),
    STYLE("Стиль", "Образцы стиля для генерации"),
    PIPELINE("Пайплайн", "Состояние FSM блог-агентов"),
    SCHEDULE("Расписание", "Недельное расписание постов"),
    SETTINGS("Настройки блога", "Имя, профиль, промпты, источники"),
}

@Composable
private fun blogViewModel(container: AppContainer, scope: String, slug: String?): BlogViewModel =
    viewModel(
        key = "blog-$scope-${slug ?: "common"}",
        factory = viewModelFactory { initializer { BlogViewModel(container.repository, slug) } },
    )

/* ---------- Общие примитивы ---------- */

@Composable
private fun BlogHeader(title: String, subtitle: String?, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 12.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Результат мутации под формой: успех — спокойный, ошибка — красная. */
@Composable
private fun OpStateText(state: OpState, modifier: Modifier = Modifier) {
    when (state) {
        is OpState.Done -> Text(
            state.message,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = modifier,
        )
        is OpState.Failed -> Text(
            state.message,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier,
        )
        else -> Unit
    }
}

@Composable
private fun ActionButton(
    label: String,
    busy: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(onClick = onClick, enabled = enabled && !busy, shape = ArtelShapes.pill, modifier = modifier) {
        Text(if (busy) "Выполняется…" else label)
    }
}

@Composable
private fun TgStatusBadge(tg: PostTgDto?, modifier: Modifier = Modifier) {
    when {
        tg == null -> PillBadge("Не отправлен в TG", MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
        tg.status == "ok" -> PillBadge("TG ✓ №${tg.messageId ?: "?"}", MaterialTheme.colorScheme.primary, modifier = modifier)
        else -> PillBadge("TG ошибка", MaterialTheme.colorScheme.error, modifier = modifier)
    }
}

@Composable
private fun FieldLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(bottom = 4.dp),
    )
}

/* ---------- Хаб: список блогов ---------- */

@Composable
fun BlogHubScreen(container: AppContainer, onBack: () -> Unit) {
    val vm = blogViewModel(container, "hub", null)
    val blogs by vm.blogs.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<BlogDto?>(null) }

    LaunchedEffect(Unit) { vm.loadBlogs() }

    val current = selected
    if (current != null) {
        BlogMenuScreen(container, current, onBack = { selected = null })
        return
    }
    Column(Modifier.fillMaxSize()) {
        BlogHeader("Блог", "Выберите блог", onBack)
        StateContainer(
            state = blogs,
            onRetry = vm::loadBlogs,
            emptyCheck = { it.isEmpty() },
            emptyMessage = "Блогов пока нет",
            emptyHint = "Блоги создаются на сервере, в веб-интерфейсе",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { list ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(list, key = { it.id }) { blog ->
                    BentoCard(onClick = { selected = blog }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(18.dp)) {
                            Text(blog.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                blog.slug,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PillBadge("Стиль: ${blog.stylePreset}", MaterialTheme.colorScheme.primary)
                                if (blog.hasProfile) {
                                    PillBadge("Профиль голоса", MaterialTheme.colorScheme.secondary)
                                }
                                PillBadge(
                                    if (blog.tgChatIdSet) "TG задан" else "TG не задан",
                                    if (blog.tgChatIdSet) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                )
                                PillBadge("Источников: ${blog.sourcesCount}", MaterialTheme.colorScheme.tertiary)
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ---------- Меню разделов выбранного блога ---------- */

@Composable
private fun BlogMenuScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    var section by remember { mutableStateOf<BlogSection?>(null) }
    when (val current = section) {
        null -> Column(Modifier.fillMaxSize()) {
            BlogHeader(blog.name, "Раздел блога", onBack)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(BlogSection.values().toList(), key = { it.name }) { item ->
                    BentoCard(onClick = { section = item }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(18.dp)) {
                            Text(item.label, style = MaterialTheme.typography.titleMedium)
                            Text(
                                item.hint,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
        BlogSection.POSTS -> BlogPostsScreen(container, blog, onBack = { section = null })
        BlogSection.GENERATE -> BlogGenerateScreen(container, blog, onBack = { section = null })
        BlogSection.NEWS -> BlogNewsScreen(container, blog, onBack = { section = null })
        BlogSection.SCOUT -> BlogScoutScreen(container, blog, onBack = { section = null })
        BlogSection.DIGEST -> BlogDigestScreen(container, blog, onBack = { section = null })
        BlogSection.STYLE -> BlogStyleScreen(container, blog, onBack = { section = null })
        BlogSection.PIPELINE -> BlogPipelineScreen(container, onBack = { section = null })
        BlogSection.SCHEDULE -> BlogScheduleScreen(container, blog, onBack = { section = null })
        BlogSection.SETTINGS -> BlogSettingsScreen(container, blog, onBack = { section = null })
    }
}

/* ---------- Посты: список ---------- */

@Composable
private fun BlogPostsScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "posts", blog.slug)
    val posts by vm.posts.collectAsStateWithLifecycle()
    var openPostId by remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(Unit) { vm.loadPosts(DEFAULT_POSTS_LIMIT) }

    val postId = openPostId
    if (postId != null) {
        BlogPostDetailScreen(container, postId, onBack = { openPostId = null })
        return
    }
    Column(Modifier.fillMaxSize()) {
        BlogHeader("Посты", blog.name, onBack)
        StateContainer(
            state = posts,
            onRetry = { vm.loadPosts(DEFAULT_POSTS_LIMIT) },
            emptyCheck = { it.isEmpty() },
            emptyMessage = "Постов пока нет",
            emptyHint = "Сгенерируйте пост по теме или запустите news-пайплайн",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { list ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(list, key = { it.id }) { post ->
                    PostRowCard(post, onClick = { openPostId = post.id })
                }
            }
        }
    }
}

@Composable
private fun PostRowCard(post: PostListItemDto, onClick: () -> Unit) {
    BentoCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    post.topic ?: "Пост №${post.id}",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                TgStatusBadge(tg = post.tg)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                post.content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                formatRuDate(post.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ---------- Посты: деталь / правка / публикация / удаление ---------- */

@Composable
private fun BlogPostDetailScreen(container: AppContainer, postId: Long, onBack: () -> Unit) {
    val vm = blogViewModel(container, "post-$postId", null)
    val detail by vm.postDetail.collectAsStateWithLifecycle()
    val save by vm.savePost.collectAsStateWithLifecycle()
    val delete by vm.deletePost.collectAsStateWithLifecycle()
    val publish by vm.publishPost.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf(false) }
    var editContent by remember { mutableStateOf("") }
    var confirmPublish by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadPost(postId) }
    // Пост удалён — возвращаемся к списку.
    LaunchedEffect(delete) {
        if (delete is OpState.Done) onBack()
    }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Пост", null, onBack)
        StateContainer(
            state = detail,
            onRetry = { vm.loadPost(postId) },
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(key = "content") {
                    BentoCard(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(18.dp)) {
                            Text(
                                data.post.topic ?: "Пост №${data.post.id}",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                listOfNotNull(
                                    data.blog?.name,
                                    formatRuDate(data.post.createdAt).takeIf { it.isNotBlank() },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(10.dp))
                            Text(data.post.content, style = MaterialTheme.typography.bodyMedium)
                            Spacer(Modifier.height(10.dp))
                            TgStatusBadge(tg = data.tg)
                            data.tg?.let { tg ->
                                Text(
                                    buildString {
                                        if (tg.createdAt.isNotBlank()) append("Отправлен: ${formatRuDate(tg.createdAt)}")
                                        tg.error?.let { append("\nОшибка: $it") }
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                item(key = "actions") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = {
                                    editContent = data.post.content
                                    editing = true
                                },
                                enabled = save !is OpState.Busy,
                                shape = ArtelShapes.pill,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Rounded.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Редактировать")
                            }
                            Button(
                                onClick = { confirmPublish = true },
                                enabled = publish !is OpState.Busy,
                                shape = ArtelShapes.pill,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Rounded.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(if (publish is OpState.Busy) "Публикуем…" else "Опубликовать")
                            }
                        }
                        TextButton(
                            onClick = { confirmDelete = true },
                            enabled = delete !is OpState.Busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Rounded.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Удалить пост", color = MaterialTheme.colorScheme.error)
                        }
                        OpStateText(save)
                        OpStateText(publish)
                        OpStateText(delete)
                    }
                }
            }
        }
    }

    if (editing) {
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text("Редактировать пост") },
            text = {
                OutlinedTextField(
                    value = editContent,
                    onValueChange = { editContent = it.take(MAX_POST_CONTENT_LENGTH) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 6,
                    supportingText = { Text("${editContent.length} / $MAX_POST_CONTENT_LENGTH") },
                )
            },
            confirmButton = {
                TextButton(
                    enabled = editContent.isNotBlank() && save !is OpState.Busy,
                    onClick = {
                        vm.savePost(postId, editContent.trim())
                        editing = false
                    },
                ) { Text("Сохранить") }
            },
            dismissButton = {
                TextButton(onClick = { editing = false }) { Text("Отмена") }
            },
        )
    }
    if (confirmPublish) {
        AlertDialog(
            onDismissRequest = { confirmPublish = false },
            title = { Text("Опубликовать пост?") },
            text = {
                Text("Пост будет отправлен в Telegram-канал блога. Каждый вызов переотправляет пост — повторная публикация создаст ещё одно сообщение.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmPublish = false
                        vm.publishPost(postId)
                    },
                ) { Text("Опубликовать") }
            },
            dismissButton = {
                TextButton(onClick = { confirmPublish = false }) { Text("Отмена") }
            },
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Удалить пост?") },
            text = { Text("Пост будет удалён без возможности восстановления.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = false
                        vm.deletePost(postId)
                    },
                ) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("Отмена") }
            },
        )
    }
}

/* ---------- Генерация по теме ---------- */

@Composable
private fun BlogGenerateScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "generate", blog.slug)
    val generate by vm.generate.collectAsStateWithLifecycle()
    var topic by remember { mutableStateOf("") }
    var comment by remember { mutableStateOf("") }
    var variants by remember { mutableStateOf(1) }
    var publishNow by remember { mutableStateOf(false) }
    var confirmGenerate by remember { mutableStateOf(false) }

    val topicValid = topic.trim().length in MIN_TOPIC_LENGTH..MAX_TOPIC_LENGTH
    Column(Modifier.fillMaxSize()) {
        BlogHeader("Генерация по теме", blog.name, onBack)
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "form") {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        FieldLabel("Тема поста (от $MIN_TOPIC_LENGTH до $MAX_TOPIC_LENGTH символов)")
                        OutlinedTextField(
                            value = topic,
                            onValueChange = { topic = it.take(MAX_TOPIC_LENGTH) },
                            modifier = Modifier.fillMaxWidth(),
                            isError = topic.isNotEmpty() && !topicValid,
                            supportingText = { Text("${topic.trim().length} / $MAX_TOPIC_LENGTH") },
                        )
                        Spacer(Modifier.height(8.dp))
                        FieldLabel("Комментарий для автора (необязательно, до $MAX_COMMENT_LENGTH)")
                        OutlinedTextField(
                            value = comment,
                            onValueChange = { comment = it.take(MAX_COMMENT_LENGTH) },
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 2,
                        )
                        Spacer(Modifier.height(8.dp))
                        FieldLabel("Количество вариантов")
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            listOf(1, 2, 3).forEachIndexed { index, value ->
                                SegmentedButton(
                                    selected = variants == value,
                                    onClick = { variants = value },
                                    shape = SegmentedButtonDefaults.itemShape(index = index, count = 3),
                                ) { Text("$value") }
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Сразу опубликовать первый вариант",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            Switch(checked = publishNow, onCheckedChange = { publishNow = it })
                        }
                        Spacer(Modifier.height(10.dp))
                        ActionButton(
                            label = "Сгенерировать",
                            busy = generate is ActionState.Busy,
                            enabled = topicValid,
                            onClick = {
                                if (publishNow) confirmGenerate = true
                                else vm.generatePosts(topic.trim(), comment.trim(), variants, false)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            when (val state = generate) {
                is ActionState.Done -> {
                    item(key = "result") { GenerateResultCard(state.result) }
                }
                is ActionState.Failed -> {
                    item(key = "error") {
                        Text(
                            state.message,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
                else -> Unit
            }
        }
    }
    if (confirmGenerate) {
        AlertDialog(
            onDismissRequest = { confirmGenerate = false },
            title = { Text("Сгенерировать и опубликовать?") },
            text = {
                Text("Первый вариант будет отправлен в Telegram-канал блога. Публикация не идемпотентна: при повторе создастся ещё одно сообщение.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmGenerate = false
                        vm.generatePosts(topic.trim(), comment.trim(), variants, true)
                    },
                ) { Text("Сгенерировать") }
            },
            dismissButton = {
                TextButton(onClick = { confirmGenerate = false }) { Text("Отмена") }
            },
        )
    }
}

@Composable
private fun GenerateResultCard(response: GeneratePostsResponse, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        response.published?.let { published ->
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text("Публикация", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    PublishedOutcomeText(published)
                }
            }
        }
        response.posts.forEach { post ->
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Вариант ${post.variant}", style = MaterialTheme.typography.titleMedium)
                        post.angle?.let { angle ->
                            Spacer(Modifier.width(8.dp))
                            PillBadge(angle, MaterialTheme.colorScheme.secondary)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(post.content, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun PublishedOutcomeText(published: PublishedOutcomeDto, modifier: Modifier = Modifier) {
    if (published.ok) {
        Text(
            "Опубликовано в Telegram, сообщение №${published.messageId ?: "?"}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = modifier,
        )
    } else {
        val retry = published.retryAfter?.let { " Повторите через $it с." }.orEmpty()
        Text(
            "Публикация не удалась: ${published.error ?: "неизвестная ошибка"}.$retry",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier,
        )
    }
}

/* ---------- News (SSE) ---------- */

@Composable
private fun BlogNewsScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "news", blog.slug)
    val news by vm.news.collectAsStateWithLifecycle()
    var hours by remember { mutableStateOf("24") }
    var top by remember { mutableStateOf("10") }
    var forIndex by remember { mutableStateOf("") }
    var llm by remember { mutableStateOf("cloud") }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Новости", blog.name, onBack)
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "form") {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = hours,
                                onValueChange = { hours = it.filter(Char::isDigit).take(3) },
                                modifier = Modifier.weight(1f),
                                label = { Text("Часы (1–168)") },
                                singleLine = true,
                            )
                            OutlinedTextField(
                                value = top,
                                onValueChange = { top = it.filter(Char::isDigit).take(2) },
                                modifier = Modifier.weight(1f),
                                label = { Text("Топ (1–50)") },
                                singleLine = true,
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = forIndex,
                            onValueChange = { forIndex = it.filter(Char::isDigit).take(3) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Индекс новости для поста (необязательно, с 0)") },
                            singleLine = true,
                        )
                        Spacer(Modifier.height(8.dp))
                        FieldLabel("Модель")
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            listOf("cloud" to "Облачная", "local" to "Локальная").forEachIndexed { index, (value, label) ->
                                SegmentedButton(
                                    selected = llm == value,
                                    onClick = { llm = value },
                                    shape = SegmentedButtonDefaults.itemShape(index = index, count = 2),
                                ) { Text(label, style = MaterialTheme.typography.labelMedium) }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = {
                                vm.runNews(
                                    hours = hours.toIntOrNull(),
                                    top = top.toIntOrNull(),
                                    forIndex = forIndex.toIntOrNull(),
                                    llm = llm,
                                )
                            },
                            enabled = news !is StreamState.Running,
                            shape = ArtelShapes.pill,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (news is StreamState.Running) "Пайплайн работает…" else "Запустить news-пайплайн")
                        }
                    }
                }
            }
            when (val state = news) {
                is StreamState.Running -> item(key = "progress") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(state.stage, style = MaterialTheme.typography.labelMedium)
                    }
                }
                is StreamState.Done -> item(key = "result") { NewsResultCard(state.result) }
                is StreamState.Failed -> item(key = "error") {
                    Text(
                        state.message,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                StreamState.Idle -> Unit
            }
        }
    }
}

@Composable
private fun NewsResultCard(result: NewsResult, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        result.notice?.let { notice ->
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    notice,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.padding(18.dp),
                )
            }
        }
        result.verdict?.let { verdict ->
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text("Вердикт фактчекинга", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(verdict, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        result.post?.let { post ->
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text("Пост сохранён (№${post.id})", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(6.dp))
                    Text(post.content, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (result.topNews.isNotEmpty()) {
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Топ новостей", style = MaterialTheme.typography.titleMedium)
                    result.topNews.forEach { item ->
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    item.title,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f),
                                )
                                PillBadge("%.1f".format(item.score), MaterialTheme.colorScheme.primary)
                            }
                            if (item.why.isNotBlank()) {
                                Text(
                                    item.why,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ---------- Scout (SSE) ---------- */

@Composable
private fun BlogScoutScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "scout", blog.slug)
    val scout by vm.scout.collectAsStateWithLifecycle()
    var hours by remember { mutableStateOf("24") }
    var topK by remember { mutableStateOf("5") }
    var query by remember { mutableStateOf("") }
    var enableTelegram by remember { mutableStateOf(false) }
    var enableForum by remember { mutableStateOf(true) }
    var llm by remember { mutableStateOf("cloud") }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Scout", blog.name, onBack)
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "form") {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = hours,
                                onValueChange = { hours = it.filter(Char::isDigit).take(3) },
                                modifier = Modifier.weight(1f),
                                label = { Text("Часы (1–168)") },
                                singleLine = true,
                            )
                            OutlinedTextField(
                                value = topK,
                                onValueChange = { topK = it.filter(Char::isDigit).take(2) },
                                modifier = Modifier.weight(1f),
                                label = { Text("Топ-K (1–10)") },
                                singleLine = true,
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it.take(500) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Запрос для оркестратора (необязательно)") },
                            minLines = 2,
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Telegram-источники (нужна MTProto-сессия)",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            Switch(checked = enableTelegram, onCheckedChange = { enableTelegram = it })
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Форум-источники",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            Switch(checked = enableForum, onCheckedChange = { enableForum = it })
                        }
                        Spacer(Modifier.height(8.dp))
                        FieldLabel("Модель")
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            listOf("cloud" to "Облачная", "local" to "Локальная").forEachIndexed { index, (value, label) ->
                                SegmentedButton(
                                    selected = llm == value,
                                    onClick = { llm = value },
                                    shape = SegmentedButtonDefaults.itemShape(index = index, count = 2),
                                ) { Text(label, style = MaterialTheme.typography.labelMedium) }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = {
                                vm.runScout(
                                    hours = hours.toIntOrNull(),
                                    topK = topK.toIntOrNull(),
                                    query = query.trim(),
                                    enableTelegram = enableTelegram,
                                    enableForum = enableForum,
                                    llm = llm,
                                )
                            },
                            enabled = scout !is StreamState.Running,
                            shape = ArtelShapes.pill,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (scout is StreamState.Running) "Scout работает…" else "Запустить scout")
                        }
                    }
                }
            }
            when (val state = scout) {
                is StreamState.Running -> item(key = "progress") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(state.stage, style = MaterialTheme.typography.labelMedium)
                    }
                }
                is StreamState.Done -> item(key = "result") { ScoutResultCard(state.result) }
                is StreamState.Failed -> item(key = "error") {
                    Text(
                        state.message,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                StreamState.Idle -> Unit
            }
        }
    }
}

@Composable
private fun ScoutResultCard(result: ScoutResult, modifier: Modifier = Modifier) {
    val uriHandler = LocalUriHandler.current
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (result.ranked.isNotEmpty()) {
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Ранжированные темы", style = MaterialTheme.typography.titleMedium)
                    result.ranked.forEach { item ->
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    item.title,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f),
                                )
                                PillBadge(item.source, MaterialTheme.colorScheme.tertiary)
                            }
                            Text(
                                "Хайп ${"%.1f".format(item.hypeScore)} · Оркестратор ${"%.1f".format(item.orchestratorScore)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (item.orchestratorReason.isNotBlank()) {
                                Text(
                                    item.orchestratorReason,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            item.url?.let { url ->
                                TextButton(onClick = { uriHandler.openUri(url) }) { Text("Открыть источник") }
                            }
                        }
                    }
                }
            }
        }
        if (result.agents.isNotEmpty()) {
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Агенты-источники", style = MaterialTheme.typography.titleMedium)
                    result.agents.forEach { agent ->
                        Text(
                            agent.error?.let { "${agent.agent}: ошибка — $it" }
                                ?: "${agent.agent}: тем найдено — ${agent.count}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (agent.error != null) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }
        }
    }
}

/* ---------- Дайджест ---------- */

@Composable
private fun BlogDigestScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "digest", blog.slug)
    val digest by vm.digest.collectAsStateWithLifecycle()
    var days by remember { mutableStateOf("7") }

    val daysValid = (days.toIntOrNull() ?: -1) in 1..30
    Column(Modifier.fillMaxSize()) {
        BlogHeader("Дайджест", blog.name, onBack)
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "form") {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        OutlinedTextField(
                            value = days,
                            onValueChange = { days = it.filter(Char::isDigit).take(2) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Окно в днях (1–30, по умолчанию 7)") },
                            singleLine = true,
                            isError = days.isNotEmpty() && !daysValid,
                        )
                        Spacer(Modifier.height(10.dp))
                        ActionButton(
                            label = "Собрать дайджест",
                            busy = digest is ActionState.Busy,
                            enabled = daysValid,
                            onClick = { vm.generateDigest(days.toInt()) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            when (val state = digest) {
                is ActionState.Done -> item(key = "result") { DigestResultCard(state.result) }
                is ActionState.Failed -> item(key = "error") {
                    // 409 «За N дней новостей нет» и 502 LLM приходят сюда с текстом сервера.
                    Text(
                        state.message,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                else -> Unit
            }
        }
    }
}

@Composable
private fun DigestResultCard(result: DigestResponse, modifier: Modifier = Modifier) {
    val uriHandler = LocalUriHandler.current
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BentoCard(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Новостей в окне: ${result.newsCount}",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.weight(1f),
                    )
                    if (result.truncated) {
                        PillBadge("Сокращён до лимита TG", MaterialTheme.colorScheme.tertiary)
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(result.digest, style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (result.sources.isNotEmpty()) {
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Источники", style = MaterialTheme.typography.titleMedium)
                    result.sources.forEach { source ->
                        TextButton(onClick = { uriHandler.openUri(source.url) }) {
                            Text(source.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

/* ---------- Стиль ---------- */

@Composable
private fun BlogStyleScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "style", blog.slug)
    val samples by vm.styleSamples.collectAsStateWithLifecycle()
    val addState by vm.addStyle.collectAsStateWithLifecycle()
    var text by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadStyle() }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Стиль", blog.name, onBack)
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "add") {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        OutlinedTextField(
                            value = text,
                            onValueChange = { text = it.take(MAX_STYLE_TEXT_LENGTH) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Образец стиля (1–$MAX_STYLE_TEXT_LENGTH символов)") },
                            minLines = 3,
                        )
                        Spacer(Modifier.height(10.dp))
                        ActionButton(
                            label = "Добавить образец",
                            busy = addState is OpState.Busy,
                            enabled = text.trim().isNotEmpty(),
                            onClick = { vm.addStyle(text.trim()) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OpStateText(addState, Modifier.padding(top = 6.dp))
                    }
                }
            }
            when (val state = samples) {
                is UiState.Loading -> item(key = "loading") {
                    Text(
                        "Загружаем образцы…",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                }
                is UiState.Error -> item(key = "error-state") {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Text(
                            state.message,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                        TextButton(onClick = vm::loadStyle) { Text("Повторить") }
                    }
                }
                is UiState.Success -> {
                    if (state.data.isEmpty()) {
                        item(key = "empty") {
                            Text(
                                "Образцов стиля пока нет — добавьте первый образец выше",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                            )
                        }
                    } else {
                        items(state.data, key = { it.id }) { sample ->
                            StyleSampleCard(sample)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StyleSampleCard(sample: StyleSampleDto, modifier: Modifier = Modifier) {
    BentoCard(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Text(sample.text, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(6.dp))
            Text(
                formatRuDate(sample.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ---------- Пайплайн (FSM, публичный sandbox) ---------- */

@Composable
private fun BlogPipelineScreen(container: AppContainer, onBack: () -> Unit) {
    val vm = blogViewModel(container, "pipeline", null)
    val pipeline by vm.pipeline.collectAsStateWithLifecycle()
    val op by vm.pipelineOp.collectAsStateWithLifecycle()
    var detail by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.loadPipeline() }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Пайплайн", "FSM блог-агентов", onBack)
        StateContainer(
            state = pipeline,
            onRetry = vm::loadPipeline,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(key = "state") { PipelineStateCard(data) }
                item(key = "actions") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (data.allowed.isNotEmpty()) {
                            FieldLabel("Доступные переходы")
                            data.allowed.forEach { to ->
                                Button(
                                    onClick = { vm.transitionPipeline(to, detail.trim()) },
                                    enabled = op !is OpState.Busy,
                                    shape = ArtelShapes.pill,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text(data.labels[to] ?: to) }
                            }
                            OutlinedTextField(
                                value = detail,
                                onValueChange = { detail = it.take(MAX_TRANSITION_DETAIL_LENGTH) },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Комментарий к переходу (необязательно)") },
                                minLines = 2,
                            )
                        }
                        TextButton(
                            onClick = vm::resetPipeline,
                            enabled = op !is OpState.Busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Сбросить пайплайн") }
                        OpStateText(op)
                    }
                }
            }
        }
    }
}

@Composable
private fun PipelineStateCard(data: BlogPipelineDto, modifier: Modifier = Modifier) {
    BentoCard(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(data.stage, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                PillBadge(data.stage, MaterialTheme.colorScheme.primary)
                if (data.sandbox) {
                    Spacer(Modifier.width(8.dp))
                    PillBadge("Sandbox", MaterialTheme.colorScheme.tertiary)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("Шаг: ${data.step}", style = MaterialTheme.typography.bodyMedium)
            Text(
                "Ожидается: ${data.expectedAction}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Правок: ${data.revisionCount} · Переходов: ${data.history.size}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ---------- Расписание ---------- */

@Composable
private fun BlogScheduleScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "schedule", blog.slug)
    val schedule by vm.schedule.collectAsStateWithLifecycle()
    val putState by vm.putSchedule.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.loadSchedule() }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Расписание", blog.name, onBack)
        StateContainer(
            state = schedule,
            onRetry = vm::loadSchedule,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            ScheduleContent(data, putState, onSave = vm::putSchedule)
        }
    }
}

@Composable
private fun ScheduleContent(
    data: BlogScheduleResponse,
    putState: OpState,
    onSave: (List<BlogScheduleEntryDto>) -> Unit,
) {
    var entries by remember(data) {
        mutableStateOf(
            data.schedules.map {
                BlogScheduleEntryDto(
                    dayOfWeek = it.dayOfWeek,
                    timeLocal = it.timeLocal,
                    timezone = it.timezone,
                    topic = it.topic,
                    variants = it.variants,
                    enabled = it.enabled,
                )
            },
        )
    }
    var error by remember { mutableStateOf<String?>(null) }

    fun updateEntry(index: Int, transform: (BlogScheduleEntryDto) -> BlogScheduleEntryDto) {
        entries = entries.mapIndexed { i, entry -> if (i == index) transform(entry) else entry }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "editor-title") { FieldLabel("Слоты публикации (не более $MAX_SCHEDULE_ENTRIES)") }
        items(entries.size, key = { "entry-$it" }) { index ->
            val entry = entries[index]
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("День недели", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        IconButton(onClick = { entries = entries.filterIndexed { i, _ -> i != index } }) {
                            Icon(Icons.Rounded.Delete, contentDescription = "Убрать слот")
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        DAY_NAMES.forEachIndexed { day, name ->
                            FilterChip(
                                selected = entry.dayOfWeek == day,
                                onClick = { updateEntry(index) { it.copy(dayOfWeek = day) } },
                                label = { Text(name) },
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = entry.timeLocal,
                            onValueChange = { value ->
                                updateEntry(index) { it.copy(timeLocal = value.take(5)) }
                            },
                            modifier = Modifier.weight(1f),
                            label = { Text("Время (HH:MM)") },
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = entry.timezone.orEmpty(),
                            onValueChange = { value ->
                                updateEntry(index) { it.copy(timezone = value.ifBlank { null }) }
                            },
                            modifier = Modifier.weight(1f),
                            label = { Text("Часовой пояс") },
                            singleLine = true,
                        )
                    }
                    OutlinedTextField(
                        value = entry.topic.orEmpty(),
                        onValueChange = { value ->
                            updateEntry(index) { it.copy(topic = value.take(500).ifBlank { null }) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Тема (необязательно)") },
                        singleLine = true,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Вариантов поста",
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.weight(1f),
                        )
                        SingleChoiceSegmentedButtonRow {
                            listOf(1, 2, 3).forEachIndexed { optionIndex, value ->
                                SegmentedButton(
                                    selected = (entry.variants ?: 1) == value,
                                    onClick = { updateEntry(index) { it.copy(variants = value) } },
                                    shape = SegmentedButtonDefaults.itemShape(index = optionIndex, count = 3),
                                ) { Text("$value") }
                            }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Слот включён",
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(
                            checked = entry.enabled ?: true,
                            onCheckedChange = { enabled -> updateEntry(index) { it.copy(enabled = enabled) } },
                        )
                    }
                }
            }
        }
        item(key = "editor-actions") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (entries.size < MAX_SCHEDULE_ENTRIES) {
                    TextButton(
                        onClick = {
                            entries = entries + BlogScheduleEntryDto(
                                dayOfWeek = 1,
                                timeLocal = "09:00",
                                timezone = null,
                                topic = null,
                                variants = 1,
                                enabled = true,
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Добавить слот")
                    }
                }
                ActionButton(
                    label = "Сохранить расписание",
                    busy = putState is OpState.Busy,
                    enabled = entries.isNotEmpty(),
                    onClick = {
                        val badTime = entries.firstOrNull { !TIME_LOCAL_REGEX.matches(it.timeLocal) }
                        if (badTime != null) {
                            error = "Время слота должно быть в формате ЧЧ:ММ (например, 09:30)"
                            return@ActionButton
                        }
                        error = null
                        onSave(entries)
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let {
                    Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                }
                OpStateText(putState)
            }
        }
        if (data.runs.isNotEmpty()) {
            item(key = "runs-title") { FieldLabel("Последние запуски") }
            items(data.runs, key = { "run-${it.id}" }) { run ->
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Слот №${run.scheduleId}",
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.weight(1f),
                            )
                            PillBadge(
                                run.status,
                                if (run.status == "ok") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                            )
                        }
                        run.message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        Text(
                            listOfNotNull(
                                run.startedAt?.let { "Старт: ${formatRuDate(it)}" },
                                run.finishedAt?.let { "Финиш: ${formatRuDate(it)}" },
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/* ---------- Настройки блога ---------- */

@Composable
private fun BlogSettingsScreen(container: AppContainer, blog: BlogDto, onBack: () -> Unit) {
    val vm = blogViewModel(container, "settings", blog.slug)
    val detail by vm.blogDetail.collectAsStateWithLifecycle()
    val patchState by vm.patchBlog.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.loadBlogDetail() }

    Column(Modifier.fillMaxSize()) {
        BlogHeader("Настройки блога", blog.name, onBack)
        StateContainer(
            state = detail,
            onRetry = vm::loadBlogDetail,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            BlogSettingsForm(data, patchState, onSave = vm::patchBlog)
        }
    }
}

@Composable
private fun BlogSettingsForm(
    data: BlogDto,
    patchState: OpState,
    onSave: (PatchBlogRequest) -> Unit,
) {
    var name by remember(data) { mutableStateOf(data.name) }
    var profile by remember(data) { mutableStateOf(data.profile.orEmpty()) }
    var tgChatId by remember(data) { mutableStateOf(data.tgChatId.orEmpty()) }
    var stylePreset by remember(data) { mutableStateOf(data.stylePreset) }
    var systemPrompt by remember(data) { mutableStateOf(data.systemPrompt.orEmpty()) }
    var contextPrompt by remember(data) { mutableStateOf(data.contextPrompt.orEmpty()) }
    var sourcesText by remember(data) { mutableStateOf(data.sources.joinToString("\n")) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        val trimmedName = name.trim()
        if (trimmedName.isEmpty() || trimmedName.length > MAX_BLOG_NAME_LENGTH) {
            error = "Название обязательно, до $MAX_BLOG_NAME_LENGTH символов"
            return
        }
        if (systemPrompt.length > MAX_BLOG_PROMPT_LENGTH || contextPrompt.length > MAX_BLOG_PROMPT_LENGTH) {
            error = "Промпты — до $MAX_BLOG_PROMPT_LENGTH символов каждый"
            return
        }
        val sources = sourcesText
            .lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .take(MAX_SOURCES_COUNT + 1)
            .toList()
        if (sources.size > MAX_SOURCES_COUNT) {
            error = "Источников не больше $MAX_SOURCES_COUNT"
            return
        }
        if (sources.any { !it.startsWith("http://") && !it.startsWith("https://") }) {
            error = "Каждый источник — ссылка http(s)"
            return
        }
        error = null
        onSave(
            PatchBlogRequest(
                name = trimmedName,
                profile = profile.trim().ifBlank { null },
                tgChatId = tgChatId.trim(),
                stylePreset = stylePreset,
                systemPrompt = systemPrompt.trim().ifBlank { null },
                contextPrompt = contextPrompt.trim().ifBlank { null },
                sources = sources,
            ),
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "form") {
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it.take(MAX_BLOG_NAME_LENGTH) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Название (до $MAX_BLOG_NAME_LENGTH)") },
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = profile,
                        onValueChange = { profile = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Профиль голоса (пусто — без профиля)") },
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = tgChatId,
                        onValueChange = { tgChatId = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("TG-чат канала (пусто — общий канал)") },
                        singleLine = true,
                    )
                    FieldLabel("Пресет стиля")
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        listOf("default" to "По умолчанию", "antonov" to "Антонов").forEachIndexed { index, (value, label) ->
                            SegmentedButton(
                                selected = stylePreset == value,
                                onClick = { stylePreset = value },
                                shape = SegmentedButtonDefaults.itemShape(index = index, count = 2),
                            ) { Text(label, style = MaterialTheme.typography.labelMedium) }
                        }
                    }
                    OutlinedTextField(
                        value = systemPrompt,
                        onValueChange = { systemPrompt = it.take(MAX_BLOG_PROMPT_LENGTH) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Системный промпт (пусто — сброс)") },
                        minLines = 3,
                    )
                    OutlinedTextField(
                        value = contextPrompt,
                        onValueChange = { contextPrompt = it.take(MAX_BLOG_PROMPT_LENGTH) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Контекстный промпт (пусто — сброс)") },
                        minLines = 3,
                    )
                    OutlinedTextField(
                        value = sourcesText,
                        onValueChange = { sourcesText = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("RSS-источники: по одной ссылке в строке") },
                        minLines = 3,
                    )
                    ActionButton(
                        label = "Сохранить настройки",
                        busy = patchState is OpState.Busy,
                        onClick = ::save,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    error?.let {
                        Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                    }
                    OpStateText(patchState)
                }
            }
        }
    }
}
