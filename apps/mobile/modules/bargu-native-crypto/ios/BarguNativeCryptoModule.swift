import CryptoKit
import ExpoModulesCore

/// Curve operations of the Bargu protocol on Apple CryptoKit (docs/ADR/0007). Synchronous: each call
/// takes microseconds, and @bargu/crypto self-tests the module against its reference before use.
public class BarguNativeCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BarguNativeCrypto")

    Function("ed25519Sign") { (secretKey: Data, message: Data) throws -> Data in
      let key = try Curve25519.Signing.PrivateKey(rawRepresentation: secretKey)
      return try key.signature(for: message)
    }

    Function("ed25519Verify") { (publicKey: Data, message: Data, signature: Data) -> Bool in
      guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else {
        return false
      }
      return key.isValidSignature(signature, for: message)
    }

    Function("x25519PublicKey") { (secretKey: Data) throws -> Data in
      let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretKey)
      return key.publicKey.rawRepresentation
    }

    Function("x25519SharedSecret") { (secretKey: Data, publicKey: Data) throws -> Data in
      let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretKey)
      let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey)
      let shared = try key.sharedSecretFromKeyAgreement(with: peer)
      return shared.withUnsafeBytes { Data($0) }
    }
  }
}
