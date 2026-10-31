package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import ru.memo7.artel.core.network.ApiFactory

/** Plain JVM unit-тест контракта MCP: GET /api/mcp/tools (три формы 200) и POST /api/mcp/call. */
class McpModelsTest {

    private val json = ApiFactory.json

    @Test
    fun `tools decode configured payload with optional fields defaulted`() {
        val payload = """
            {"configured":true,"tools":[
              {"name":"get_weather","description":"Погода по городу","inputSchema":{"type":"object"}},
              {"name":"ping"}
            ]}
        """.trimIndent()

        val response = json.decodeFromString<McpToolsResponse>(payload)

        assertTrue(response.configured)
        assertEquals(2, response.tools.size)
        assertNull(response.error)

        val full = response.tools[0]
        assertEquals("get_weather", full.name)
        assertEquals("Погода по городу", full.description)
        assertEquals("""{"type":"object"}""", full.inputSchema.toString())

        // Опциональные поля сервер может не прислать — дефолты null.
        val minimal = response.tools[1]
        assertEquals("ping", minimal.name)
        assertNull(minimal.description)
        assertNull(minimal.inputSchema)
    }

    @Test
    fun `tools decode not configured payload`() {
        val response = json.decodeFromString<McpToolsResponse>(
            """{"configured":false,"tools":[],"error":"MCP-сервер не настроен"}""",
        )

        assertFalse(response.configured)
        assertTrue(response.tools.isEmpty())
        assertEquals("MCP-сервер не настроен", response.error)
    }

    @Test
    fun `tools decode upstream failure payload`() {
        val response = json.decodeFromString<McpToolsResponse>(
            """{"configured":true,"tools":[],"error":"апстрим упал"}""",
        )

        assertTrue(response.configured)
        assertTrue(response.tools.isEmpty())
        assertEquals("апстрим упал", response.error)
    }

    @Test
    fun `call response decode ok with result`() {
        val response = json.decodeFromString<McpCallResponse>(
            """{"ok":true,"result":"В Казани -3°C"}""",
        )

        assertTrue(response.ok)
        assertEquals("В Казани -3°C", response.result)
        assertNull(response.error)
    }

    @Test
    fun `call response decode failure with defaults`() {
        val response = json.decodeFromString<McpCallResponse>(
            """{"ok":false,"error":"таймаут MCP"}""",
        )

        assertFalse(response.ok)
        assertNull(response.result)
        assertEquals("таймаут MCP", response.error)
    }

    @Test
    fun `call request encode omits null args`() {
        val encoded = json.encodeToString(McpCallRequest.serializer(), McpCallRequest(tool = "ping"))

        // explicitNulls=false: поле args не должно ломать серверную схему.
        assertEquals("""{"tool":"ping"}""", encoded)
    }

    @Test
    fun `call request encode args object`() {
        val args = JsonObject(mapOf("city" to JsonPrimitive("Казань")))
        val encoded = json.encodeToString(
            McpCallRequest.serializer(),
            McpCallRequest(tool = "get_weather", args = args),
        )

        assertEquals("""{"tool":"get_weather","args":{"city":"Казань"}}""", encoded)
    }
}
