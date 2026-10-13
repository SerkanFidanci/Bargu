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
    let safetyNumber: SafetyNumberFixture

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

  func testSealedPushOpensOnlyForRecipient() throws {
    let fixture = Self.fixtures.sealedPush
    let plaintext = try BarguProtocol.openSealed(
      fixture.sealed, recipientDhSecretKey: hex(bob.dhSecretKey))
    XCTAssertEqual(String(decoding: plaintext, as: UTF8.self), fixture.plaintext)

    XCTAssertThrowsError(
      try BarguProtocol.openSealed(fixture.sealed, recipientDhSecretKey: hex(alice.dhSecretKey))
    ) { XCTAssertEqual($0 as? BarguCryptoError, .decryptFailed) }
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
    XCTAssertThrowsError(try BarguProtocol.openSealed("AQ", recipientDhSecretKey: Data(count: 32)))
  }
}
