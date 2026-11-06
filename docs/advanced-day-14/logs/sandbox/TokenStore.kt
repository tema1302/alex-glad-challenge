package ru.memo7.artel.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Хранилище auth-токена.
 *
 * Токен НЕ хранится в открытом виде: значение шифруется AES/GCM ключом,
 * который живёт в Android Keystore (аппаратно-защищённый, если доступен).
 * В DataStore попадает только base64(iv || ciphertext).
 *
 * Не логировать токен и не передавать наружу.
 */
class TokenStore(private val context: Context) {

    private val dataStore: DataStore<Preferences> = context.tokenStoreDataStore

    private object Keys {
        val token = stringPreferencesKey("auth_token_enc")
    }

    suspend fun saveToken(token: String) {
        val normalized = token.trim()
        require(normalized.isNotEmpty()) { "Token must not be blank" }
        val encrypted = encrypt(normalized)
        dataStore.edit { prefs ->
            prefs[Keys.token] = encrypted
        }
    }

    suspend fun loadToken(): String? {
        val prefs = dataStore.data.first()
        val stored = prefs[Keys.token]?.takeIf { it.isNotBlank() } ?: return null
        return runCatching { decrypt(stored) }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
    }

    suspend fun clearToken() {
        dataStore.edit { prefs ->
            prefs.remove(Keys.token)
        }
    }

    // --- Keystore-backed AES/GCM ---

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > IV_SIZE) { "Corrupted token payload" }
        val iv = combined.copyOfRange(0, IV_SIZE)
        val ciphertext = combined.copyOfRange(IV_SIZE, combined.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "artel_auth_token_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
        const val TAG_BITS = 128
    }
}

private val Context.tokenStoreDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "artel_token_store"
)