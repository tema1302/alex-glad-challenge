// Чистая логика blog-экранов: slug, готовность к news, сводка хаба.
// Вынесено из Compose, чтобы покрыть JUnit-тестами без Android runtime.
package ru.memo7.artel.ui.screens.blog

import ru.memo7.artel.data.api.BlogDto

/** Число редактируемых блог-агентов (синхронно с core blogAgentPrompts.ts). */
internal const val BLOG_AGENT_COUNT = 7

private val TRANSLIT = mapOf(
    'а' to "a", 'б' to "b", 'в' to "v", 'г' to "g", 'д' to "d", 'е' to "e", 'ё' to "e",
    'ж' to "zh", 'з' to "z", 'и' to "i", 'й' to "y", 'к' to "k", 'л' to "l", 'м' to "m",
    'н' to "n", 'о' to "o", 'п' to "p", 'р' to "r", 'с' to "s", 'т' to "t", 'у' to "u",
    'ф' to "f", 'х' to "h", 'ц' to "ts", 'ч' to "ch", 'ш' to "sh", 'щ' to "sch",
    'ъ' to "", 'ы' to "y", 'ь' to "", 'э' to "e", 'ю' to "yu", 'я' to "ya",
)

internal fun slugifyRu(value: String): String =
    value.lowercase()
        .flatMap { ch -> TRANSLIT[ch]?.map { it } ?: listOf(ch) }
        .joinToString("")
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .take(64)

internal fun newsReady(hasProfile: Boolean, sourcesCount: Int): Boolean =
    hasProfile && sourcesCount > 0

internal data class BlogHubSummary(
    val total: Int,
    val ready: Int,
    val attention: Int,
)

internal fun blogHubSummary(blogs: List<BlogDto>): BlogHubSummary {
    val active = blogs.filter { it.status != "archived" }
    val ready = active.count { newsReady(it.hasProfile, it.sourcesCount) }
    return BlogHubSummary(total = active.size, ready = ready, attention = active.size - ready)
}

internal fun readinessHint(blog: BlogDto): String = when {
    !blog.hasProfile && blog.sourcesCount == 0 -> "Нет профиля и RSS"
    !blog.hasProfile -> "Нет профиля голоса"
    blog.sourcesCount == 0 -> "Нет RSS-источников"
    else -> "Готов к news"
}
