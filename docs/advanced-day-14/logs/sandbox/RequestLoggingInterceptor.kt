package ru.memo7.artel.core.network

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit

/**
 * Логирующий interceptor для OkHttp.
 *
 * Безопасность:
 * - BODY-логирование (тела запросов/ответов) может содержать PII и секреты,
 *   поэтому оно НЕ включается по умолчанию даже в debug.
 * - По умолчанию используется Level.BASIC (метод, URL, код, размер) — без тел.
 * - BODY доступен только при явном opt-in: debug-сборка (BuildConfig.DEBUG)
 *   И отдельный флаг, который выставляет разработчик вручную.
 * - Чувствительные заголовки маскируются через redactHeader.
 * - В release логирование полностью отключено (Level.NONE).
 */
internal object RequestLoggingInterceptor {

    private const val TAG = "HttpLog"

    /**
     * @param isDebug значение BuildConfig.DEBUG.
     * @param allowBodyLogging явный opt-in на BODY-логирование (только для debug).
     *        Должен быть false в release; при isDebug == false игнорируется.
     */
    fun create(
        isDebug: Boolean,
        allowBodyLogging: Boolean = false
    ): HttpLoggingInterceptor {
        val level = when {
            !isDebug -> HttpLoggingInterceptor.Level.NONE
            allowBodyLogging -> HttpLoggingInterceptor.Level.BODY
            else -> HttpLoggingInterceptor.Level.BASIC
        }

        return HttpLoggingInterceptor { message ->
            if (isDebug) {
                Log.d(TAG, message)
            }
        }.apply {
            this.level = level
            // Маскируем чувствительные заголовки, чтобы токены не утекали в Logcat.
            redactHeader("Authorization")
            redactHeader("Cookie")
            redactHeader("Set-Cookie")
            redactHeader("Proxy-Authorization")
        }
    }
}

private class AuthInterceptor(private val token: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(request)
    }
}

object ApiFactory {

    /**
     * @param isDebug BuildConfig.DEBUG.
     * @param allowBodyLogging явный opt-in на BODY-логирование (только debug).
     */
    fun create(
        credentials: Credentials,
        isDebug: Boolean,
        allowBodyLogging: Boolean = false
    ): ArtelApi {
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(credentials.token.trim()))
            .addInterceptor(
                RequestLoggingInterceptor.create(
                    isDebug = isDebug,
                    allowBodyLogging = allowBodyLogging
                )
            )
            .build()
        return Retrofit.Builder()
            .baseUrl(credentials.toRetrofitBaseUrl())
            .client(client)
            .build()
            .create(ArtelApi::class.java)
    }
}