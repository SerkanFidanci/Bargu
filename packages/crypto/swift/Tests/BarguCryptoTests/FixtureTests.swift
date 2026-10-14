#if canImport(CryptoKit)
  import CryptoKit
#else
  import Crypto
#endif
import Foundation
import XCTest

@testable import BarguCrypto

/// Opens the TypeScript-generated vectors (packages/crypto/fixtures/protocol-v1.json) with the
/// Swift implementation: the cross-implementation guarantee BARGU_PLAN §3.1 asks for.
final class FixtureTests: XCTestCase {
  struct Device: Decodable {
    let deviceId: String
    let identitySecretKey: String
    let dhSecretKey: String
    let bundle: Bundle
    struct Bundle: Decodable {
      let identityKey: String
      let dhKey: String
      let dhKeySignature: String
    }
  }

  struct Fixtures: Decodable {
    let devices: [String: Device]
    let senderKeyDistribution: SenderKeyDistributionFixture
    let message: MessageFixture
    let sealedPush: SealedPushFixture
    let signedPush: PushFixture
    let noticePush: PushFixture
    let safetyNumber: SafetyNumberFixture

    struct PushFixture: Decodable {
      let sealed: String
      let body: String
    }

    struct SenderKeyDistributionFixture: Decodable {
      let senderKey: String
      let distribution: SenderKeyDistribution
    }
    struct MessageFixture: Decodable {
      let senderKey: String
      let envelope: MessageEnvelope
      let plaintext: String
    }
    struct SealedPushFixture: Decodable {
      let sealed: String
      let plaintext: String
    }
    struct SafetyNumberFixture: Decodable {
      let alice: Party
      let bob: Party
      let digits: String
      let qr: String
      struct Party: Decodable {
        let userId: String
        let identityKey: String
      }
    }
  }

  static let fixtures: Fixtures = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // BarguCryptoTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // swift
      .deletingLastPathComponent()  // crypto
      .appendingPathComponent("fixtures/protocol-v1.json")
    // The fixture must exist; failing loudly is the point.
    return try! JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
  }()

  var alice: Device { Self.fixtures.devices["alice"]! }
  var bob: Device { Self.fixtures.devices["bob"]! }

  func hex(_ text: String) -> Data {
    var data = Data()
    var index = text.startIndex
    while index < text.endIndex {
      let next = text.index(index, offsetBy: 2)
      data.append(UInt8(text[index..<next], radix: 16)!)
      index = next
    }
    return data
  }

  func b64(_ text: String) throws -> Data { try Encoding.base64url(text) }

  func testPublicKeysDeriveIdenticallyFromSecrets() throws {
    for device in [alice, bob] {
      let identity = try Curve25519.Signing.PrivateKey(rawRepresentation: hex(device.identitySecretKey))
      XCTAssertEqual(identity.publicKey.rawRepresentation, try b64(device.bundle.identityKey))
      let dh = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: hex(device.dhSecretKey))
      XCTAssertEqual(dh.publicKey.rawRepresentation, try b64(device.bundle.dhKey))
    }
  }

  func testDhKeySignaturesVerify() throws {
    for device in [alice, bob] {
      XCTAssertTrue(
        try BarguProtocol.isDhKeySigned(
          deviceId: device.deviceId,
          dhKey: b64(device.bundle.dhKey),
          signature: b64(device.bundle.dhKeySignature),
          identityKey: b64(device.bundle.identityKey)))
    }
    XCTAssertFalse(
      try BarguProtocol.isDhKeySigned(
        deviceId: bob.deviceId,
        dhKey: b64(alice.bundle.dhKey),
        signature: b64(alice.bundle.dhKeySignature),
        identityKey: b64(alice.bundle.identityKey)))
  }

  func testSenderKeyDistributionOpens() throws {
    let fixture = Self.fixtures.senderKeyDistribution
    let key = try BarguProtocol.openSenderKeyDistribution(
      fixture.distribution,
      recipientDhSecretKey: hex(bob.dhSecretKey),
      senderIdentityKey: b64(alice.bundle.identityKey))
    XCTAssertEqual(key, hex(fixture.senderKey))

    XCTAssertThrowsError(
      try BarguProtocol.openSenderKeyDistribution(
        fixture.distribution,
        recipientDhSecretKey: hex(bob.dhSecretKey),
        senderIdentityKey: b64(bob.bundle.identityKey))
    ) { XCTAssertEqual($0 as? BarguCryptoError, .badSignature) }
  }

  func testMessageVerifiesAndDecrypts() throws {
    let fixture = Self.fixtures.message
    let plaintext = try BarguProtocol.verifyAndDecrypt(
      envelope: fixture.envelope,
      senderKey: hex(fixture.senderKey),
      senderIdentityKey: b64(alice.bundle.identityKey))
    XCTAssertEqual(String(decoding: plaintext, as: UTF8.self), fixture.plaintext)
  }

  func testTamperedMessageIsRejected() throws {
    let fixture = Self.fixtures.message
    var ct = try b64(fixture.envelope.ct)
    ct[ct.startIndex] ^= 1
    let e = fixture.envelope
    let tampered = MessageEnvelope(
      v: e.v, circleId: e.circleId, epoch: e.epoch, senderDeviceId: e.senderDeviceId, seq: e.seq,
      salt: e.salt, ct: Encoding.base64urlEncode(ct), sig: e.sig)
    XCTAssertThrowsError(
      try BarguProtocol.verifyAndDecrypt(
        envelope: tampered, senderKey: hex(fixture.senderKey),
        senderIdentityKey: b64(alice.bundle.identityKey))
    ) { XCTAssertEqual($0 as? BarguCryptoError, .badSignature) }
  }

  func testEnvelopeDecodingIsStrict() throws {
    var json =
      try JSONSerialization.jsonObject(with: JSONEncoder().encode(Self.fixtures.message.envelope))
      as! [String: Any]
    XCTAssertNoThrow(
      try JSONDecoder().decode(
        MessageEnvelope.self, from: JSONSerialization.data(withJSONObject: json)))
    json["plaintext"] = "oops"
    XCTAssertThrowsError(
      try JSONDecoder().decode(
        MessageEnvelope.self, from: JSONSerialization.data(withJSONObject: json)))
  }

  func testMessageCiphertextMustHaveTheFixedSize() throws {
    let fixture = Self.fixtures.message
    let e = fixture.envelope
    let shorter = MessageEnvelope(
      v: e.v, circleId: e.circleId, epoch: e.epoch, senderDeviceId: e.senderDeviceId, seq: e.seq,
      salt: e.salt, ct: Encoding.base64urlEncode(try b64(e.ct).dropLast(128)), sig: e.sig)
    XCTAssertThrowsError(
      try BarguProtocol.verifyAndDecrypt(
        envelope: shorter, senderKey: hex(fixture.senderKey),
        senderIdentityKey: b64(alice.bundle.identityKey))
    ) { XCTAssertEqual($0 as? BarguCryptoError, .malformed) }
  }

  func testSealedPushOpensOnlyForRecipient() throws {
    let fixture = Self.fixtures.sealedPush
    let plaintext = try BarguProtocol.openSealed(
      fixture.sealed, recipientDhSecretKey: hex(bob.dhSecretKey))
    XCTAssertEqual(String(decoding: plaintext, as: UTF8.self), fixture.plaintext)

    XCTAssertThrowsError(
      try BarguProtocol.openSealed(fixture.sealed, recipientDhSecretKey: hex(alice.dhSecretKey))
    ) { XCTAssertEqual($0 as? BarguCryptoError, .decryptFailed) }
  }

  func knownSender(_ deviceId: String) -> Data? {
    deviceId == alice.deviceId ? try? b64(alice.bundle.identityKey) : nil
  }

  func openPush(
    _ sealed: String, claimingRecipient recipient: Device? = nil,
    senders: ((String) -> Data?)? = nil
  ) throws -> OpenedPush {
    try BarguProtocol.openPush(
      sealed, recipientDeviceId: (recipient ?? bob).deviceId,
      recipientDhSecretKey: hex(bob.dhSecretKey), senderIdentityKey: senders ?? knownSender)
  }

  func testSignedPushOpensAndMatchesTheBody() throws {
    let fixture = Self.fixtures.signedPush
    let opened = try openPush(fixture.sealed)
    XCTAssertEqual(opened.senderDeviceId, alice.deviceId)
    XCTAssertEqual(
      opened.body, try JSONDecoder().decode(PushBody.self, from: Data(fixture.body.utf8)))
    XCTAssertEqual(opened.body.kind, .place)
    XCTAssertEqual(opened.body.event, "enter")
    XCTAssertEqual(opened.body.name, "Ev")
    XCTAssertEqual(opened.body.emoji, "🏠")
  }

  func testServerNoticeOpensUnsigned() throws {
    let opened = try openPush(Self.fixtures.noticePush.sealed)
    XCTAssertNil(opened.senderDeviceId)
    XCTAssertEqual(opened.body.kind, .notice)
    XCTAssertEqual(opened.body.notice, "circleInvite")
  }

  func testPushIsBoundToItsRecipientAndSender() throws {
    let sealed = Self.fixtures.signedPush.sealed
    // Signed for Bob's device: claiming another recipient id breaks the signature.
    XCTAssertThrowsError(try openPush(sealed, claimingRecipient: alice)) {
      XCTAssertEqual($0 as? BarguCryptoError, .badSignature)
    }
    XCTAssertThrowsError(try openPush(sealed, senders: { _ in nil })) {
      XCTAssertEqual($0 as? BarguCryptoError, .keyMismatch)
    }
    let bobKey = try b64(bob.bundle.identityKey)
    XCTAssertThrowsError(try openPush(sealed, senders: { _ in bobKey })) {
      XCTAssertEqual($0 as? BarguCryptoError, .badSignature)
    }
  }

  func testPushBodyDecodingIsStrict() throws {
    let circle = "0190f7a4-5b6c-7d8e-9f01-23456789abcd"
    func decode(_ fields: [String: Any]) throws -> PushBody {
      try JSONDecoder().decode(
        PushBody.self, from: JSONSerialization.data(withJSONObject: fields))
    }
    let bump: [String: Any] = ["kind": "bump", "circleId": circle, "ts": 1]
    XCTAssertNoThrow(try decode(bump))
    XCTAssertThrowsError(try decode(bump.merging(["name": "x"]) { $1 }))
    XCTAssertThrowsError(try decode(bump.merging(["circleId": "not-a-uuid"]) { $1 }))
    XCTAssertThrowsError(
      try decode(["kind": "notice", "notice": "hello", "circleId": circle, "ts": 1]))
    let place: [String: Any] = [
      "kind": "place", "circleId": circle, "placeId": circle, "event": "exit", "name": "Ev",
      "emoji": "x", "ts": 1,
    ]
    XCTAssertNoThrow(try decode(place))
    XCTAssertThrowsError(try decode(place.merging(["event": "near"]) { $1 }))
    XCTAssertThrowsError(try decode(place.merging(["name": String(repeating: "x", count: 41)]) { $1 }))
    // A right-to-left override would let a name visually reorder the notification text.
    let override = String(Character(Unicode.Scalar(0x202E)!))
    XCTAssertThrowsError(try decode(place.merging(["name": "Ev" + override]) { $1 }))
  }

  func testSafetyNumberMatches() throws {
    let fixture = Self.fixtures.safetyNumber
    let number = try BarguProtocol.safetyNumber(
      userA: fixture.bob.userId, identityKeyA: hex(fixture.bob.identityKey),
      userB: fixture.alice.userId, identityKeyB: hex(fixture.alice.identityKey))
    XCTAssertEqual(number.digits, fixture.digits)
    XCTAssertEqual(number.qr, fixture.qr)
  }

  func testStrictEncodingRejectsMalformedInput() {
    XCTAssertThrowsError(try Encoding.base64url("AB"))  // non-canonical trailing bits
    XCTAssertThrowsError(try Encoding.base64url("A+"))  // standard alphabet
    XCTAssertThrowsError(try Encoding.uuidBytes("0190F7A4-5B6C-7D8E-9F01-23456789ABCD"))
    // Right length and characters, hyphen moved / sign prefix: TypeScript rejects both, so must Swift.
    XCTAssertThrowsError(try Encoding.uuidBytes("0190f7a45-b6c-7d8e-9f01-23456789abcd"))
    XCTAssertThrowsError(try Encoding.uuidBytes("+190f7a4-5b6c-7d8e-9f01-23456789abcd"))
    XCTAssertNoThrow(try Encoding.uuidBytes("0190f7a4-5b6c-7d8e-9f01-23456789abcd"))
    XCTAssertEqual(
      Encoding.uuidString(try Encoding.uuidBytes("0190f7a4-5b6c-7d8e-9f01-23456789abcd")),
      "0190f7a4-5b6c-7d8e-9f01-23456789abcd")
    XCTAssertThrowsError(try BarguProtocol.openSealed("AQ", recipientDhSecretKey: Data(count: 32)))
  }
}
