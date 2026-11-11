package ru.memo7.artel.ui.screens.blog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.data.api.BlogDto

class BlogStudioLogicTest {

    private fun blog(
        id: Long,
        slug: String,
        hasProfile: Boolean,
        sources: Int,
        status: String = "active",
    ) = BlogDto(
        id = id,
        slug = slug,
        name = slug,
        hasProfile = hasProfile,
        sourcesCount = sources,
        status = status,
    )

    @Test
    fun `slugifyRu транслитерирует и чистит`() {
        assertEquals("nevskiy-hram-na-dovatortsev", slugifyRu("Невский храм на Доваторцев"))
        assertEquals("privet-mir", slugifyRu("  Привет, мир!  "))
        assertEquals("", slugifyRu("!!!"))
    }

    @Test
    fun `newsReady требует профиль и источники`() {
        assertTrue(newsReady(true, 1))
        assertFalse(newsReady(true, 0))
        assertFalse(newsReady(false, 3))
        assertFalse(newsReady(false, 0))
    }

    @Test
    fun `hub summary игнорирует архив`() {
        val summary = blogHubSummary(
            listOf(
                blog(1, "ready", hasProfile = true, sources = 2),
                blog(2, "half", hasProfile = true, sources = 0),
                blog(3, "archived", hasProfile = true, sources = 2, status = "archived"),
            ),
        )
        assertEquals(2, summary.total)
        assertEquals(1, summary.ready)
        assertEquals(1, summary.attention)
    }

    @Test
    fun `readinessHint объясняет чего не хватает`() {
        assertEquals("Нет профиля и RSS", readinessHint(blog(1, "a", false, 0)))
        assertEquals("Нет профиля голоса", readinessHint(blog(2, "b", false, 2)))
        assertEquals("Нет RSS-источников", readinessHint(blog(3, "c", true, 0)))
        assertEquals("Готов к news", readinessHint(blog(4, "d", true, 1)))
    }
}
