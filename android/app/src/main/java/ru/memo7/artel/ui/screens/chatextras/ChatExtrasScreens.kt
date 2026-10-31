// Экраны дополнительных персона и панелей чата: JokerScreen (SSE-чат шутника),
// AntonovScreen (rewrite/thread) и ChatPanelsScreen/ChatPanelsSheet
// (memory/branch/profile/constraints, встраиваются поверх ChatScreen).
// Панели — НЕ отдельный route навигации: orchestrator показывает их из ChatScreen.
package ru.memo7.artel.ui.screens.chatextras

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.memo7.artel.core.UiState
import ru.memo7.artel.data.api.BranchDto
import ru.memo7.artel.data.api.ConstraintDto
import ru.memo7.artel.data.api.ConstraintsActionRequest
import ru.memo7.artel.data.api.LongTermItemDto
import ru.memo7.artel.data.api.MemoryActionRequest
import ru.memo7.artel.data.api.ProfileActionRequest
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.assistant.ChatMessage
import ru.memo7.artel.ui.theme.ArtelShapes

/* ==================== Общие кусочки ==================== */

@Composable
private fun ExtrasBubble(message: ChatMessage, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start,
    ) {
        val bubbleColor = when {
            message.fromUser -> MaterialTheme.colorScheme.primary
            message.isError -> MaterialTheme.colorScheme.errorContainer
            else -> MaterialTheme.colorScheme.surface
        }
        val textColor = when {
            message.fromUser -> MaterialTheme.colorScheme.onPrimary
            message.isError -> MaterialTheme.colorScheme.onErrorContainer
            else -> MaterialTheme.colorScheme.onSurface
        }
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(
                    MaterialTheme.shapes.extraLarge.copy(
                        bottomEnd = if (message.fromUser) CornerSize(6.dp) else CornerSize(28.dp),
                        bottomStart = if (!message.fromUser) CornerSize(6.dp) else CornerSize(28.dp),
                    ),
                )
                .background(bubbleColor)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (message.pending && message.text.isEmpty()) {
                Text(
                    "Думаю…",
                    color = textColor,
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                )
            } else {
                Text(
                    message.text,
                    color = textColor,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

@Composable
private fun ExtrasHeader(
    title: String,
    subtitle: String,
    onBack: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
) {
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
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(
                subtitle,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        actions()
    }
}

@Composable
private fun NoticeText(notice: String?, modifier: Modifier = Modifier) {
    if (notice != null) {
        Text(
            notice,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.padding(horizontal = 20.dp, vertical = 4.dp),
        )
    }
}

/** Одна строка FilterChip'ов — выбор из закрытого списка значений. */
@Composable
private fun ChipSelect(
    options: List<Pair<String, String>>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { (value, label) ->
            FilterChip(
                selected = selected == value,
                onClick = { onSelect(value) },
                label = { Text(label) },
            )
        }
    }
}

/* ==================== JokerScreen ==================== */

/** Экран шутника: чат по образцу ChatScreen + слайдер температуры + сброс. */
@Composable
fun JokerScreen(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: JokerViewModel = viewModel(
        factory = viewModelFactory { initializer { JokerViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    var confirmReset by remember { mutableStateOf(false) }
    var temperatureMenu by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.text) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.lastIndex)
        }
    }

    Column(Modifier.fillMaxSize()) {
        ExtrasHeader(
            title = "Шутник",
            subtitle = buildString {
                append("температура ")
                append(String.format("%.1f", state.temperature))
                (state.load as? UiState.Success)?.data?.usage?.let { append(" · ${it.total_tokens} токенов") }
            },
            onBack = onBack,
        ) {
            Box {
                IconButton(onClick = { temperatureMenu = true }) {
                    Icon(Icons.Rounded.Tune, contentDescription = "Температура")
                }
                DropdownMenu(expanded = temperatureMenu, onDismissRequest = { temperatureMenu = false }) {
                    Column(Modifier.width(220.dp).padding(horizontal = 16.dp)) {
                        Text(
                            "Температура: ${String.format("%.1f", state.temperature)}",
                            style = MaterialTheme.typography.labelMedium,
                        )
                        Slider(
                            value = state.temperature.toFloat(),
                            onValueChange = { vm.setTemperature(it.toDouble()) },
                            valueRange = JOKER_TEMPERATURE_MIN.toFloat()..JOKER_TEMPERATURE_MAX.toFloat(),
                        )
                    }
                }
            }
            IconButton(
                onClick = { confirmReset = true },
                enabled = !state.busy && state.load is UiState.Success,
            ) {
                Icon(Icons.Rounded.RestartAlt, contentDescription = "Сбросить историю")
            }
        }
        NoticeText(state.notice)

        StateContainer(
            state = state.load,
            onRetry = vm::load,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.messages, key = { it.id }) { message ->
                    ExtrasBubble(message)
                }
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
                onValueChange = { input = it.take(JOKER_MAX_TEXT_LENGTH) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Тема для шутки…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
                supportingText = {
                    Text(
                        "${input.length} / $JOKER_MAX_TEXT_LENGTH",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (input.length >= JOKER_MAX_TEXT_LENGTH) {
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
                        vm.send(input)
                        input = ""
                    },
                    enabled = input.isNotBlank() && input.length <= JOKER_MAX_TEXT_LENGTH,
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

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Сбросить историю?") },
            text = { Text("История сообщений и счётчик токенов шутника будут очищены.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmReset = false
                        vm.reset()
                    },
                ) { Text("Сбросить") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Отмена") }
            },
        )
    }
}

/* ==================== AntonovScreen ==================== */

private val ANTONOV_MODES = listOf("soft" to "Мягкий", "normal" to "Обычный", "hard" to "Жёсткий")
private val ANTONOV_FORMATS = listOf(
    "auto" to "Авто", "post" to "Пост", "essay" to "Эссе", "guide" to "Гайд", "calm" to "Спокойно",
)
private val ANTONOV_LLM = listOf("cloud" to "Облако", "local" to "Локальная")

/** Студия Антонова: «Переписать» (один пост) и «Тред» (список постов). */
@Composable
fun AntonovScreen(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: AntonovViewModel = viewModel(
        factory = viewModelFactory { initializer { AntonovViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize()) {
        ExtrasHeader(title = "Антонов", subtitle = "студия канала", onBack = onBack)
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Переписать") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Тред") })
        }
        NoticeText(state.notice)

        if (tab == 0) {
            AntonovRewriteTab(vm, state, Modifier.fillMaxSize())
        } else {
            AntonovThreadTab(vm, state, Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun AntonovRewriteTab(
    vm: AntonovViewModel,
    state: AntonovUiState,
    modifier: Modifier = Modifier,
) {
    var text by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf<String?>("normal") }
    var format by remember { mutableStateOf<String?>("auto") }
    var signature by remember { mutableStateOf(false) }
    var llm by remember { mutableStateOf<String?>("cloud") }
    val clipboard = LocalClipboardManager.current

    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it.take(ANTONOV_MAX_TEXT_LENGTH) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            placeholder = { Text("Текст для переписывания…") },
            minLines = 4,
            supportingText = {
                Text(
                    "${text.length} / $ANTONOV_MAX_TEXT_LENGTH",
                    style = MaterialTheme.typography.labelSmall,
                )
            },
        )
        Text("Режим", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 20.dp))
        ChipSelect(ANTONOV_MODES, mode, onSelect = { mode = it })
        Text("Формат", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 20.dp))
        ChipSelect(ANTONOV_FORMATS, format, onSelect = { format = it })
        ChipSelect(ANTONOV_LLM, llm, onSelect = { llm = it })
        Row(
            modifier = Modifier.padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                onClick = { vm.rewrite(text, mode, format, signature, llm) },
                enabled = !state.busy && text.isNotBlank(),
                shape = ArtelShapes.pill,
            ) { Text(if (state.busy) "Работаю…" else "Переписать") }
            Spacer(Modifier.width(12.dp))
            FilterChip(
                selected = signature,
                onClick = { signature = !signature },
                label = { Text("С подписью") },
            )
        }

        state.rewritePost?.let { post ->
            BentoCard(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Результат",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.weight(1f),
                    )
                    state.rewriteProvider?.takeIf { it.isNotBlank() }?.let {
                        PillBadge(it, MaterialTheme.colorScheme.secondary)
                    }
                    IconButton(onClick = { clipboard.setText(AnnotatedString(post)) }) {
                        Icon(Icons.Rounded.ContentCopy, contentDescription = "Скопировать")
                    }
                }
                Text(post, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun AntonovThreadTab(
    vm: AntonovViewModel,
    state: AntonovUiState,
    modifier: Modifier = Modifier,
) {
    var text by remember { mutableStateOf("") }
    var author by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf<String?>("normal") }
    var llm by remember { mutableStateOf<String?>("cloud") }

    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it.take(ANTONOV_MAX_TEXT_LENGTH) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            placeholder = { Text("Текст или ссылка для треда…") },
            minLines = 4,
            supportingText = {
                Text(
                    "${text.length} / $ANTONOV_MAX_TEXT_LENGTH",
                    style = MaterialTheme.typography.labelSmall,
                )
            },
        )
        OutlinedTextField(
            value = author,
            onValueChange = { author = it.take(ANTONOV_MAX_AUTHOR_LENGTH) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            placeholder = { Text("Автор (необязательно)") },
            singleLine = true,
        )
        OutlinedTextField(
            value = source,
            onValueChange = { source = it.take(ANTONOV_MAX_SOURCE_LENGTH) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            placeholder = { Text("Источник, ссылка (необязательно)") },
            singleLine = true,
        )
        ChipSelect(ANTONOV_MODES, mode, onSelect = { mode = it })
        ChipSelect(ANTONOV_LLM, llm, onSelect = { llm = it })
        Button(
            onClick = { vm.thread(text, author, source, mode, llm) },
            enabled = !state.busy && text.isNotBlank(),
            shape = ArtelShapes.pill,
            modifier = Modifier.padding(horizontal = 20.dp),
        ) { Text(if (state.busy) "Работаю…" else "Собрать тред") }

        state.threadPosts.forEachIndexed { index, post ->
            BentoCard(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                PillBadge(
                    "${index + 1}",
                    MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                Text(post, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/* ==================== ChatPanelsScreen / ChatPanelsSheet ==================== */

private val PANEL_TABS = listOf("Память", "Ветки", "Профиль", "Ограничения")

/**
 * Панели чата поверх ChatScreen: 4 вкладки по контрактам memory/branch/profile/
 * constraints. [onBranchesChanged] дергается VM после успешного switch — экран
 * чата снаружи должен перезагрузить историю.
 */
@Composable
fun ChatPanelsScreen(
    container: AppContainer,
    sessionId: String,
    onBranchesChanged: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val vm: ChatPanelsViewModel = viewModel(
        key = "chat-panels-$sessionId",
        factory = viewModelFactory {
            initializer { ChatPanelsViewModel(container.repository, sessionId, onBranchesChanged) }
        }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }

    Column(modifier = modifier) {
        TabRow(selectedTabIndex = tab) {
            PANEL_TABS.forEachIndexed { index, label ->
                Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) })
            }
        }
        when (tab) {
            0 -> MemoryPanel(state, vm::loadMemory, vm::memoryAction, Modifier.fillMaxSize())
            1 -> BranchPanel(state, vm::loadBranches, vm::branchCheckpoint, vm::branchSwitch, Modifier.fillMaxSize())
            2 -> ProfilePanel(state, vm::loadProfile, vm::profileAction, Modifier.fillMaxSize())
            else -> ConstraintsPanel(state, vm::loadConstraints, vm::constraintsAction, Modifier.fillMaxSize())
        }
    }
}

/** Bottom-sheet обёртка (~70% высоты) для встраивания поверх ChatScreen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatPanelsSheet(
    container: AppContainer,
    sessionId: String,
    onBranchesChanged: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        ChatPanelsScreen(
            container = container,
            sessionId = sessionId,
            onBranchesChanged = onBranchesChanged,
            modifier = Modifier.heightIn(max = 520.dp),
        )
    }
}

@Composable
private fun MemoryPanel(
    state: ChatPanelsUiState,
    onRetry: () -> Unit,
    onAction: (MemoryActionRequest) -> Unit,
    modifier: Modifier = Modifier,
) {
    StateContainer(
        state = state.memory,
        onRetry = onRetry,
        modifier = modifier,
    ) { view ->
        var key by remember { mutableStateOf("") }
        var value by remember { mutableStateOf("") }
        var task by remember { mutableStateOf("") }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                NoticeText(state.memoryNotice)
                BentoCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (view.memoryEnabled) "Память включена" else "Память выключена",
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(
                            onClick = {
                                onAction(MemoryActionRequest(action = if (view.memoryEnabled) "off" else "on"))
                            },
                            enabled = !state.memoryBusy,
                        ) { Text(if (view.memoryEnabled) "Выключить" else "Включить") }
                    }
                    view.task?.let {
                        Text("Задача: $it", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Рабочая память", style = MaterialTheme.typography.titleSmall)
                    if (view.working.isEmpty()) {
                        Text(
                            "Пока пусто",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        view.working.forEach { (k, v) ->
                            Text("$k: $v", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }

            items(view.longTerm, key = { "lt-${it.key}" }) { item: LongTermItemDto ->
                BentoCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            item.key,
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(
                            onClick = { onAction(MemoryActionRequest(action = "forget", key = item.key)) },
                            enabled = !state.memoryBusy,
                        ) { Text("Забыть") }
                    }
                    Text(item.value, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        item.updatedAt,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Запомнить факт", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = key,
                        onValueChange = { key = it.take(200) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Ключ") },
                        singleLine = true,
                        enabled = !state.memoryBusy,
                    )
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it.take(2000) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Значение") },
                        minLines = 2,
                        enabled = !state.memoryBusy,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                onAction(MemoryActionRequest(action = "remember", key = key, value = value))
                                key = ""
                                value = ""
                            },
                            enabled = !state.memoryBusy && key.isNotBlank(),
                            shape = ArtelShapes.pill,
                        ) { Text("Запомнить") }
                        Button(
                            onClick = {
                                onAction(MemoryActionRequest(action = "task-add", key = key, value = value))
                                key = ""
                                value = ""
                            },
                            enabled = !state.memoryBusy && key.isNotBlank() && value.isNotBlank(),
                            shape = ArtelShapes.pill,
                        ) { Text("В задачу") }
                    }
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Задача сессии", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = task,
                        onValueChange = { task = it.take(2000) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Описание задачи") },
                        minLines = 2,
                        enabled = !state.memoryBusy,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                onAction(MemoryActionRequest(action = "task", description = task))
                                task = ""
                            },
                            enabled = !state.memoryBusy && task.isNotBlank(),
                            shape = ArtelShapes.pill,
                        ) { Text("Задать") }
                        TextButton(
                            onClick = { onAction(MemoryActionRequest(action = "task-clear")) },
                            enabled = !state.memoryBusy,
                        ) { Text("Очистить") }
                    }
                }
            }
        }
    }
}

@Composable
private fun BranchPanel(
    state: ChatPanelsUiState,
    onRetry: () -> Unit,
    onCheckpoint: (String) -> Unit,
    onSwitch: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    StateContainer(
        state = state.branches,
        onRetry = onRetry,
        modifier = modifier,
    ) { view ->
        var label by remember { mutableStateOf("") }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                NoticeText(state.branchNotice)
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Новый чекпоинт", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = label,
                        onValueChange = { label = it.take(100) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Название (например, «до рефакторинга»)") },
                        singleLine = true,
                        enabled = !state.branchBusy,
                    )
                    Button(
                        onClick = {
                            onCheckpoint(label)
                            label = ""
                        },
                        enabled = !state.branchBusy && label.isNotBlank(),
                        shape = ArtelShapes.pill,
                    ) { Text("Создать чекпоинт") }
                }
            }

            items(view.branches, key = { it.id }) { branch: BranchDto ->
                BentoCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(branch.label, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "${branch.messageCount} сообщ. · #${branch.id}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (branch.id == view.activeId) {
                            PillBadge("активная", MaterialTheme.colorScheme.secondary)
                        } else {
                            TextButton(
                                onClick = { onSwitch(branch.id) },
                                enabled = !state.branchBusy,
                            ) { Text("Переключить") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfilePanel(
    state: ChatPanelsUiState,
    onRetry: () -> Unit,
    onAction: (ProfileActionRequest) -> Unit,
    modifier: Modifier = Modifier,
) {
    StateContainer(
        state = state.profile,
        onRetry = onRetry,
        modifier = modifier,
    ) { view ->
        var newName by remember { mutableStateOf("") }
        var copyName by remember { mutableStateOf("") }
        var instruction by remember { mutableStateOf("") }
        var note by remember { mutableStateOf("") }
        var editLlm by remember { mutableStateOf<String?>("local") }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                NoticeText(state.profileNotice)
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Профили (${view.profiles.size})", style = MaterialTheme.typography.titleSmall)
                    if (view.profiles.isEmpty()) {
                        Text(
                            "Пока пусто",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        view.profiles.forEach { name ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    name,
                                    style = MaterialTheme.typography.bodyLarge,
                                    modifier = Modifier.weight(1f),
                                )
                                if (name == view.active) {
                                    PillBadge("активный", MaterialTheme.colorScheme.secondary)
                                } else {
                                    TextButton(
                                        onClick = { onAction(ProfileActionRequest(action = "use", name = name)) },
                                        enabled = !state.profileBusy,
                                    ) { Text("Использовать") }
                                }
                                IconButton(
                                    onClick = { onAction(ProfileActionRequest(action = "delete", name = name)) },
                                    enabled = !state.profileBusy,
                                ) {
                                    Icon(Icons.Rounded.Delete, contentDescription = "Удалить профиль")
                                }
                            }
                        }
                    }
                    view.summary?.let { Text("Итог правки: $it", style = MaterialTheme.typography.bodyMedium) }
                    TextButton(
                        onClick = { onAction(ProfileActionRequest(action = "reset")) },
                        enabled = !state.profileBusy,
                    ) { Text("Сбросить активный профиль") }
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Новый профиль", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = newName,
                        onValueChange = { newName = it.take(100) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Имя профиля") },
                        singleLine = true,
                        enabled = !state.profileBusy,
                    )
                    Button(
                        onClick = {
                            onAction(ProfileActionRequest(action = "new", name = newName))
                            newName = ""
                        },
                        enabled = !state.profileBusy && newName.isNotBlank(),
                        shape = ArtelShapes.pill,
                    ) { Text("Создать") }
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Копия профиля", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = copyName,
                        onValueChange = { copyName = it.take(100) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Имя нового профиля") },
                        singleLine = true,
                        enabled = !state.profileBusy,
                    )
                    Button(
                        onClick = {
                            view.active?.let { onAction(ProfileActionRequest(action = "copy", name = copyName, base = it)) }
                            copyName = ""
                        },
                        enabled = !state.profileBusy && copyName.isNotBlank() && view.active != null,
                        shape = ArtelShapes.pill,
                    ) { Text("Копировать активный") }
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Правка инструкцией", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = instruction,
                        onValueChange = { instruction = it.take(2000) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Что изменить в активном профиле") },
                        minLines = 2,
                        enabled = !state.profileBusy,
                    )
                    ChipSelect(
                        listOf("local" to "Локальная", "cloud" to "Облако"),
                        editLlm,
                        onSelect = { editLlm = it },
                    )
                    Button(
                        onClick = {
                            view.active?.let {
                                onAction(ProfileActionRequest(action = "edit", name = it, instruction = instruction, llm = editLlm))
                            }
                            instruction = ""
                        },
                        enabled = !state.profileBusy && instruction.isNotBlank() && view.active != null,
                        shape = ArtelShapes.pill,
                    ) { Text(if (state.profileBusy) "Правлю…" else "Применить") }
                }
            }

            item {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Заметка в профиль", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it.take(2000) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Факт о себе для активного профиля") },
                        minLines = 2,
                        enabled = !state.profileBusy,
                    )
                    Button(
                        onClick = {
                            onAction(ProfileActionRequest(action = "note", text = note))
                            note = ""
                        },
                        enabled = !state.profileBusy && note.isNotBlank(),
                        shape = ArtelShapes.pill,
                    ) { Text("Добавить") }
                }
            }

            item {
                view.snapshot?.let { snapshot ->
                    BentoCard(Modifier.fillMaxWidth()) {
                        Text("Снимок профиля", style = MaterialTheme.typography.titleSmall)
                        Text(
                            snapshot.toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

private val CONSTRAINT_TYPES = listOf(
    "architecture" to "Архитектура",
    "tech_decision" to "Решение",
    "stack" to "Стек",
    "business" to "Бизнес",
    "custom" to "Своё",
)

@Composable
private fun ConstraintsPanel(
    state: ChatPanelsUiState,
    onRetry: () -> Unit,
    onAction: (ConstraintsActionRequest) -> Unit,
    modifier: Modifier = Modifier,
) {
    StateContainer(
        state = state.constraints,
        onRetry = onRetry,
        modifier = modifier,
    ) { view ->
        var type by remember { mutableStateOf<String?>("custom") }
        var title by remember { mutableStateOf("") }
        var description by remember { mutableStateOf("") }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                NoticeText(state.constraintsNotice)
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Новое ограничение", style = MaterialTheme.typography.titleSmall)
                    ChipSelect(CONSTRAINT_TYPES, type, onSelect = { type = it })
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it.take(200) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Название") },
                        singleLine = true,
                        enabled = !state.constraintsBusy,
                    )
                    OutlinedTextField(
                        value = description,
                        onValueChange = { description = it.take(2000) },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Описание (необязательно)") },
                        minLines = 2,
                        enabled = !state.constraintsBusy,
                    )
                    Button(
                        onClick = {
                            onAction(
                                ConstraintsActionRequest(
                                    action = "add",
                                    type = type,
                                    title = title,
                                    description = description.takeIf { it.isNotBlank() },
                                )
                            )
                            title = ""
                            description = ""
                        },
                        enabled = !state.constraintsBusy && title.isNotBlank(),
                        shape = ArtelShapes.pill,
                    ) { Text("Добавить") }
                }
            }

            items(view.items, key = { it.id }) { item: ConstraintDto ->
                BentoCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            item.title,
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f),
                        )
                        PillBadge(
                            CONSTRAINT_TYPES.firstOrNull { it.first == item.type }?.second ?: item.type,
                            MaterialTheme.colorScheme.primary,
                        )
                        IconButton(
                            onClick = { onAction(ConstraintsActionRequest(action = "rm", id = item.id)) },
                            enabled = !state.constraintsBusy,
                        ) {
                            Icon(Icons.Rounded.Delete, contentDescription = "Удалить ограничение")
                        }
                    }
                    Text(item.description, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        item.createdAt,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
