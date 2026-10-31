package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/**
 * Plain JVM unit-тест контракта интеграций (web /api/integrations):
 * webhooks + deliveries декодируются целиком (hasSecret — boolean, error может
 * быть null), секрет inbound-хука приходит ровно один раз в create-ответе,
 * а encode create-запросов не тащит опциональные поля лишним.
 */
class IntegrationsModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `webhooks response decodes events list and hasSecret flags`() {
        val payload = """
            {
              "ok": true,
              "webhooks": [
                {
                  "id": 1,
                  "name": "Посты",
                  "url": "https://example.com/hook",
                  "hasSecret": true,
                  "events": ["post_published", "automation_run"],
                  "enabled": true,
                  "createdAt": "2026-09-08T10:00:00.000Z"
                },
                {
                  "id": 2,
                  "name": "Без секрета",
                  "url": "http://127.0.0.1:9000/hook",
                  "hasSecret": false,
                  "events": [],
                  "enabled": false,
                  "createdAt": "2026-09-08T11:00:00.000Z"
                }
              ],
              "deliveries": []
            }
        """.trimIndent()

        val dto = json.decodeFromString<WebhooksResponse>(payload)

        assertEquals(2, dto.webhooks.size)
        val (withSecret, withoutSecret) = dto.webhooks
        assertTrue(withSecret.hasSecret)
        assertEquals(listOf("post_published", "automation_run"), withSecret.events)
        assertTrue(withSecret.enabled)
        assertFalse(withoutSecret.hasSecret)
        assertTrue(withoutSecret.events.isEmpty())
        assertFalse(withoutSecret.enabled)
    }

    @Test
    fun `deliveries decode with null and non-null error`() {
        val payload = """
            {
              "ok": true,
              "webhooks": [],
              "deliveries": [
                {
                  "id": 10,
                  "webhookId": 1,
                  "event": "post_published",
                  "status": "success",
                  "responseCode": 200,
                  "error": null,
                  "createdAt": "2026-09-08T12:00:00.000Z"
                },
                {
                  "id": 11,
                  "webhookId": 1,
                  "event": "todo_completed",
                  "status": "failed",
                  "responseCode": 500,
                  "error": "connection refused",
                  "createdAt": "2026-09-08T12:05:00.000Z"
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<WebhooksResponse>(payload)

        assertEquals(2, dto.deliveries.size)
        val success = dto.deliveries[0]
        assertEquals(1L, success.webhookId)
        assertEquals(200, success.responseCode)
        assertNull("error успешной доставки обязан быть null", success.error)
        val failed = dto.deliveries[1]
        assertEquals(500, failed.responseCode)
        assertEquals("connection refused", failed.error)
    }

    @Test
    fun `inbound hooks list decodes without secrets`() {
        val payload = """
            {
              "ok": true,
              "hooks": [
                {
                  "id": 5,
                  "name": "Внешний триггер",
                  "target": "todo",
                  "url": "https://artel.example.com/api/integrations/inbound/5",
                  "createdAt": "2026-09-08T13:00:00.000Z"
                }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<InboundHooksResponse>(payload)

        val hook = dto.hooks.single()
        assertEquals("todo", hook.target)
        assertEquals("Внешний триггер", hook.name)
    }

    @Test
    fun `inbound create response carries one-time secret`() {
        val payload = """
            {
              "ok": true,
              "id": 7,
              "secret": "hmac-secret-value",
              "url": "https://artel.example.com/api/integrations/inbound/7"
            }
        """.trimIndent()

        val dto = json.decodeFromString<CreateInboundHookResponse>(payload)

        assertEquals(7L, dto.id)
        assertEquals("hmac-secret-value", dto.secret)
        assertEquals("https://artel.example.com/api/integrations/inbound/7", dto.url)
    }

    @Test
    fun `CreateWebhookRequest without secret omits secret field`() {
        val encoded = json.encodeToString(
            CreateWebhookRequest.serializer(),
            CreateWebhookRequest(
                name = "Посты",
                url = "https://example.com/hook",
                events = listOf("post_published"),
            ),
        )

        assertFalse("опциональный secret=null не должен уходить в JSON", encoded.contains("\"secret\""))
        assertTrue(encoded.contains("\"url\":\"https://example.com/hook\""))
        assertTrue(encoded.contains("\"post_published\""))
    }

    @Test
    fun `CreateWebhookRequest with secret and empty events encodes both`() {
        val encoded = json.encodeToString(
            CreateWebhookRequest.serializer(),
            CreateWebhookRequest(
                name = "Посты",
                url = "https://example.com/hook",
                secret = "s3cr3t",
                events = emptyList(),
            ),
        )

        assertTrue(encoded.contains("\"secret\":\"s3cr3t\""))
        // events=[] совпадает с дефолтом — с encodeDefaults=false поле не уходит.
        assertFalse(encoded.contains("\"events\""))
    }

    @Test
    fun `CreateInboundHookRequest encodes name and target`() {
        val encoded = json.encodeToString(
            CreateInboundHookRequest.serializer(),
            CreateInboundHookRequest(name = "Триггер", target = "notification"),
        )

        assertEquals("""{"name":"Триггер","target":"notification"}""", encoded)
    }
}
