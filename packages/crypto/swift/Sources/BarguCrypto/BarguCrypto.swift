#if canImport(CryptoKit)
  import CryptoKit
#else
  import Crypto
#endif
import Foundation

/// Errors mirror the TypeScript `BarguCryptoError` codes that the extension can hit.
public enum BarguCryptoError: Error, Equatable {
  case malformed
  case invalidKey
  case badSignature
  case decryptFailed
}

/// Wire format of an encrypted message (TypeScript: `MessageEnvelope`).
public struct MessageEnvelope: Codable, Equatable, Sendable {
  public let v: Int
  public let circleId: String
  public let epoch: UInt32
  public let senderDeviceId: String
  public let seq: UInt32
  public let salt: String
  public let ct: String
  public let sig: String
}

/// Wire format of a wrapped sender key (TypeScript: `SenderKeyDistribution`).
public struct SenderKeyDistribution: Codable, Equatable, Sendable {
  public let v: Int
  public let circleId: String
  public let epoch: UInt32
  public let senderDeviceId: String
  public let recipientDeviceId: String
  public let ephemeralKey: String
  public let ct: String
  public let sig: String
}

/// Bargu protocol v1, decrypting side. Every construction matches packages/crypto byte for byte
/// (verified against packages/crypto/fixtures/protocol-v1.json).
public enum BarguProtocol {
  static let version: UInt8 = 1
  static let tagBytes = 16
  static let paddingBlock = 128
  static let safetyNumberIterations = 5200

  enum Label {
    static let dhKeySignature = "bargu/v1/dh-key"
    static let senderKeyDistributionKdf = "bargu/v1/skd"
    static let senderKeyDistributionSignature = "bargu/v1/skd-sig"
    static let messageKdf = "bargu/v1/msg"
    static let messageSignature = "bargu/v1/msg-sig"
    static let pushKdf = "bargu/v1/push"
    static let safetyNumber = "bargu/v1/safety"

    /// UTF-8 followed by a 0x00 terminator.
    static func bytes(_ label: String) -> Data { Data(label.utf8) + Data([0]) }
  }

  // MARK: - Sealed push payload

  /// Opens `version(1) ‖ ephemeralKey(32) ‖ ciphertext ‖ tag` addressed to this device.
  public static func openSealed(_ sealed: String, recipientDhSecretKey: Data) throws -> Data {
    let bytes = try Encoding.base64url(sealed)
    guard bytes.count >= 1 + 32 + tagBytes, bytes.first == version else {
      throw BarguCryptoError.malformed
    }
    let header = bytes.prefix(33)
    let ephemeralKey = bytes.subdata(in: 1..<33)
    let recipient = try dhPrivateKey(recipientDhSecretKey)
    let shared = try sharedSecret(recipient, ephemeralKey)
    let (key, nonce) = try deriveKeyAndNonce(
      ikm: shared,
      salt: ephemeralKey + recipient.publicKey.rawRepresentation,
      label: Label.pushKdf,
      context: Data()
    )
    return try unpad(open(key: key, nonce: nonce, ciphertext: bytes.dropFirst(33), aad: header))
  }

  // MARK: - Messages

  /// Verifies the sender's signature, then decrypts. Returns the payload JSON bytes.
  /// The caller enforces replay protection and checks the sender key's circle / epoch.
  public static func verifyAndDecrypt(
    envelope: MessageEnvelope,
    senderKey: Data,
    senderIdentityKey: Data
  ) throws -> Data {
    guard envelope.v == Int(version) else { throw BarguCryptoError.malformed }
    let salt = try Encoding.base64url(envelope.salt, length: 16)
    let ct = try Encoding.base64url(envelope.ct)
    let sig = try Encoding.base64url(envelope.sig, length: 64)
    let header =
      Data([version]) + (try Encoding.uuidBytes(envelope.circleId)) + Encoding.u32be(envelope.epoch)
      + (try Encoding.uuidBytes(envelope.senderDeviceId)) + Encoding.u32be(envelope.seq) + salt
    try verify(Label.messageSignature, header + ct, sig, senderIdentityKey)
    let (key, nonce) = try deriveKeyAndNonce(
      ikm: senderKey, salt: salt, label: Label.messageKdf, context: header)
    return try unpad(open(key: key, nonce: nonce, ciphertext: ct, aad: header))
  }

  // MARK: - Sender key distribution

  /// Verifies and unwraps a sender key addressed to this device. Returns the 32-byte key.
  public static func openSenderKeyDistribution(
    _ distribution: SenderKeyDistribution,
    recipientDhSecretKey: Data,
    senderIdentityKey: Data
  ) throws -> Data {
    guard distribution.v == Int(version) else { throw BarguCryptoError.malformed }
    let ephemeralKey = try Encoding.base64url(distribution.ephemeralKey, length: 32)
    let ct = try Encoding.base64url(distribution.ct, length: 32 + tagBytes)
    let sig = try Encoding.base64url(distribution.sig, length: 64)
    let header =
      Data([version]) + (try Encoding.uuidBytes(distribution.circleId))
      + Encoding.u32be(distribution.epoch) + (try Encoding.uuidBytes(distribution.senderDeviceId))
      + (try Encoding.uuidBytes(distribution.recipientDeviceId)) + ephemeralKey
    try verify(Label.senderKeyDistributionSignature, header + ct, sig, senderIdentityKey)
    let recipient = try dhPrivateKey(recipientDhSecretKey)
    let shared = try sharedSecret(recipient, ephemeralKey)
    let (key, nonce) = try deriveKeyAndNonce(
      ikm: shared,
      salt: ephemeralKey + recipient.publicKey.rawRepresentation,
      label: Label.senderKeyDistributionKdf,
      context: header
    )
    return try open(key: key, nonce: nonce, ciphertext: ct, aad: header)
  }

  // MARK: - Device keys

  /// True when `dhKey` is signed by `identityKey` for `deviceId`.
  public static func isDhKeySigned(
    deviceId: String, dhKey: Data, signature: Data, identityKey: Data
  ) throws -> Bool {
    do {
      try verify(
        Label.dhKeySignature, try Encoding.uuidBytes(deviceId) + dhKey, signature, identityKey)
      return true
    } catch BarguCryptoError.badSignature {
      return false
    }
  }

  // MARK: - Safety number

  /// 60 digits and the QR payload; identical to the TypeScript `safetyNumber`.
  public static func safetyNumber(
    userA: String, identityKeyA: Data, userB: String, identityKeyB: Data
  ) throws -> (digits: String, qr: String) {
    let parts = try [(userA, identityKeyA), (userB, identityKeyB)]
      .map { user, key -> (fp: Data, hex: String, digits: String) in
        let fp = try fingerprint(userId: user, identityKey: key)
        return (fp, fp.map { String(format: "%02x", $0) }.joined(), digits(fp))
      }
      .sorted { $0.hex < $1.hex }
    return (parts[0].digits + parts[1].digits, "bargu-sn:1:" + Encoding.base64urlEncode(parts[0].fp + parts[1].fp))
  }

  static func fingerprint(userId: String, identityKey: Data) throws -> Data {
    guard identityKey.count == 32 else { throw BarguCryptoError.invalidKey }
    var hash = Data(
      SHA256.hash(data: Label.bytes(Label.safetyNumber) + (try Encoding.uuidBytes(userId)) + identityKey))
    for _ in 0..<safetyNumberIterations {
      hash = Data(SHA256.hash(data: hash + identityKey))
    }
    return hash.prefix(30)
  }

  static func digits(_ fp: Data) -> String {
    stride(from: 0, to: 30, by: 5).map { offset -> String in
      let value = fp.subdata(in: offset..<offset + 5).reduce(UInt64(0)) { $0 * 256 + UInt64($1) }
      let chunk = String(value % 100_000)
      return String(repeating: "0", count: 5 - chunk.count) + chunk
    }.joined()
  }

  // MARK: - Primitives (CryptoKit only)

  static func deriveKeyAndNonce(ikm: Data, salt: Data, label: String, context: Data) throws -> (
    SymmetricKey, ChaChaPoly.Nonce
  ) {
    let okm = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: ikm),
      salt: salt,
      info: Label.bytes(label) + context,
      outputByteCount: 44
    ).withUnsafeBytes { Data($0) }
    return (SymmetricKey(data: okm.prefix(32)), try ChaChaPoly.Nonce(data: okm.suffix(12)))
  }

  static func open(key: SymmetricKey, nonce: ChaChaPoly.Nonce, ciphertext: Data, aad: Data) throws
    -> Data
  {
    guard ciphertext.count >= tagBytes else { throw BarguCryptoError.malformed }
    do {
      let box = try ChaChaPoly.SealedBox(
        nonce: nonce, ciphertext: ciphertext.dropLast(tagBytes), tag: ciphertext.suffix(tagBytes))
      return try ChaChaPoly.open(box, using: key, authenticating: aad)
    } catch {
      throw BarguCryptoError.decryptFailed
    }
  }

  static func verify(_ label: String, _ message: Data, _ signature: Data, _ identityKey: Data) throws {
    guard let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: identityKey) else {
      throw BarguCryptoError.invalidKey
    }
    guard publicKey.isValidSignature(signature, for: Label.bytes(label) + message) else {
      throw BarguCryptoError.badSignature
    }
  }

  static func dhPrivateKey(_ secret: Data) throws -> Curve25519.KeyAgreement.PrivateKey {
    guard let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secret) else {
      throw BarguCryptoError.invalidKey
    }
    return key
  }

  static func sharedSecret(_ privateKey: Curve25519.KeyAgreement.PrivateKey, _ peer: Data) throws
    -> Data
  {
    guard let peerKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: peer),
      let shared = try? privateKey.sharedSecretFromKeyAgreement(with: peerKey)
    else { throw BarguCryptoError.invalidKey }
    let bytes = shared.withUnsafeBytes { Data($0) }
    // Reject the all-zero output of low-order points, as the TypeScript side does.
    guard bytes.contains(where: { $0 != 0 }) else { throw BarguCryptoError.invalidKey }
    return bytes
  }

  static func unpad(_ padded: Data) throws -> Data {
    guard !padded.isEmpty, padded.count % paddingBlock == 0,
      let marker = padded.lastIndex(where: { $0 != 0 }), padded[marker] == 0x80
    else { throw BarguCryptoError.decryptFailed }
    return padded.prefix(upTo: marker)
  }
}

enum Encoding {
  static func base64url(_ text: String, length: Int? = nil) throws -> Data {
    guard text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { throw BarguCryptoError.malformed }
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let data = Data(base64Encoded: base64), base64urlEncode(data) == text else {
      throw BarguCryptoError.malformed
    }
    if let length, data.count != length { throw BarguCryptoError.malformed }
    return data
  }

  static func base64urlEncode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func uuidBytes(_ uuid: String) throws -> Data {
    let hex = uuid.replacingOccurrences(of: "-", with: "")
    guard uuid.count == 36, hex.count == 32, hex == hex.lowercased() else {
      throw BarguCryptoError.malformed
    }
    var bytes = Data(capacity: 16)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { throw BarguCryptoError.malformed }
      bytes.append(byte)
      index = next
    }
    return bytes
  }

  static func u32be(_ value: UInt32) -> Data {
    withUnsafeBytes(of: value.bigEndian) { Data($0) }
  }
}
