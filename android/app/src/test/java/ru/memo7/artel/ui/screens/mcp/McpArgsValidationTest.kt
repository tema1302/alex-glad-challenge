package ru.memo7.artel.ui.screens.mcp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Локальная валидация args вызова MCP: без сети, без моков — только McpArgsValidator. */
class McpArgsValidationTest {

    @Test
    fun `blank input parses to empty object`() {
        val result = McpArgsValidator.parse("")

        assertTrue(result is McpArgsValidator.Result.Ok)
        assertEquals("{}", (result as McpArgsValidator.Result.Ok).args.toString())
    }

    @Test
    fun `whitespace input parses to empty object`() {
        val result = McpArgsValidator.parse("   \n\t ")

        assertTrue(result is McpArgsValidator.Result.Ok)
        assertEquals("{}", (result as McpArgsValidator.Result.Ok).args.toString())
    }

    @Test
    fun `empty json object parses`() {
        val result = McpArgsValidator.parse("{}")

        assertTrue(result is McpArgsValidator.Result.Ok)
        assertEquals("{}", (result as McpArgsValidator.Result.Ok).args.toString())
    }

    @Test
    fun `object with fields parses`() {
        val result = McpArgsValidator.parse("""{"a":1}""")

        assertTrue(result is McpArgsValidator.Result.Ok)
        val args = (result as McpArgsValidator.Result.Ok).args
        assertEquals("1", args["a"].toString())
    }

    @Test
    fun `array is rejected`() {
        val result = McpArgsValidator.parse("[1]")

        assertTrue(result is McpArgsValidator.Result.Invalid)
        assertTrue((result as McpArgsValidator.Result.Invalid).message.contains("Проверьте JSON"))
    }

    @Test
    fun `json string is rejected`() {
        val result = McpArgsValidator.parse("\"s\"")

        assertTrue(result is McpArgsValidator.Result.Invalid)
        assertTrue((result as McpArgsValidator.Result.Invalid).message.contains("Проверьте JSON"))
    }

    @Test
    fun `broken json is rejected`() {
        val result = McpArgsValidator.parse("{битый")

        assertTrue(result is McpArgsValidator.Result.Invalid)
        assertTrue((result as McpArgsValidator.Result.Invalid).message.contains("Проверьте JSON"))
    }
}
