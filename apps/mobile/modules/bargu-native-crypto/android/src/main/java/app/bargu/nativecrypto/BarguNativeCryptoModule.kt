package app.bargu.nativecrypto

import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import com.google.crypto.tink.subtle.X25519
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.GeneralSecurityException

/**
 * Curve operations of the Bargu protocol on Google Tink (docs/ADR/0007). Synchronous: each call
 * takes microseconds, and @bargu/crypto self-tests the module against its reference before use.
 */
class BarguNativeCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BarguNativeCrypto")

    Function("ed25519Sign") { secretKey: ByteArray, message: ByteArray ->
      Ed25519Sign(secretKey).sign(message)
    }

    Function("ed25519Verify") { publicKey: ByteArray, message: ByteArray, signature: ByteArray ->
      try {
        Ed25519Verify(publicKey).verify(signature, message)
        true
      } catch (error: GeneralSecurityException) {
        false
      } catch (error: IllegalArgumentException) {
        false
      }
    }

    Function("x25519PublicKey") { secretKey: ByteArray ->
      X25519.publicFromPrivate(secretKey)
    }

    Function("x25519SharedSecret") { secretKey: ByteArray, publicKey: ByteArray ->
      X25519.computeSharedSecret(secretKey, publicKey)
    }
  }
}
