// Compose-поверхности Telegram (#145): хаб с пятью входами — топ сообщений топика,
// сбор топика (SSE-лог), публикация в канал (подтверждение + двойной тап-гард),
// история outbox, RAG-чат «Эволюция бота» по образцу ChatScreen. Стримы событий
// парсит TgSseParser; все строки — русские, ошибки — локализованные, без URL/секретов.
package ru.memo7.artel.ui.screens.tg

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.memo7.artel.data.api.TgTopMessageDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.assistant.ChatMessage
import ru.memo7.artel.ui.theme.ArtelShapes

private const val MAX_PUBLISH_INPUT = 4096
private const val MAX_EVOLUTE_INPUT = 2000

/** Пять входов хаба — внутренняя навигация, общий экран не трогаем. */
private enum class TgSection(val label: String, val description: String) {
    TOP("Топ сообщений", "Популярные сообщения топика по реакциям или дате"),
    COLLECT("Сбор", "MTProto-сбор топика в базу с живым журналом прогресса"),
    PUBLISH("Публикация", "Отправка поста в Telegram-канал"),
    HISTORY("История", "Журнал отправленных постов"),
    EVOLUTE("Эволюция бота", "RAG-агент по чату «Эволют Чат»"),
}

/** Хаб Telegram-поверхностей: меню пяти разделов + текущий раздел. */
@Composable
fun TgHubScreen(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: TgViewModel = viewModel(
        factory = viewModelFactory { initializer { TgViewModel(container.repository) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var section by remember { mutableStateOf<TgSection?>(null) }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 12.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { if (section == null) onBack() else section = null }) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Column(Modifier.weight(1f)) {
                Text(
                    section?.label ?: "Telegram",
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    section?.description ?: "Инструменты Telegram-канала",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val current = section) {
                null -> TgHubMenu(onSelect = { section = it })
                TgSection.TOP -> TgTopContent(state, vm)
                TgSection.COLLECT -> TgCollectContent(state, vm)
                TgSection.PUBLISH -> TgPublishContent(state, vm)
                TgSection.HISTORY -> TgHistoryContent(state, vm)
                TgSection.EVOLUTE -> TgEvoluteContent(state, vm)
            }
        }
    }
}

@Composable
private fun TgHubMenu(onSelect: (TgSection) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(TgSection.entries.toList(), key = { it.name }) { section ->
            BentoCard(onClick = { onSelect(section) }) {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(section.label, style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        section.description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/* ---------- Топ сообщений ---------- */

@Composable
private fun TgTopContent(state: TgUiState, vm: TgViewModel) {
    val section = state.top
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        OutlinedTextField(
            value = section.chatKey,
            onValueChange = vm::setTopChatKey,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("chatKey (обязательно)") },
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = section.topicId,
                onValueChange = vm::setTopTopicId,
                modifier = Modifier.weight(1f),
                label = { Text("topicId (необяз.)") },
                singleLine = true,
            )
            Spacer(Modifier.weight(0.2f))
            FilterChip(
                selected = section.by == "reactions",
                onClick = { vm.setTopBy("reactions") },
                label = { Text("По реакциям") },
            )
            Spacer(Modifier.weight(0.2f))
            FilterChip(
                selected = section.by == "date",
                onClick = { vm.setTopBy("date") },
                label = { Text("По дате") },
            )
        }
        Spacer(Modifier.height(4.dp))
        Button(
            onClick = { vm.reloadTop() },
            enabled = section.chatKey.isNotBlank(),
            shape = ArtelShapes.pill,
        ) {
            Text("Показать топ")
        }
        StateContainer(
            state = section.load,
            onRetry = { vm.reloadTop() },
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            emptyCheck = { it.messages.isEmpty() },
            emptyMessage = "Нет сообщений",
            emptyHint = if (section.chatKey.isBlank()) {
                "Введите chatKey и нажмите «Показать топ»"
            } else {
                "В этом топике пока ничего нет"
            },
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(data.messages, key = { it.msg_id }) { message ->
                    TgTopCard(message)
                }
            }
        }
    }
}

@Composable
private fun TgTopCard(message: TgTopMessageDto) {
    BentoCard {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    message.from_name,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    message.date_iso,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                message.text,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 6,
                overflow = TextOverflow.Ellipsis,
            )
            if (message.reaction_total > 0 || message.reactions.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    buildString {
                        append("Реакции: ")
                        append(
                            message.reactions.entries
                                .sortedByDescending { it.value }
                                .joinToString(" · ") { "${it.key} ${it.value}" },
                        )
                        if (message.reactions.isEmpty()) append(message.reaction_total)
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

/* ---------- Сбор топика ---------- */

@Composable
private fun TgCollectContent(state: TgUiState, vm: TgViewModel) {
    val section = state.collect
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        OutlinedTextField(
            value = section.chatRef,
            onValueChange = vm::setCollectChatRef,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("chatRef (ссылка или ключ чата)") },
            singleLine = true,
            enabled = !section.running,
        )
        Spacer(Modifier.height(8.dp))
        Row {
            OutlinedTextField(
                value = section.topicId,
                onValueChange = vm::setCollectTopicId,
                modifier = Modifier.weight(1f),
                label = { Text("topicId (необяз.)") },
                singleLine = true,
                enabled = !section.running,
            )
            Spacer(Modifier.width(12.dp))
            OutlinedTextField(
                value = section.limit,
                onValueChange = vm::setCollectLimit,
                modifier = Modifier.weight(1f),
                label = { Text("limit (1..5000)") },
                singleLine = true,
                enabled = !section.running,
            )
        }
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Полный сброс топика перед сбором",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = section.reset,
                onCheckedChange = vm::setCollectReset,
                enabled = !section.running,
            )
        }
        Button(
            onClick = vm::runCollect,
            enabled = !section.running && section.chatRef.isNotBlank(),
            shape = ArtelShapes.pill,
        ) {
            Text(if (section.running) "Сбор идёт…" else "Начать сбор")
        }
        section.error?.let { error ->
            Spacer(Modifier.height(8.dp))
            Text(
                error,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
        section.summary?.let { summary ->
            Spacer(Modifier.height(12.dp))
            BentoCard {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(
                        "Сбор завершён · режим: ${collectModeLabel(summary.mode)}",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Получено: ${summary.fetched} · новых: ${summary.newlyInserted} · " +
                            "обновлено: ${summary.updated} · всего в топике: ${summary.total}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    summary.chatTitle?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (section.log.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Text("Журнал", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            section.log.forEach { line ->
                Text(
                    line,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

private fun collectModeLabel(mode: String): String = when (mode) {
    "full" -> "полный"
    "resume" -> "возобновление"
    "incremental" -> "инкрементальный"
    else -> mode
}

/* ---------- Публикация в канал ---------- */

@Composable
private fun TgPublishContent(state: TgUiState, vm: TgViewModel) {
    val section = state.publish
    var confirmPublish by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        OutlinedTextField(
            value = section.text,
            onValueChange = vm::setPublishText,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Текст поста…") },
            minLines = 4,
            maxLines = 8,
            enabled = !section.submitting,
            supportingText = {
                Text(
                    "${section.text.length} / $MAX_PUBLISH_INPUT",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (section.text.length >= MAX_PUBLISH_INPUT) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            },
        )
        Spacer(Modifier.height(4.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Формат:", style = MaterialTheme.typography.bodyMedium)
            FilterChip(
                selected = section.parseMode == "HTML",
                onClick = { vm.setPublishParseMode("HTML") },
                label = { Text("HTML") },
            )
            FilterChip(
                selected = section.parseMode == "none",
                onClick = { vm.setPublishParseMode("none") },
                label = { Text("Без разметки") },
            )
        }
        Spacer(Modifier.height(4.dp))
        Button(
            onClick = { confirmPublish = true },
            enabled = !section.submitting &&
                section.text.isNotBlank() &&
                section.text.length <= MAX_PUBLISH_INPUT,
            shape = ArtelShapes.pill,
        ) {
            Text(if (section.submitting) "Публикация…" else "Опубликовать")
        }
        section.result?.let { result ->
            Spacer(Modifier.height(8.dp))
            Text(
                result,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        section.error?.let { error ->
            Spacer(Modifier.height(8.dp))
            Text(
                error,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }

    if (confirmPublish) {
        AlertDialog(
            onDismissRequest = { confirmPublish = false },
            title = { Text("Опубликовать пост?") },
            text = { Text("Пост будет отправлен в Telegram-канал. Действие необратимо.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmPublish = false
                        vm.submitPublish()
                    },
                    enabled = !section.submitting,
                ) { Text("Опубликовать") }
            },
            dismissButton = {
                TextButton(onClick = { confirmPublish = false }) { Text("Отмена") }
            },
        )
    }
}

/* ---------- История outbox ---------- */

@Composable
private fun TgHistoryContent(state: TgUiState, vm: TgViewModel) {
    val section = state.history
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Журнал отправленных постов",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { vm.reloadHistory() }) { Text("Обновить") }
        }
        StateContainer(
            state = section.load,
            onRetry = { vm.reloadHistory() },
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            emptyCheck = { it.items.isEmpty() },
            emptyMessage = "Пока пусто",
            emptyHint = "Отправленных постов ещё нет",
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(data.items, key = { it.id }) { item ->
                    BentoCard {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Text(
                                item.text,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.height(6.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                val isOk = item.status == "ok"
                                PillBadge(
                                    text = if (isOk) "ok" else "ошибка",
                                    tint = if (isOk) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.error
                                    },
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    item.createdAt,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (item.error != null) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    item.error.orEmpty(),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ---------- Эволюция бота (RAG-чат) ---------- */

@Composable
private fun TgEvoluteContent(state: TgUiState, vm: TgViewModel) {
    val section = state.evolute
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(section.messages.size, section.messages.lastOrNull()?.text) {
        if (section.messages.isNotEmpty()) {
            listState.animateScrollToItem(section.messages.lastIndex)
        }
    }

    Column(Modifier.fillMaxSize()) {
        section.notice?.let { notice ->
            Text(
                notice,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }
        if (section.messages.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Задайте вопрос про чат «Эволют Чат»",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(section.messages, key = { it.id }) { message ->
                    TgChatBubble(message)
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
                onValueChange = { input = it.take(MAX_EVOLUTE_INPUT) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Вопрос…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
                supportingText = {
                    Text(
                        "${input.length} / $MAX_EVOLUTE_INPUT",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (input.length >= MAX_EVOLUTE_INPUT) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                },
            )
            if (section.busy) {
                IconButton(onClick = vm::stopEvolute) {
                    Icon(Icons.Rounded.Stop, contentDescription = "Остановить генерацию")
                }
            } else {
                IconButton(
                    onClick = {
                        vm.sendEvolute(input)
                        input = ""
                    },
                    enabled = input.isNotBlank() && input.length <= MAX_EVOLUTE_INPUT,
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

/** Пузырь чата эволюции — локальная копия паттерна ChatBubble (chat-пакет не импортируем). */
@Composable
private fun TgChatBubble(message: ChatMessage, modifier: Modifier = Modifier) {
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
