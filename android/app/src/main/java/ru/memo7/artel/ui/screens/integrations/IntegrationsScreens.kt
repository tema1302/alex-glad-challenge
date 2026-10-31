package ru.memo7.artel.ui.screens.integrations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ru.memo7.artel.core.UiState
import ru.memo7.artel.data.api.InboundHookDto
import ru.memo7.artel.data.api.InboundHooksResponse
import ru.memo7.artel.data.api.WebhookDeliveryDto
import ru.memo7.artel.data.api.WebhookDto
import ru.memo7.artel.data.api.WebhooksResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes

internal fun webhookEventLabel(event: String): String = when (event) {
    "post_published" -> "Публикация поста"
    "todo_completed" -> "Задача выполнена"
    "automation_run" -> "Запуск автоматизации"
    else -> event
}

internal fun inboundTargetLabel(target: String): String = when (target) {
    "notification" -> "Уведомление"
    "todo" -> "Задача"
    else -> target
}

/** Интеграции (web parity /api/integrations): вкладки «Webhooks» и «Inbound». */
@Composable
fun IntegrationsScreen(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: IntegrationsViewModel = viewModel(
        factory = viewModelFactory { initializer { IntegrationsViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableStateOf(0) }
    var showWebhookForm by remember { mutableStateOf(false) }
    var showInboundForm by remember { mutableStateOf(false) }
    var webhookToDelete by remember { mutableStateOf<WebhookDto?>(null) }
    var inboundToDelete by remember { mutableStateOf<InboundHookDto?>(null) }

    LaunchedEffect(Unit) {
        vm.messages.collect { message -> snackbarHostState.showSnackbar(message = message, withDismissAction = true) }
    }
    LaunchedEffect(state.webhookForm) {
        if (state.webhookForm is WebhookFormState.Done) {
            showWebhookForm = false
            vm.resetWebhookForm()
        }
    }
    LaunchedEffect(state.inboundForm) {
        if (state.inboundForm is InboundFormState.Done) {
            showInboundForm = false
            vm.resetInboundForm()
        }
    }

    Scaffold(
        containerColor = Color.Transparent,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { if (tab == 0) showWebhookForm = true else showInboundForm = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = ArtelShapes.chip,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = "Добавить")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, end = 20.dp, top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
                }
                ScreenTitle("Интеграции", modifier = Modifier.weight(1f))
            }
            TabRow(selectedTabIndex = tab) {
                Tab(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    text = { Text("Webhooks") },
                )
                Tab(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    text = { Text("Inbound") },
                )
            }
            when (tab) {
                0 -> WebhooksTab(
                    state = state.webhooks,
                    onRetry = vm::load,
                    onDelete = { webhookToDelete = it },
                    modifier = Modifier.fillMaxSize(),
                )
                else -> InboundTab(
                    state = state.inbound,
                    onRetry = vm::load,
                    onDelete = { inboundToDelete = it },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }

    if (showWebhookForm) {
        WebhookFormDialog(
            formState = state.webhookForm,
            onDismiss = {
                showWebhookForm = false
                vm.resetWebhookForm()
            },
            onCreate = { name, url, secret, events -> vm.createWebhook(name, url, secret, events) },
        )
    }
    if (showInboundForm) {
        InboundFormDialog(
            formState = state.inboundForm,
            onDismiss = {
                showInboundForm = false
                vm.resetInboundForm()
            },
            onCreate = { name, target -> vm.createInbound(name, target) },
        )
    }
    webhookToDelete?.let { webhook ->
        AlertDialog(
            onDismissRequest = { webhookToDelete = null },
            title = { Text("Удалить вебхук?") },
            text = { Text("«${webhook.name}» и его доставки будут удалены без возможности восстановления.") },
            confirmButton = {
                TextButton(onClick = {
                    webhookToDelete = null
                    vm.deleteWebhook(webhook.id)
                }) { Text("Удалить") }
            },
            dismissButton = {
                TextButton(onClick = { webhookToDelete = null }) { Text("Отмена") }
            },
        )
    }
    inboundToDelete?.let { hook ->
        AlertDialog(
            onDismissRequest = { inboundToDelete = null },
            title = { Text("Удалить inbound-хук?") },
            text = { Text("«${hook.name}» перестанет принимать запросы. Внешние системы получат ошибку.") },
            confirmButton = {
                TextButton(onClick = {
                    inboundToDelete = null
                    vm.deleteInbound(hook.id)
                }) { Text("Удалить") }
            },
            dismissButton = {
                TextButton(onClick = { inboundToDelete = null }) { Text("Отмена") }
            },
        )
    }
    // Секрет живёт только в этом диалоге; закрытие стирает его из состояния VM.
    state.createdInbound?.let { created ->
        InboundSecretDialog(
            created = created,
            onClose = vm::dismissCreatedInbound,
        )
    }
}

@Composable
private fun WebhooksTab(
    state: UiState<WebhooksResponse>,
    onRetry: () -> Unit,
    onDelete: (WebhookDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expandedIds by remember { mutableStateOf(setOf<Long>()) }
    StateContainer(
        state = state,
        onRetry = onRetry,
        emptyCheck = { it.webhooks.isEmpty() },
        emptyMessage = "Вебхуки не настроены",
        emptyHint = "Добавьте вебхук кнопкой «+» внизу экрана",
        modifier = modifier,
    ) { data ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(data.webhooks, key = { it.id }) { webhook ->
                WebhookCard(
                    webhook = webhook,
                    deliveries = data.deliveries.filter { it.webhookId == webhook.id },
                    expanded = webhook.id in expandedIds,
                    onToggleDeliveries = {
                        expandedIds =
                            if (webhook.id in expandedIds) expandedIds - webhook.id else expandedIds + webhook.id
                    },
                    onDelete = { onDelete(webhook) },
                    modifier = Modifier.animateItem(),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WebhookCard(
    webhook: WebhookDto,
    deliveries: List<WebhookDeliveryDto>,
    expanded: Boolean,
    onToggleDeliveries: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BentoCard(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                webhook.name,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            IconButton(onClick = onDelete) {
                Icon(Icons.Rounded.Delete, contentDescription = "Удалить вебхук")
            }
        }
        Text(
            webhook.url,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            PillBadge(
                text = if (webhook.enabled) "Включён" else "Выключен",
                tint = if (webhook.enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (webhook.hasSecret) {
                PillBadge(text = "Секрет", tint = MaterialTheme.colorScheme.secondary)
            }
            webhook.events.forEach { event ->
                PillBadge(text = webhookEventLabel(event), tint = MaterialTheme.colorScheme.tertiary)
            }
        }
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = onToggleDeliveries) {
            Text(if (expanded) "Скрыть доставки" else "Доставки (${deliveries.size})")
        }
        if (expanded) {
            if (deliveries.isEmpty()) {
                Text(
                    "Доставок пока не было",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    deliveries.forEach { delivery -> DeliveryRow(delivery) }
                }
            }
        }
    }
}

@Composable
private fun DeliveryRow(delivery: WebhookDeliveryDto) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                webhookEventLabel(delivery.event),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f),
            )
            PillBadge(
                text = delivery.status,
                tint = if (delivery.status == "success") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            )
        }
        Text(
            "Код ответа: ${delivery.responseCode} · ${delivery.createdAt}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (delivery.error != null) {
            Text(
                delivery.error,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun InboundTab(
    state: UiState<InboundHooksResponse>,
    onRetry: () -> Unit,
    onDelete: (InboundHookDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    StateContainer(
        state = state,
        onRetry = onRetry,
        emptyCheck = { it.hooks.isEmpty() },
        emptyMessage = "Inbound-хуки не настроены",
        emptyHint = "Добавьте хук кнопкой «+» внизу экрана",
        modifier = modifier,
    ) { data ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(data.hooks, key = { it.id }) { hook ->
                InboundHookCard(hook = hook, onDelete = { onDelete(hook) }, modifier = Modifier.animateItem())
            }
        }
    }
}

@Composable
private fun InboundHookCard(
    hook: InboundHookDto,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BentoCard(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                hook.name,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            PillBadge(text = inboundTargetLabel(hook.target), tint = MaterialTheme.colorScheme.primary)
            IconButton(onClick = onDelete) {
                Icon(Icons.Rounded.Delete, contentDescription = "Удалить хук")
            }
        }
        Text(
            hook.url,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WebhookFormDialog(
    formState: WebhookFormState,
    onDismiss: () -> Unit,
    onCreate: (name: String, url: String, secret: String, events: List<String>) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var events by remember { mutableStateOf(emptyList<String>()) }
    val busy = formState is WebhookFormState.Busy
    val error = (formState as? WebhookFormState.Failure)?.message

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Новый вебхук") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(MAX_WEBHOOK_NAME_LENGTH) },
                    label = { Text("Название") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it.take(MAX_WEBHOOK_URL_LENGTH) },
                    label = { Text("URL (http:// или https://)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = secret,
                    onValueChange = { secret = it.take(MAX_WEBHOOK_SECRET_LENGTH) },
                    label = { Text("Секрет (необязательно)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "События",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WEBHOOK_EVENTS.forEach { event ->
                        FilterChip(
                            selected = event in events,
                            onClick = {
                                events = if (event in events) events - event else events + event
                            },
                            label = { Text(webhookEventLabel(event)) },
                            enabled = !busy,
                        )
                    }
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = { onCreate(name, url, secret, events) },
            ) { Text(if (busy) "Создаём…" else "Создать") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Отмена") }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InboundFormDialog(
    formState: InboundFormState,
    onDismiss: () -> Unit,
    onCreate: (name: String, target: String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var target by remember { mutableStateOf(INBOUND_TARGETS.first()) }
    val busy = formState is InboundFormState.Busy
    val error = (formState as? InboundFormState.Failure)?.message

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Новый inbound-хук") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(MAX_INBOUND_NAME_LENGTH) },
                    label = { Text("Название") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Цель",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    INBOUND_TARGETS.forEach { option ->
                        FilterChip(
                            selected = target == option,
                            onClick = { target = option },
                            label = { Text(inboundTargetLabel(option)) },
                            enabled = !busy,
                        )
                    }
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = { onCreate(name, target) },
            ) { Text(if (busy) "Создаём…" else "Создать") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Отмена") }
        },
    )
}

/** Диалог «Сохраните секрет»: единственное место, где секрет виден. После закрытия стирается. */
@Composable
private fun InboundSecretDialog(
    created: CreatedInboundHook,
    onClose: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Сохраните секрет") },
        text = {
            Column {
                Text(
                    "Секрет показывается только один раз — после закрытия этого окна его нельзя будет посмотреть снова.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                SelectionContainer {
                    Column {
                        Text(
                            "URL: ${created.url}",
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            created.secret,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
                if (copied) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Скопировано в буфер обмена",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (copied) {
                        onClose()
                    } else {
                        clipboard.setText(AnnotatedString("${created.url}\n${created.secret}"))
                        copied = true
                    }
                },
            ) { Text(if (copied) "Закрыть" else "Скопировать") }
        },
    )
}
