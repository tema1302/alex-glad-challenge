package ru.memo7.artel.data.api

import kotlinx.serialization.Serializable

/* ---------- Integrations: webhooks + inbound hooks (web parity) ---------- */

/** GET/POST /api/integrations/webhooks — исходящие вебхуки. */
@Serializable
data class WebhookDto(
    val id: Long,
    val name: String,
    val url: String,
    // Секрет в списке не отдаётся — только факт наличия.
    val hasSecret: Boolean,
    val events: List<String> = emptyList(),
    val enabled: Boolean,
    val createdAt: String,
)

/** Последние 50 доставок (общий список, фильтруем по webhookId на клиенте). */
@Serializable
data class WebhookDeliveryDto(
    val id: Long,
    val webhookId: Long,
    val event: String,
    val status: String,
    val responseCode: Int,
    val error: String? = null,
    val createdAt: String,
)

@Serializable
data class WebhooksResponse(
    val ok: Boolean,
    val webhooks: List<WebhookDto> = emptyList(),
    val deliveries: List<WebhookDeliveryDto> = emptyList(),
)

/** POST /api/integrations/webhooks — secret опционален, null не уходит в JSON. */
@Serializable
data class CreateWebhookRequest(
    val name: String,
    val url: String,
    val secret: String? = null,
    val events: List<String> = emptyList(),
)

/** GET /api/integrations/inbound — входящие хуки; секретов в списке нет. */
@Serializable
data class InboundHookDto(
    val id: Long,
    val name: String,
    // 'notification' | 'todo'
    val target: String,
    val url: String,
    val createdAt: String,
)

@Serializable
data class InboundHooksResponse(
    val ok: Boolean,
    val hooks: List<InboundHookDto> = emptyList(),
)

/** POST /api/integrations/inbound — secret возвращается ровно один раз. */
@Serializable
data class CreateInboundHookRequest(
    val name: String,
    val target: String,
)

@Serializable
data class CreateInboundHookResponse(
    val ok: Boolean,
    val id: Long,
    val secret: String,
    val url: String,
)
