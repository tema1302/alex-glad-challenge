package ru.memo7.artel.core.network

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Клиент для GET /api/tasks.
 *
 * Замечания по безопасности:
 * - Base URL передаётся извне (BuildConfig / secure storage). В исходнике
 *   нет захардкоженных HTTP-адресов. Для debug-сборки адрес эмулятора
 *   задаётся в debug-only source set (BuildConfig) и разрешается через
 *   network_security_config (cleartext только для 10.0.2.2 в debug).
 * - В release http:// запрещён на уровне [normalizeBaseUrl].
 * - Токен не хардкодится: передаётся извне (CredentialsStore / secure storage).
 * - PII и токены не логируются.
 * - Certificate pinning намеренно не настроен (по требованию задачи для проверки).
 */
class TaskApiClient(
    baseUrl: String,
    private val tokenProvider: () -> String?,
    private val allowInsecureHttp: Boolean = BuildConfig.DEBUG
) {
    private val baseUrl: String = normalizeBaseUrl(baseUrl, allowInsecureHttp)

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    /**
     * Загружает список задач и возвращает их заголовки (List<String>).
     *
     * Ожидаемый формат ответа: JSON-массив объектов с полем "title"
     * либо JSON-массив строк. При неожиданном формате бросает IOException.
     */
    @Throws(IOException::class)
    fun fetchTasks(): List<String> {
        val url = baseUrl + "tasks"

        val requestBuilder = Request.Builder()
            .url(url)
            .get()

        tokenProvider()?.takeIf { it.isNotBlank() }?.let { token ->
            requestBuilder.header("Authorization", "Bearer ${token.trim()}")
        }

        client.newCall(requestBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("GET $url failed: HTTP ${response.code}")
            }
            val body = response.body?.string()
                ?: throw IOException("GET $url returned empty body")
            return parseTasks(body)
        }
    }

    private fun parseTasks(body: String): List<String> {
        val trimmed = body.trim()
        if (trimmed.isEmpty()) return emptyList()

        return try {
            when (val root = parseJson(trimmed)) {
                is JSONArray -> extractFromArray(root)
                is JSONObject -> {
                    val arr = root.optJSONArray("tasks")
                        ?: root.optJSONArray("data")
                        ?: root.optJSONArray("items")
                        ?: throw IOException("Unexpected JSON object shape")
                    extractFromArray(arr)
                }
                else -> throw IOException("Unexpected JSON root type")
            }
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            throw IOException("Failed to parse tasks response", e)
        }
    }

    private fun extractFromArray(array: JSONArray): List<String> {
        val result = ArrayList<String>(array.length())
        for (i in 0 until array.length()) {
            when (val item = array.opt(i)) {
                is String -> result.add(item)
                is JSONObject -> {
                    val title = item.optString("title").ifBlank {
                        item.optString("name").ifBlank {
                            item.optString("id")
                        }
                    }
                    if (title.isNotBlank()) result.add(title)
                }
                null -> Unit
                else -> result.add(item.toString())
            }
        }
        return result
    }

    private fun parseJson(text: String): Any {
        val first = text.firstOrNull()
        return when (first) {
            '[' -> JSONArray(text)
            '{' -> JSONObject(text)
            else -> throw IOException("Response is not JSON")
        }
    }

    companion object {
        /**
         * Нормализует base URL.
         *
         * Требования безопасности:
         * - Схема обязательна и должна быть явно указана.
         * - https:// разрешён всегда.
         * - http:// разрешён только если [allowInsecureHttp] == true (debug).
         * - Отсутствие схемы или иная схема — ошибка.
         */
        fun normalizeBaseUrl(baseUrl: String, allowInsecureHttp: Boolean = BuildConfig.DEBUG): String {
            val trimmed = baseUrl.trim()
            if (trimmed.isEmpty()) {
                throw IllegalArgumentException("Base URL must not be empty")
            }

            val isHttps = trimmed.startsWith("https://", ignoreCase = true)
            val isHttp = trimmed.startsWith("http://", ignoreCase = true)

            if (!isHttps && !isHttp) {
                throw IllegalArgumentException(
                    "Base URL must explicitly specify https:// scheme"
                )
            }
            if (isHttp && !allowInsecureHttp) {
                throw IllegalArgumentException(
                    "Insecure http:// base URL is not allowed outside debug builds"
                )
            }

            return trimmed.trimEnd('/') + "/"
        }
    }
}