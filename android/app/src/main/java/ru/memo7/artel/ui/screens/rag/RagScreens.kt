// Экраны конвейера RAG (web /rag*): хаб со статистикой партиций, свободный запрос,
// диалоги базы знаний (+ алиасы TG-чатов), индексация партиций, заметки.
// Каждый список — через StateContainer (loading/error/empty), стримы с кнопкой «Остановить».
package ru.memo7.artel.ui.screens.rag

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.api.RagAliasDto
import ru.memo7.artel.data.api.RagDialogChatDto
import ru.memo7.artel.data.api.RagNoteDto
import ru.memo7.artel.data.api.RagQuoteDto
import ru.memo7.artel.data.api.RagSourceDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.SectionTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.chat.pluralMessages
import ru.memo7.artel.ui.theme.ArtelShapes

/* ---------- Общие мелкие элементы ---------- */

@Composable
private fun RagHeader(title: String, onBack: () -> Unit, trailing: (@Composable () -> Unit)? = null) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 12.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
        }
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        trailing?.invoke()
    }
}

/** Строка статуса/ошибки под шапкой — как notice в ChatScreen. */
@Composable
private fun NoticeLine(notice: String?) {
    if (notice == null) return
    Text(
        notice,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
    )
}

internal fun ragPartitionLabel(key: String): String = when (key) {
    "fixed" -> "Документы"
    "structure" -> "Структура"
    "telegram" -> "Telegram"
    "notes" -> "Заметки"
    "docs" -> "Docs"
    "faq" -> "FAQ"
    else -> key
}

private fun parseOptionalInt(text: String): Int? = text.trim().toIntOrNull()

/* ---------- Хаб ---------- */

/** Хаб базы знаний: входы в разделы + счётчики партиций (web /rag). */
@Composable
fun RagHubScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenQuery: () -> Unit,
    onOpenChats: () -> Unit,
    onOpenIndex: () -> Unit,
    onOpenNotes: () -> Unit,
) {
    val vm: RagHubViewModel = viewModel(
        factory = viewModelFactory { initializer { RagHubViewModel(container.repository) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 20.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            ScreenTitle(text = "База знаний", modifier = Modifier.weight(1f))
        }
        NoticeLine(state.notice)

        StateContainer(
            state = state.partitions,
            onRetry = vm::refresh,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { partitions ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SectionTitle("Партиции")
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            "fixed" to partitions.fixed,
                            "structure" to partitions.structure,
                            "telegram" to partitions.telegram,
                            "notes" to partitions.notes,
                            "docs" to partitions.docs,
                            "faq" to partitions.faq,
                        ).forEach { (key, count) ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(ragPartitionLabel(key), style = MaterialTheme.typography.bodyLarge)
                                PillBadge(
                                    text = "$count чанков",
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }

                SectionTitle("Разделы", modifier = Modifier.padding(top = 8.dp))
                HubEntry("Запрос", "Свободный вопрос к базе знаний со стримингом ответа", onOpenQuery)
                HubEntry("Чаты", "Диалоги с источниками и алиасы TG-чатов", onOpenChats)
                HubEntry("Индекс", "Пересборка партиций документов и Telegram", onOpenIndex)
                HubEntry("Заметки", "Личные заметки в базе знаний", onOpenNotes)
            }
        }
    }
}

@Composable
private fun HubEntry(title: String, subtitle: String, onClick: () -> Unit) {
    BentoCard(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ---------- Свободный запрос ---------- */

/** Свободный RAG-запрос (web /rag): параметры strategy/k + стрим ответа с источниками. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RagQueryScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: RagQueryViewModel = viewModel(
        factory = viewModelFactory { initializer { RagQueryViewModel(container.repository) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    var strategy by remember { mutableStateOf<String?>(null) }
    var k by remember { mutableStateOf<Int?>(null) }

    Column(Modifier.fillMaxSize()) {
        RagHeader("Запрос к базе знаний", onBack)
        NoticeLine(state.notice)

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Стратегия поиска",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = strategy == null,
                    onClick = { strategy = null },
                    label = { Text("Авто") },
                )
                RAG_STRATEGY_OPTIONS.forEach { (value, label) ->
                    FilterChip(
                        selected = strategy == value,
                        onClick = { strategy = value },
                        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    )
                }
            }

            Text(
                "Глубина поиска (k)",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf<Pair<Int?, String>>(null to "По умолчанию", 5 to "5", 10 to "10", 20 to "20").forEach { (value, label) ->
                    FilterChip(
                        selected = k == value,
                        onClick = { k = value },
                        label = { Text(label) },
                    )
                }
            }

            if (state.stage != null) {
                Text(
                    state.stage ?: "",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (state.answer.isNotBlank()) {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        state.answer,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
            if (state.sources.isNotEmpty()) {
                SectionTitle("Источники")
                state.sources.forEach { source -> SourceRow(source) }
            }
            if (state.quotes.isNotEmpty()) {
                SectionTitle("Цитаты")
                state.quotes.forEach { quote -> QuoteRow(quote) }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .imePadding(),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.take(MAX_RAG_QUERY_LENGTH) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Вопрос к базе знаний…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
                supportingText = {
                    Text(
                        "${input.length} / $MAX_RAG_QUERY_LENGTH",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (input.length >= MAX_RAG_QUERY_LENGTH) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                },
            )
            if (state.busy) {
                IconButton(onClick = vm::stop) {
                    Icon(Icons.Rounded.Stop, contentDescription = "Остановить генерацию")
                }
            } else {
                IconButton(
                    onClick = {
                        vm.ask(input, strategy, k)
                        input = ""
                    },
                    enabled = input.isNotBlank() && input.length <= MAX_RAG_QUERY_LENGTH,
                ) {
                    Icon(
                        Icons.AutoMirrored.Rounded.Send,
                        contentDescription = "Отправить",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
private fun SourceRow(source: RagSourceDto) {
    BentoCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    source.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    source.section,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            PillBadge(
                text = "%.2f".format(source.score),
                tint = MaterialTheme.colorScheme.secondary,
            )
        }
    }
}

@Composable
private fun QuoteRow(quote: RagQuoteDto) {
    BentoCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                quote.section,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                quote.snippet,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ---------- Чаты + алиасы ---------- */

/** Список диалогов базы знаний + алиасы TG-чатов (web /rag/chat, /rag/chats). */
@Composable
fun RagChatsScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    val vm: RagChatsViewModel = viewModel(
        factory = viewModelFactory { initializer { RagChatsViewModel(container.repository) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var showCreate by remember { mutableStateOf(false) }
    var titleInput by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        RagHeader("Чаты базы знаний", onBack)
        NoticeLine(state.notice)

        StateContainer(
            state = state.chats,
            onRetry = vm::refresh,
            emptyCheck = { it.isEmpty() },
            emptyMessage = "Чатов пока нет",
            emptyHint = "Создайте первый диалог кнопкой ниже",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { chats ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(chats, key = { it.id }) { chat ->
                    RagChatCard(chat, onClick = { onOpenChat(chat.id) })
                }
            }
        }

        AliasSection(
            state = state,
            onAdd = { name, chatKey, topicId -> vm.addAlias(name, chatKey, topicId) },
            onRemove = vm::removeAlias,
            onRetry = vm::refreshAliases,
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Button(
                onClick = { showCreate = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = ArtelShapes.pill,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Новый чат", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (showCreate) {
        AlertDialog(
            onDismissRequest = { if (!creating) showCreate = false },
            title = { Text("Новый чат") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Диалог с базой знаний — источники прикрепляются к ответам автоматически.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = titleInput,
                        onValueChange = { titleInput = it.take(120) },
                        label = { Text("Название (необязательно)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 2,
                    )
                    if (createError != null) {
                        Text(
                            createError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                if (creating || state.creating) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .padding(end = 16.dp)
                            .size(24.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    TextButton(
                        onClick = {
                            createError = null
                            creating = true
                            vm.create(titleInput.ifBlank { null }) { result ->
                                creating = false
                                when (result) {
                                    is ApiResult.Success -> {
                                        showCreate = false
                                        titleInput = ""
                                        onOpenChat(result.data)
                                    }
                                    is ApiResult.Failure ->
                                        createError = result.error.message ?: "Не удалось создать чат"
                                }
                            }
                        },
                    ) { Text("Создать", fontWeight = FontWeight.SemiBold) }
                }
            },
            dismissButton = {
                if (!creating && !state.creating) {
                    TextButton(onClick = { showCreate = false }) { Text("Отмена") }
                }
            },
        )
    }
}

@Composable
private fun RagChatCard(chat: RagDialogChatDto, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(ArtelShapes.tile)
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(16.dp),
    ) {
        Text(
            chat.title,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Row(
            modifier = Modifier.padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                pluralMessages(chat.msgCount),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                "обновлён ${chat.updatedAt}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Алиасы TG-чатов: список с удалением + добавление (name + chatKey). */
@Composable
private fun AliasSection(
    state: RagChatsUiState,
    onAdd: (String, String, Int?) -> Unit,
    onRemove: (String) -> Unit,
    onRetry: () -> Unit,
) {
    var showAdd by remember { mutableStateOf(false) }
    var nameInput by remember { mutableStateOf("") }
    var chatKeyInput by remember { mutableStateOf("") }
    var topicIdInput by remember { mutableStateOf("") }
    var aliasError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 260.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SectionTitle("Алиасы Telegram", modifier = Modifier.weight(1f))
            TextButton(onClick = { showAdd = true }, enabled = !state.aliasBusy) {
                Text("Добавить")
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            when (val aliases = state.aliases) {
                is UiState.Loading -> Text(
                    "Загрузка алиасов…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                is UiState.Error -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        aliases.message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onRetry) { Text("Повторить") }
                }
                is UiState.Success -> if (aliases.data.isEmpty()) {
                    Text(
                        "Алиасов нет — добавьте короткое имя для TG-чата.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    aliases.data.forEach { alias ->
                        AliasRow(alias, busy = state.aliasBusy, onRemove = { onRemove(alias.name) })
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    if (showAdd) {
        AlertDialog(
            onDismissRequest = { if (!state.aliasBusy) showAdd = false },
            title = { Text("Новый алиас") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = nameInput,
                        onValueChange = { nameInput = it.take(100) },
                        label = { Text("Имя (1–100)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                    )
                    OutlinedTextField(
                        value = chatKeyInput,
                        onValueChange = { chatKeyInput = it.take(200) },
                        label = { Text("chatKey TG-чата (1–200)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                    )
                    OutlinedTextField(
                        value = topicIdInput,
                        onValueChange = { topicIdInput = it.filter { ch -> ch.isDigit() }.take(10) },
                        label = { Text("topicId (необязательно)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                    )
                    if (aliasError != null) {
                        Text(
                            aliasError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val topicId = parseOptionalInt(topicIdInput)
                        when {
                            nameInput.isBlank() || nameInput.trim().length > 100 ->
                                aliasError = "Имя обязательно (1–100 символов)"
                            chatKeyInput.isBlank() || chatKeyInput.trim().length > 200 ->
                                aliasError = "chatKey обязателен (1–200 символов)"
                            topicIdInput.isNotBlank() && (topicId == null || topicId < 0) ->
                                aliasError = "topicId — целое число ≥ 0"
                            else -> {
                                aliasError = null
                                onAdd(nameInput, chatKeyInput, topicId)
                                showAdd = false
                                nameInput = ""
                                chatKeyInput = ""
                                topicIdInput = ""
                            }
                        }
                    },
                ) { Text("Добавить", fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                if (!state.aliasBusy) {
                    TextButton(onClick = { showAdd = false }) { Text("Отмена") }
                }
            },
        )
    }
}

@Composable
private fun AliasRow(alias: RagAliasDto, busy: Boolean, onRemove: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                alias.name,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                alias.chatKey + (alias.topicId?.let { " · топик $it" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onRemove, enabled = !busy) {
            Icon(
                Icons.Rounded.Delete,
                contentDescription = "Удалить алиас",
                tint = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/* ---------- Деталь диалога ---------- */

/** Переписка диалога базы знаний (web /rag/chat/[id]): стрим + панель задачи. */
@Composable
fun RagChatDetailScreen(
    container: AppContainer,
    chatId: String,
    onBack: () -> Unit,
) {
    val vm: RagChatDetailViewModel = viewModel(
        factory = viewModelFactory { initializer { RagChatDetailViewModel(container.repository, chatId) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    var confirmClearTask by remember { mutableStateOf(false) }

    val title = (state.load as? UiState.Success)?.data?.chat?.title ?: "Чат"

    Column(Modifier.fillMaxSize()) {
        RagHeader(title, onBack)
        NoticeLine(state.notice)

        StateContainer(
            state = state.load,
            onRetry = vm::load,
            emptyCheck = { it.messages.isEmpty() && state.streamingAnswer == null },
            emptyMessage = "Сообщений пока нет",
            emptyHint = "Задайте вопрос базе знаний — ответ появится здесь",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { detail ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(detail.messages, key = { it.id }) { message ->
                    RagMessageBubble(fromUser = message.role == "user", text = message.content)
                }
                val streaming = state.streamingAnswer
                if (streaming != null) {
                    item(key = "streaming") {
                        RagMessageBubble(fromUser = false, text = streaming, pending = state.busy && streaming.isEmpty())
                    }
                }
            }
        }

        TaskPanel(state, vm, onClearClick = { confirmClearTask = true })

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .imePadding(),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.take(MAX_RAG_CHAT_INPUT_LENGTH) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Вопрос базе знаний…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
            )
            if (state.busy) {
                IconButton(onClick = vm::stop) {
                    Icon(Icons.Rounded.Stop, contentDescription = "Остановить генерацию")
                }
            } else {
                IconButton(
                    onClick = {
                        vm.send(input, null, null)
                        input = ""
                    },
                    enabled = input.isNotBlank() && input.length <= MAX_RAG_CHAT_INPUT_LENGTH,
                ) {
                    Icon(
                        Icons.AutoMirrored.Rounded.Send,
                        contentDescription = "Отправить",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }

    if (confirmClearTask) {
        AlertDialog(
            onDismissRequest = { confirmClearTask = false },
            title = { Text("Очистить задачу?") },
            text = { Text("Цель, термины, ограничения и уточнения диалога будут удалены. История сообщений останется.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmClearTask = false
                        vm.clearTask()
                    },
                ) { Text("Очистить") }
            },
            dismissButton = {
                TextButton(onClick = { confirmClearTask = false }) { Text("Отмена") }
            },
        )
    }
}

/** Панель задачи диалога: отрендеренный task-state + черновик новой цели. */
@Composable
private fun TaskPanel(
    state: RagChatDetailUiState,
    vm: RagChatDetailViewModel,
    onClearClick: () -> Unit,
) {
    val taskStateText = (state.load as? UiState.Success)?.data?.taskStateText.orEmpty()
    BentoCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "Задача диалога",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (taskStateText.isBlank()) {
                Text(
                    "Не задана — опишите цель, и ответы будут её учитывать.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    taskStateText,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            OutlinedTextField(
                value = state.taskDraft,
                onValueChange = vm::onTaskDraftChange,
                label = { Text("Новая задача (≤500)") },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 2,
                enabled = !state.taskBusy,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(
                    onClick = vm::saveTask,
                    enabled = state.taskDraft.isNotBlank() && !state.taskBusy,
                ) { Text("Сохранить", fontWeight = FontWeight.SemiBold) }
                TextButton(
                    onClick = onClearClick,
                    enabled = !state.taskBusy && taskStateText.isNotBlank(),
                ) {
                    Text("Очистить", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
private fun RagMessageBubble(fromUser: Boolean, text: String, pending: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (fromUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(
                    MaterialTheme.shapes.extraLarge.copy(
                        bottomEnd = if (fromUser) CornerSize(6.dp) else CornerSize(28.dp),
                        bottomStart = if (!fromUser) CornerSize(6.dp) else CornerSize(28.dp),
                    ),
                )
                .background(
                    if (fromUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (pending) {
                Text(
                    "Думаю…",
                    color = if (fromUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyLarge,
                )
            } else {
                Text(
                    text,
                    color = if (fromUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

/* ---------- Индексация ---------- */

/** Индексация партиций: документные стратегии + Telegram (web /rag/index, /rag/index-tg). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RagIndexScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: RagIndexViewModel = viewModel(
        factory = viewModelFactory { initializer { RagIndexViewModel(container.repository) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var strategies by remember { mutableStateOf(setOf("fixed")) }
    var chatRefInput by remember { mutableStateOf("") }
    var topicIdInput by remember { mutableStateOf("") }
    var limitInput by remember { mutableStateOf("") }
    var reset by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        RagHeader("Индексация базы знаний", onBack)
        NoticeLine(state.notice)

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Документные партиции", style = MaterialTheme.typography.titleMedium)
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf("fixed" to "Документы", "structure" to "Структура").forEach { (value, label) ->
                            FilterChip(
                                selected = value in strategies,
                                onClick = {
                                    strategies = if (value in strategies) strategies - value else strategies + value
                                },
                                label = { Text(label) },
                            )
                        }
                    }
                    Button(
                        onClick = { vm.runIndex(strategies) },
                        enabled = strategies.isNotEmpty() && !state.running,
                        shape = ArtelShapes.pill,
                    ) { Text("Пересобрать выбранное") }
                }
            }

            BentoCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Telegram", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(
                        value = chatRefInput,
                        onValueChange = { chatRefInput = it.take(200) },
                        label = { Text("chatKey или ссылка на чат (1–200)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                        enabled = !state.running,
                    )
                    OutlinedTextField(
                        value = topicIdInput,
                        onValueChange = { topicIdInput = it.filter { ch -> ch.isDigit() }.take(10) },
                        label = { Text("topicId (необязательно)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                        enabled = !state.running,
                    )
                    OutlinedTextField(
                        value = limitInput,
                        onValueChange = { limitInput = it.filter { ch -> ch.isDigit() }.take(4) },
                        label = { Text("Лимит сообщений 1–5000 (необязательно)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 1,
                        enabled = !state.running,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = reset,
                            onCheckedChange = { reset = it },
                            enabled = !state.running,
                        )
                        Text(
                            "Сначала очистить партицию (reset)",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    if (reset) {
                        Text(
                            "Внимание: reset вместе с topicId стирает ВЕСЬ telegram-раздел базы — раздел будет собран заново.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    val limit = parseOptionalInt(limitInput)
                    val chatRefValid = chatRefInput.isNotBlank() && chatRefInput.trim().length <= 200
                    val formValid = chatRefValid &&
                        (limitInput.isBlank() || (limit != null && limit in 1..5000))
                    Button(
                        onClick = {
                            vm.runIndexTg(
                                chatRef = chatRefInput,
                                topicId = parseOptionalInt(topicIdInput),
                                limit = limit,
                                reset = reset,
                            )
                        },
                        enabled = formValid && !state.running,
                        shape = ArtelShapes.pill,
                    ) { Text("Индексировать Telegram") }
                }
            }

            if (state.stage != null) {
                Text(
                    state.stage ?: "",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (state.log.isNotEmpty()) {
                SectionTitle("Ход индексации")
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        state.log.forEach { line ->
                            Text(
                                line,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            if (state.stats.isNotEmpty()) {
                SectionTitle("Результат")
                state.stats.forEach { stat ->
                    BentoCard(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            buildString {
                                append("${ragPartitionLabel(stat.strategy)}: ${stat.chunks} чанков")
                                append(" · средняя длина ${stat.avgLen.toInt()}")
                                stat.dim?.let { append(" · dim $it") }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
            }
            val tgDone = state.tgDone
            if (tgDone != null) {
                BentoCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        buildString {
                            append("Telegram: готово (${tgDone.mode}) — ${tgDone.chatKey}")
                            append(" · проиндексировано ${tgDone.indexed} · всего ${tgDone.total}")
                            tgDone.dim?.let { append(" · dim $it") }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }

        if (state.running) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Button(
                    onClick = vm::stop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = ArtelShapes.pill,
                ) {
                    Icon(Icons.Rounded.Stop, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Остановить", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/* ---------- Заметки ---------- */

/** Заметки базы знаний: список + добавление (title+text) + удаление (web /rag/ingest). */
@Composable
fun RagNotesScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: RagNotesViewModel = viewModel(
        factory = viewModelFactory { initializer { RagNotesViewModel(container.repository) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var showAdd by remember { mutableStateOf(false) }
    var titleInput by remember { mutableStateOf("") }
    var textInput by remember { mutableStateOf("") }
    var addError by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<RagNoteDto?>(null) }

    Column(Modifier.fillMaxSize()) {
        RagHeader("Заметки базы знаний", onBack)
        NoticeLine(state.notice)

        StateContainer(
            state = state.load,
            onRetry = vm::refresh,
            emptyCheck = { it.notes.isEmpty() },
            emptyMessage = "Заметок пока нет",
            emptyHint = "Добавьте первую заметку кнопкой ниже",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(data.notes, key = { it.source }) { note ->
                    NoteCard(note, onDelete = { confirmDelete = note })
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Button(
                onClick = { showAdd = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = ArtelShapes.pill,
                enabled = !state.adding,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Добавить заметку", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (showAdd) {
        AlertDialog(
            onDismissRequest = { if (!state.adding) showAdd = false },
            title = { Text("Новая заметка") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = titleInput,
                        onValueChange = { titleInput = it.take(120) },
                        label = { Text("Заголовок (1–120)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 2,
                    )
                    OutlinedTextField(
                        value = textInput,
                        onValueChange = { textInput = it.take(20000) },
                        label = { Text("Текст (1–20000)") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 4,
                        maxLines = 8,
                        supportingText = {
                            Text(
                                "${textInput.length} / 20000",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (textInput.length >= 20000) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                        },
                    )
                    if (addError != null) {
                        Text(
                            addError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                if (state.adding) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .padding(end = 16.dp)
                            .size(24.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    TextButton(
                        onClick = {
                            when {
                                titleInput.isBlank() || titleInput.trim().length > 120 ->
                                    addError = "Заголовок обязателен (1–120 символов)"
                                textInput.isBlank() || textInput.trim().length > 20000 ->
                                    addError = "Текст обязателен (1–20000 символов)"
                                else -> {
                                    addError = null
                                    vm.add(titleInput, textInput) { result ->
                                        when (result) {
                                            is ApiResult.Success -> {
                                                showAdd = false
                                                titleInput = ""
                                                textInput = ""
                                            }
                                            is ApiResult.Failure ->
                                                addError = result.error.message ?: "Не удалось добавить заметку"
                                        }
                                    }
                                }
                            }
                        },
                    ) { Text("Добавить", fontWeight = FontWeight.SemiBold) }
                }
            },
            dismissButton = {
                if (!state.adding) {
                    TextButton(onClick = { showAdd = false }) { Text("Отмена") }
                }
            },
        )
    }

    val noteToDelete = confirmDelete
    if (noteToDelete != null) {
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Удалить заметку?") },
            text = { Text("«${noteToDelete.title}» (${noteToDelete.chunks} чанков) исчезнет из базы знаний.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.remove(noteToDelete.source)
                        confirmDelete = null
                    },
                ) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) { Text("Отмена") }
            },
        )
    }
}

@Composable
private fun NoteCard(note: RagNoteDto, onDelete: () -> Unit) {
    BentoCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    note.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${note.chunks} чанков · ${note.source}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Rounded.Delete,
                    contentDescription = "Удалить заметку",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
