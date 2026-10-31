package ru.memo7.artel.ui.screens.mcp

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import ru.memo7.artel.core.UiState
import ru.memo7.artel.data.api.McpToolDto
import ru.memo7.artel.data.api.McpToolsResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes

/** Длина превью inputSchema до сворачивания. */
private const val SCHEMA_PREVIEW_LIMIT = 160

/** Список MCP-инструментов и вызов: GET /api/mcp/tools + POST /api/mcp/call. */
@Composable
fun McpScreen(
    container: AppContainer,
    onBack: () -> Unit,
) {
    val vm: McpViewModel = viewModel(
        factory = viewModelFactory { initializer { McpViewModel(container.repository) } }
    )
    val toolsState by vm.tools.collectAsStateWithLifecycle()
    val callState by vm.callState.collectAsStateWithLifecycle()
    var argsInput by remember(callState.tool) { mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 12.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Text("MCP-инструменты", style = MaterialTheme.typography.titleLarge)
        }

        val response = (toolsState as? UiState.Success)?.data
        if (response != null) {
            when {
                !response.configured -> ServerBanner(
                    title = "Сервер MCP не настроен",
                    detail = response.error,
                )
                response.error != null -> ServerBanner(
                    title = "Ошибка MCP-сервера",
                    detail = response.error,
                )
            }
        }

        StateContainer(
            state = toolsState,
            onRetry = vm::refresh,
            emptyCheck = { it.tools.isEmpty() },
            emptyMessage = "Инструментов нет",
            emptyHint = "На сервере пока нет доступных MCP-инструментов",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            ToolList(
                data = data,
                selectedTool = callState.tool,
                onSelect = vm::selectTool,
            )
        }

        val selected = callState.tool
        if (selected != null) {
            CallPanel(
                tool = selected,
                state = callState,
                args = argsInput,
                onArgsChange = { argsInput = it; vm.onArgsChanged(it) },
                onCall = { vm.call(selected, argsInput) },
                onClose = vm::clearSelection,
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .verticalScroll(rememberScrollState()),
            )
        }
    }
}

@Composable
private fun ServerBanner(title: String, detail: String?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp)
            .clip(ArtelShapes.chip)
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
        if (!detail.isNullOrBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(
                detail,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun ToolList(
    data: McpToolsResponse,
    selectedTool: String?,
    onSelect: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(data.tools, key = { it.name }) { tool ->
            ToolCard(
                tool = tool,
                selected = tool.name == selectedTool,
                onClick = { onSelect(tool.name) },
            )
        }
    }
}

@Composable
private fun ToolCard(tool: McpToolDto, selected: Boolean, onClick: () -> Unit) {
    BentoCard(
        onClick = onClick,
        tint = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else null,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                tool.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!tool.description.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    tool.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val schema = tool.inputSchema
            if (schema != null && schema !is JsonNull) {
                Spacer(Modifier.height(8.dp))
                SchemaPreview(schema)
            }
        }
    }
}

/** Компактный monospace-превью inputSchema; длинные схемы сворачиваются кнопкой. */
@Composable
private fun SchemaPreview(schema: JsonElement) {
    var expanded by remember { mutableStateOf(false) }
    val raw = remember(schema) { schema.toString() }
    val preview = if (expanded || raw.length <= SCHEMA_PREVIEW_LIMIT) raw else raw.take(SCHEMA_PREVIEW_LIMIT) + "…"
    Text(
        "Схема ввода",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(2.dp))
    Text(
        preview,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (raw.length > SCHEMA_PREVIEW_LIMIT) {
        TextButton(onClick = { expanded = !expanded }) {
            Text(if (expanded) "Свернуть" else "Показать целиком")
        }
    }
}

/** Панель вызова выбранного инструмента: args, кнопка «Вызвать», результат или ошибка. */
@Composable
private fun CallPanel(
    tool: String,
    state: McpCallState,
    args: String,
    onArgsChange: (String) -> Unit,
    onCall: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                tool,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.size(8.dp))
            }
            TextButton(onClick = onClose, enabled = !state.busy) { Text("Закрыть") }
        }
        OutlinedTextField(
            value = args,
            onValueChange = onArgsChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Аргументы JSON") },
            placeholder = { Text("{\"city\": \"Казань\"}") },
            isError = state.argsError != null,
            supportingText = state.argsError?.let { message ->
                { Text(message, color = MaterialTheme.colorScheme.error) }
            },
            enabled = !state.busy,
            minLines = 3,
            maxLines = 6,
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            shape = ArtelShapes.chip,
        )
        Spacer(Modifier.height(6.dp))
        Button(
            onClick = onCall,
            enabled = !state.busy && state.argsError == null,
            shape = ArtelShapes.pill,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Вызвать")
        }
        val result = state.result
        val error = state.error
        if (result != null) {
            Spacer(Modifier.height(8.dp))
            MonospaceOutput(result)
        } else if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                error,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/** Scrollable monospace-вывод результата вызова. */
@Composable
private fun MonospaceOutput(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 180.dp)
            .clip(ArtelShapes.chip)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
