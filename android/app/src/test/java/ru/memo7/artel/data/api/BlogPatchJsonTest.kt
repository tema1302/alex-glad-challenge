package ru.memo7.artel.data.api

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BlogPatchJsonTest {

    @Test
    fun `status patch содержит только status`() {
        val json = blogStatusPatchJson("archived")
        assertEquals(setOf("status"), json.keys)
        assertEquals("archived", json["status"]?.jsonPrimitive?.content)
    }

    @Test
    fun `general patch отправляет только изменённые поля`() {
        val json = blogGeneralPatchJson(
            name = "Новое имя",
            stylePreset = "antonov",
        )
        assertEquals(setOf("name", "stylePreset"), json.keys)
    }

    @Test
    fun `profileChanged с null отправляет явный JsonNull`() {
        val json = blogGeneralPatchJson(profile = null, profileChanged = true)
        assertEquals(setOf("profile"), json.keys)
        assertTrue(json["profile"] is JsonNull)
    }

    @Test
    fun `profile без changed не отправляется`() {
        val json = blogGeneralPatchJson(profile = null, profileChanged = false)
        assertTrue(json.isEmpty())
    }

    @Test
    fun `sources сериализуются массивом, пустой массив сохраняется`() {
        val json = blogGeneralPatchJson(sources = listOf("https://a.ru/rss"))
        assertEquals(1, json["sources"]?.jsonArray?.size)
        val empty = blogGeneralPatchJson(sources = emptyList())
        assertEquals(0, empty["sources"]?.jsonArray?.size)
    }

    @Test
    fun `agent prompt null уходит как JsonNull, текст как строка`() {
        val reset = blogAgentPromptJson("factcheck.verdict", null)
        assertTrue(reset["prompt"] is JsonNull)
        val saved = blogAgentPromptJson("factcheck.verdict", "строгий")
        assertEquals("строгий", saved["prompt"]?.jsonPrimitive?.content)
        assertEquals("factcheck.verdict", saved["agent"]?.jsonPrimitive?.content)
        assertFalse(saved.isEmpty())
    }

    @Test
    fun `contextPrompt пустая строка отправляется как сброс`() {
        val json = blogGeneralPatchJson(contextPrompt = "")
        assertEquals("", json["contextPrompt"]?.jsonPrimitive?.content)
        assertEquals(JsonPrimitive(""), json["contextPrompt"])
    }
}
