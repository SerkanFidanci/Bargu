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
  /// A push from a device the app does not know (TypeScript: `KEY_MISMATCH`).
  case keyMismatch
}

/// Wire format of an encrypted message (TypeScript: `MessageEnvelope`). Decoding is strict like
/// the TypeScript schema: unknown fields are rejected.
public struct MessageEnvelope: Codable, Equatable, Sendable {
  public let v: Int
  public let circleId: String
  public let epoch: UInt32
  public let senderDeviceId: String
  public let seq: UInt32
  public let salt: String
  public let ct: String
  public let sig: String

  enum CodingKeys: String, CodingKey, CaseIterable {
    case v, circleId, epoch, senderDeviceId, seq, salt, ct, sig
  }

  public init(
    v: Int, circleId: String, epoch: UInt32, senderDeviceId: String, seq: UInt32, salt: String,
    ct: String, sig: String
  ) {
    self.v = v
    self.circleId = circleId
    self.epoch = epoch
    self.senderDeviceId = senderDeviceId
    self.seq = seq
    self.salt = salt
    self.ct = ct
    self.sig = sig
  }

  public init(from decoder: Decoder) throws {
    try Strict.rejectUnknownKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue))
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      v: try c.decode(Int.self, forKey: .v),
      circleId: try c.decode(String.self, forKey: .circleId),
      epoch: try c.decode(UInt32.self, forKey: .epoch),
      senderDeviceId: try c.decode(String.self, forKey: .senderDeviceId),
      seq: try c.decode(UInt32.self, forKey: .seq),
      salt: try c.decode(String.self, forKey: .salt),
      ct: try c.decode(String.self, forKey: .ct),
      sig: try c.decode(String.self, forKey: .sig))
  }
}

/// Wire format of a wrapped sender key (TypeScript: `SenderKeyDistribution`). Strict decoding.
public struct SenderKeyDistribution: Codable, Equatable, Sendable {
  public let v: Int
  public let circleId: String
  public let epoch: UInt32
  public let senderDeviceId: String
  public let recipientDeviceId: String
  public let ephemeralKey: String
  public let ct: String
  public let sig: String

  enum CodingKeys: String, CodingKey, CaseIterable {
    case v, circleId, epoch, senderDeviceId, recipientDeviceId, ephemeralKey, ct, sig
  }

  public init(
    v: Int, circleId: String, epoch: UInt32, senderDeviceId: String, recipientDeviceId: String,
    ephemeralKey: String, ct: String, sig: String
  ) {
    self.v = v
    self.circleId = circleId
    self.epoch = epoch
    self.senderDeviceId = senderDeviceId
    self.recipientDeviceId = recipientDeviceId
    self.ephemeralKey = ephemeralKey
    self.ct = ct
    self.sig = sig
  }

  public init(from decoder: Decoder) throws {
    try Strict.rejectUnknownKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue))
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      v: try c.decode(Int.self, forKey: .v),
      circleId: try c.decode(String.self, forKey: .circleId),
      epoch: try c.decode(UInt32.self, forKey: .epoch),
      senderDeviceId: try c.decode(String.self, forKey: .senderDeviceId),
      recipientDeviceId: try c.decode(String.self, forKey: .recipientDeviceId),
      ephemeralKey: try c.decode(String.self, forKey: .ephemeralKey),
      ct: try c.decode(String.self, forKey: .ct),
      sig: try c.decode(String.self, forKey: .sig))
  }
}

/// What a notification says (TypeScript: `PushBody`, packages/schemas/src/push.ts), decoded as
/// strictly as the zod schema: per kind exactly its fields, ids and texts checked.
public struct PushBody: Decodable, Equatable, Sendable {
  public enum Kind: String, Sendable { case place, bump, notice, late, meeting }
  public static let notices: Set<String> = [
    "friendRequest", "friendAccepted", "friendAdded", "circleInvite", "memberJoined",
    "guardianRequest", "guardianLinked", "guardianEndRequested", "guardianEnded",
    "guardianApproval", "guardianApproved", "guardianDeclined", "guardianSettings",
    "guardianNewMember", "guardianPurchase", "guardianCosmetic",
  ]

  public let kind: Kind
  public let circleId: String
  public let ts: UInt64
  /// `place` only.
  public let placeId: String?
  public let event: String?
  public let name: String?
  public let emoji: String?
  /// `notice` only.
  public let notice: String?
  /// `late` only: about how many minutes (docs/ADR/0018).
  public let minutes: Int?
  /// `meeting` only: when it is (Unix ms, docs/ADR/0026); `name` and `emoji` say where.
  public let meetAt: UInt64?

  enum CodingKeys: String, CodingKey, CaseIterable {
    case kind, circleId, ts, placeId, event, name, emoji, notice, minutes, meetAt
  }

  static func fields(_ kind: Kind) -> Set<String> {
    switch kind {
    case .place: return ["kind", "circleId", "placeId", "event", "name", "emoji", "ts"]
    case .bump: return ["kind", "circleId", "ts"]
    case .notice: return ["kind", "notice", "circleId", "ts"]
    case .late: return ["kind", "circleId", "minutes", "ts"]
    case .meeting: return ["kind", "circleId", "name", "emoji", "meetAt", "ts"]
    }
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    guard let kind = Kind(rawValue: try c.decode(String.self, forKey: .kind)) else {
      throw BarguCryptoError.malformed
    }
    let keys = try decoder.container(keyedBy: Strict.AnyKey.self).allKeys.map(\.stringValue)
    guard Set(keys) == Self.fields(kind), keys.count == Self.fields(kind).count else {
      throw BarguCryptoError.malformed
    }
    self.kind = kind
    circleId = try c.decode(String.self, forKey: .circleId)
    _ = try Encoding.uuidBytes(circleId)
    ts = try c.decode(UInt64.self, forKey: .ts)
    guard ts <= 9_007_199_254_740_991 else { throw BarguCryptoError.malformed }
    placeId = try c.decodeIfPresent(String.self, forKey: .placeId)
    event = try c.decodeIfPresent(String.self, forKey: .event)
    name = try c.decodeIfPresent(String.self, forKey: .name)
    emoji = try c.decodeIfPresent(String.self, forKey: .emoji)
    notice = try c.decodeIfPresent(String.self, forKey: .notice)
    minutes = try c.decodeIfPresent(Int.self, forKey: .minutes)
    meetAt = try c.decodeIfPresent(UInt64.self, forKey: .meetAt)
    switch kind {
    case .place:
      _ = try Encoding.uuidBytes(placeId ?? "")
      guard event == "enter" || event == "exit", Strict.isDisplayText(name, max: 40),
        Strict.isDisplayText(emoji, max: 16)
      else { throw BarguCryptoError.malformed }
    case .notice:
      guard let notice, Self.notices.contains(notice) else { throw BarguCryptoError.malformed }
    case .late:
      guard let minutes, (1...600).contains(minutes) else { throw BarguCryptoError.malformed }
    case .meeting:
      guard Strict.isDisplayText(name, max: 40), Strict.isDisplayText(emoji, max: 16),
        let meetAt, meetAt <= 9_007_199_254_740_991
      else { throw BarguCryptoError.malformed }
    case .bump:
      break
    }
  }
}

/// A push opened on this device: who signed it (nil: the server's notice) and what it says.
public struct OpenedPush: Equatable, Sendable {
  public let senderDeviceId: String?
  public let body: PushBody
}

enum Strict {
  struct AnyKey: CodingKey {
    let stringValue: String
    init?(stringValue: String) { self.stringValue = stringValue }
    var intValue: Int? { nil }
    init?(intValue: Int) { nil }
  }

  /// The TypeScript schemas are `.strict()`; JSONDecoder would silently drop extra fields.
  static func rejectUnknownKeys(_ decoder: Decoder, allowed: [String]) throws {
    let keys = try decoder.container(keyedBy: AnyKey.self).allKeys.map(\.stringValue)
    guard keys.allSatisfy(allowed.contains) else { throw BarguCryptoError.malformed }
  }

  /// TypeScript `displayText`: 1…max UTF-16 units (zod counts those), no control characters and no
  /// bidi overrides or isolates (Swift strings cannot hold lone surrogates).
  static func isDisplayText(_ text: String?, max: Int) -> Bool {
    guard let text, !text.isEmpty, text.utf16.count <= max else { return false }
    return !text.unicodeScalars.contains { scalar in
      scalar.properties.generalCategory == .control || (0x202A...0x202E).contains(scalar.value)
        || (0x2066...0x2069).contains(scalar.value)
    }
  }
}

/// Bargu protocol v1, decrypting side. Every construction matches packages/crypto byte for byte
/// (verified against packages/crypto/fixtures/protocol-v1.json).
public enum BarguProtocol {
  static let version: UInt8 = 1
  static let tagBytes = 16
  /// Message plaintexts are padded to exactly this size (TypeScript: `MESSAGE_PADDED_BYTES`).
  static let messagePaddedBytes = 512
  static let pushPaddingBlock = 128
  static let safetyNumberIterations = 5200

  enum Label {
    static let dhKeySignature = "bargu/v1/dh-key"
    static let senderKeyDistributionKdf = "bargu/v1/skd"
    static let senderKeyDistributionSignature = "bargu/v1/skd-sig"
    static let messageKdf = "bargu/v1/msg"
    static let messageSignature = "bargu/v1/msg-sig"
    static let pushKdf = "bargu/v1/push"
    static let pushSignature = "bargu/v1/push-sig"
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
    return try unpad(
      open(key: key, nonce: nonce, ciphertext: bytes.dropFirst(33), aad: header),
      block: pushPaddingBlock)
  }

  /// Opens a notification sealed for this device (docs/PROTOCOL.md §7): a member's push must be
  /// signed, for this very device, by the identity key the app trusts for the sending device
  /// (`senderIdentityKey` returns nil for unknown devices) and is never a notice; the server's
  /// pushes can only be notices. The caller checks freshness (`ts`).
  public static func openPush(
    _ sealed: String,
    recipientDeviceId: String,
    recipientDhSecretKey: Data,
    senderIdentityKey: (String) -> Data?
  ) throws -> OpenedPush {
    let inner = Data(try openSealed(sealed, recipientDhSecretKey: recipientDhSecretKey))
    let headerBytes = 1 + 16 + 64
    var senderDeviceId: String? = nil
    let json: Data
    if inner.first == 0 {
      json = inner.subdata(in: 1..<inner.count)
    } else if inner.first == 1, inner.count > headerBytes {
      let senderId = inner.subdata(in: 1..<17)
      let sender = Encoding.uuidString(senderId)
      guard let identityKey = senderIdentityKey(sender) else { throw BarguCryptoError.keyMismatch }
      json = inner.subdata(in: headerBytes..<inner.count)
      try verify(
        Label.pushSignature, (try Encoding.uuidBytes(recipientDeviceId)) + senderId + json,
        inner.subdata(in: 17..<headerBytes), identityKey)
      senderDeviceId = sender
    } else {
      throw BarguCryptoError.malformed
    }
    let body: PushBody
    do {
      body = try JSONDecoder().decode(PushBody.self, from: json)
    } catch {
      throw BarguCryptoError.malformed
    }
    guard (senderDeviceId == nil) == (body.kind == .notice) else { throw BarguCryptoError.malformed }
    return OpenedPush(senderDeviceId: senderDeviceId, body: body)
  }

  // MARK: - Messages

  /// Verifies the sender's signature, then decrypts. Returns the payload JSON bytes.
  /// The caller enforces replay protection (per circle, as the TypeScript `ReplayGuard`) and checks
  /// the sender key's circle / epoch.
  public static func verifyAndDecrypt(
    envelope: MessageEnvelope,
    senderKey: Data,
    senderIdentityKey: Data
  ) throws -> Data {
    guard envelope.v == Int(version) else { throw BarguCryptoError.malformed }
    let salt = try Encoding.base64url(envelope.salt, length: 16)
    let ct = try Encoding.base64url(envelope.ct, length: messagePaddedBytes + tagBytes)
    let sig = try Encoding.base64url(envelope.sig, length: 64)
    let header =
      Data([version]) + (try Encoding.uuidBytes(envelope.circleId)) + Encoding.u32be(envelope.epoch)
      + (try Encoding.uuidBytes(envelope.senderDeviceId)) + Encoding.u32be(envelope.seq) + salt
    try verify(Label.messageSignature, header + ct, sig, senderIdentityKey)
    let (key, nonce) = try deriveKeyAndNonce(
      ikm: senderKey, salt: salt, label: Label.messageKdf, context: header)
    return try unpad(
      open(key: key, nonce: nonce, ciphertext: ct, aad: header), block: messagePaddedBytes)
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

  /// Ed25519 verification. CryptoKit verifies cofactorless and does not reject small-order public
  /// keys, while the TypeScript side (noble, `zip215: false`) does. Only pass identity keys the app
  /// already accepted through TypeScript `verifyDeviceKeyBundle` (kept in the shared keychain).
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

  static func unpad(_ padded: Data, block: Int) throws -> Data {
    guard !padded.isEmpty, padded.count % block == 0,
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

  static let hyphenOffsets: Set<Int> = [8, 13, 18, 23]

  /// Canonical lower-case, hyphenated UUID only: exactly the TypeScript `UUID_PATTERN`.
  static func uuidBytes(_ uuid: String) throws -> Data {
    let chars = Array(uuid.utf8)
    guard chars.count == 36 else { throw BarguCryptoError.malformed }
    for (offset, char) in chars.enumerated() {
      let valid =
        hyphenOffsets.contains(offset)
        ? char == UInt8(ascii: "-")
        : (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(char)
          || (UInt8(ascii: "a")...UInt8(ascii: "f")).contains(char)
      guard valid else { throw BarguCryptoError.malformed }
    }
    let hex = uuid.replacingOccurrences(of: "-", with: "")
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

  /// 16 raw bytes as canonical lower-case UUID text (TypeScript `bytesToUuid`).
  static func uuidString(_ bytes: Data) -> String {
    let hex = Array(bytes.map { String(format: "%02x", $0) }.joined())
    return [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map { String(hex[$0]) }.joined(
      separator: "-")
  }

  static func u32be(_ value: UInt32) -> Data {
    withUnsafeBytes(of: value.bigEndian) { Data($0) }
  }
}
