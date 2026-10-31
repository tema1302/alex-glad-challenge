package ru.memo7.artel.ui.screens.sys

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.memo7.artel.data.api.AdminServersResponse
import ru.memo7.artel.data.api.BriefingResponse
import ru.memo7.artel.data.api.BriefingStatsDto
import ru.memo7.artel.data.api.TopTgMessageDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.EmptyBox
import ru.memo7.artel.ui.components.ErrorBox
import ru.memo7.artel.ui.components.LoadingBox
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.SectionTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes

@Composable
private fun sysViewModel(container: AppContainer): SysViewModel = viewModel(
    factory = viewModelFactory { initializer { SysViewModel(container.repository) } },
)

/** Заголовок экрана sys-раздела: назад + заголовок. */
@Composable
private fun SysTopBar(title: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 12.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
        }
        Text(title, style = MaterialTheme.typography.titleLarge)
    }
}

/* ---------- Хаб ---------- */

/** Вход в sys-поверхности (#148): Агент / Брифинг / Сводка / Серверы. */
@Composable
fun SysHubScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onAgent: () -> Unit,
    onBriefing: () -> Unit,
    onSummary: () -> Unit,
    onServers: () -> Unit,
) {
    val entries = listOf(
        Triple("Агент", "Одноразовый вопрос к LLM — без истории диалога", onAgent),
        Triple("Брифинг", "Сводка задач, статистика и топ сообщений", onBriefing),
        Triple("Сводка", "Ожидающие задачи и публикация в канал", onSummary),
        Triple("Серверы", "Статусы MCP, LLM, Telegram и активная модель", onServers),
    )
    Column(Modifier.fillMaxSize()) {
        SysTopBar("Система", onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(entries, key = { it.first }) { (title, subtitle, onClick) ->
                BentoCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
                    Text(title, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/* ---------- Агент ---------- */

/** POST /api/agent: промпт ≤8000 со счётчиком, переключатель llm, ответ-пузырь. */
@Composable
fun SysAgentScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: SysViewModel = sysViewModel(container)
    val state by vm.agent.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    var llm by remember { mutableStateOf(LLM_CLOUD) }

    Column(Modifier.fillMaxSize()) {
        SysTopBar("Агент", onBack)

        when {
            state.busy -> LoadingBox(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            )

            state.error != null -> ErrorBox(
                message = state.error.orEmpty(),
                onRetry = { state.lastPrompt?.let { vm.sendAgent(it, llm) } },
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            )

            state.answer != null -> Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 16.dp),
            ) {
                state.lastPrompt?.let { prompt ->
                    Text(
                        prompt,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(10.dp))
                }
                AgentAnswerBubble(state.answer.orEmpty())
            }

            else -> EmptyBox(
                message = "Ответ появится здесь",
                hint = "Введите промпт и нажмите «Отправить»",
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            )
        }

        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        ) {
            SegmentedButton(
                selected = llm == LLM_CLOUD,
                onClick = { llm = LLM_CLOUD },
                shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
            ) { Text("Облако") }
            SegmentedButton(
                selected = llm == LLM_LOCAL,
                onClick = { llm = LLM_LOCAL },
                shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
            ) { Text("Локально") }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .imePadding(),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.take(MAX_AGENT_PROMPT_LENGTH) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Промпт для агента…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
                supportingText = {
                    Text(
                        "${input.length} / $MAX_AGENT_PROMPT_LENGTH",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (input.length >= MAX_AGENT_PROMPT_LENGTH) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                },
            )
            IconButton(
                onClick = {
                    vm.sendAgent(input, llm)
                    input = ""
                },
                enabled = !state.busy && input.isNotBlank() && input.length <= MAX_AGENT_PROMPT_LENGTH,
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

@Composable
private fun AgentAnswerBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(MaterialTheme.shapes.extraLarge.copy(bottomStart = CornerSize(6.dp)))
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Text(text, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

/* ---------- Брифинг ---------- */

/** GET /api/briefing: todoSummary, 10 stat-карточек, топ TG по реакциям. */
@Composable
fun SysBriefingScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: SysViewModel = sysViewModel(container)
    val state by vm.briefing.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.loadBriefing() }

    Column(Modifier.fillMaxSize()) {
        SysTopBar("Брифинг", onBack)
        StateContainer(
            state = state,
            onRetry = { vm.loadBriefing() },
            emptyCheck = { it.todoSummary.isBlank() && it.topTg.isNullOrEmpty() },
            emptyMessage = "Брифинг пуст",
            emptyHint = "На сервере пока нет ни задач, ни собранных сообщений",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            BriefingContent(data)
        }
    }
}

@Composable
private fun BriefingContent(data: BriefingResponse) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "todo") {
            BentoCard(Modifier.fillMaxWidth()) {
                Text("Ожидающие задачи", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    data.todoSummary.ifBlank { "Нет ожидающих задач" },
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }

        item(key = "stats") {
            Column {
                SectionTitle("Статистика")
                Spacer(Modifier.height(8.dp))
                briefingStatCards(data.stats).forEach { (label, value) ->
                    StatRow(label, value)
                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        val top = data.topTg.orEmpty()
        if (top.isNotEmpty()) {
            item(key = "top-title") {
                SectionTitle("Топ сообщений по реакциям")
            }
            items(top, key = { it.msgId }) { message ->
                TopTgCard(message)
            }
        }
    }
}

@Composable
private fun StatRow(label: String, value: Int) {
    BentoCard(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Text(
                "$value",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun TopTgCard(message: TopTgMessageDto) {
    BentoCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                message.fromName.ifBlank { "Без имени" },
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            PillBadge(
                text = "❤ ${message.reactionTotal}",
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(message.text, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            message.dateIso,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun briefingStatCards(stats: BriefingStatsDto): List<Pair<String, Int>> = listOf(
    "Новости блога" to stats.news,
    "Посты блога" to stats.posts,
    "RAG: факты" to stats.ragFixed,
    "RAG: структура" to stats.ragStructure,
    "RAG: Telegram" to stats.ragTelegram,
    "TG: сообщения" to stats.tgMessages,
    "TG: чаты" to stats.tgChats,
    "TG: темы" to stats.tgTopics,
    "Диалоги: чаты" to stats.dialogChats,
    "Диалоги: сообщения" to stats.dialogMessages,
)

/* ---------- Сводка ---------- */

/** GET /api/summary + POST publish с confirm-диалогом и busy-гардом от двойного тапа. */
@Composable
fun SysSummaryScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: SysViewModel = sysViewModel(container)
    val state by vm.summary.collectAsStateWithLifecycle()
    var confirmPublish by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadSummary() }

    Column(Modifier.fillMaxSize()) {
        SysTopBar("Сводка", onBack)
        StateContainer(
            state = state.load,
            onRetry = vm::loadSummary,
            emptyCheck = { it.summary.isBlank() },
            emptyMessage = "Сводка пуста",
            emptyHint = "Ожидающих задач нет — публиковать нечего",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "summary") {
                    BentoCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Ожидающие задачи",
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.weight(1f),
                            )
                            if (data.publishable) {
                                PillBadge("Можно публиковать", MaterialTheme.colorScheme.secondary)
                            } else {
                                PillBadge("TG не настроен", MaterialTheme.colorScheme.error)
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(data.summary, style = MaterialTheme.typography.bodyLarge)
                    }
                }

                if (data.publishable) {
                    item(key = "publish") {
                        Button(
                            onClick = { confirmPublish = true },
                            enabled = !state.publishing,
                            shape = ArtelShapes.pill,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                if (state.publishing) "Публикация…" else "Опубликовать в канал",
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }
        }

        state.publishResult?.let { result ->
            Text(
                result,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            )
        }
        state.publishError?.let { error ->
            Text(
                error,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            )
        }
    }

    if (confirmPublish) {
        AlertDialog(
            onDismissRequest = { confirmPublish = false },
            title = { Text("Опубликовать сводку?") },
            text = { Text("Текст ожидающих задач будет отправлен в Telegram-канал. Действие нельзя отменить.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmPublish = false
                        vm.publishSummary()
                    },
                    enabled = !state.publishing,
                ) { Text("Опубликовать") }
            },
            dismissButton = {
                TextButton(onClick = { confirmPublish = false }) { Text("Отмена") }
            },
        )
    }
}

/* ---------- Серверы ---------- */

/** GET /api/admin/servers: статусы секций; 401 уходит в авто-логаут репозитория. */
@Composable
fun SysServersScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: SysViewModel = sysViewModel(container)
    val state by vm.servers.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.loadServers() }

    Column(Modifier.fillMaxSize()) {
        SysTopBar("Серверы", onBack)
        StateContainer(
            state = state,
            onRetry = vm::loadServers,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            ServersContent(data)
        }
    }
}

@Composable
private fun ServersContent(data: AdminServersResponse) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (data.activeModel != null || data.activeProvider != null) {
            item(key = "active") {
                BentoCard(Modifier.fillMaxWidth()) {
                    Text("Активная модель", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        listOfNotNull(data.activeProvider, data.activeModel).joinToString(" · "),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }

        item(key = "mcp") {
            ServerCard(
                title = "MCP",
                configured = data.mcp.configured,
                details = buildList {
                    data.mcp.host?.let { add("Хост: $it") }
                    add("Авторизация: " + if (data.mcp.authConfigured) "настроена" else "не настроена")
                },
            )
        }
        item(key = "cloud") {
            ServerCard(
                title = "Облачная LLM",
                configured = data.cloud.configured,
                details = buildList {
                    data.cloud.provider?.let { add("Провайдер: $it") }
                    data.cloud.model?.let { add("Модель: $it") }
                },
            )
        }
        item(key = "local") {
            ServerCard(
                title = "Локальная LLM",
                configured = data.local.configured,
                details = buildList { data.local.model?.let { add("Модель: $it") } },
            )
        }
        item(key = "embed") {
            ServerCard(
                title = "Эмбеддинги",
                configured = data.embed.configured,
                details = buildList { data.embed.model?.let { add("Модель: $it") } },
            )
        }
        item(key = "mtproto") {
            ServerCard(
                title = "MTProto (userbot)",
                configured = data.mtproto.configured,
                details = emptyList(),
            )
        }
        item(key = "botapi") {
            ServerCard(
                title = "Telegram Bot API",
                configured = data.botApi.configured,
                details = buildList {
                    data.botApi.channelLabel?.let { add("Канал: $it") }
                },
            )
        }
    }
}

@Composable
private fun ServerCard(title: String, configured: Boolean, details: List<String>) {
    BentoCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = if (configured) Icons.Rounded.Check else Icons.Rounded.Close,
                contentDescription = if (configured) "Настроен" else "Не настроен",
                tint = if (configured) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error,
                modifier = Modifier.size(20.dp),
            )
        }
        if (details.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            details.forEach { detail ->
                Text(
                    detail,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
