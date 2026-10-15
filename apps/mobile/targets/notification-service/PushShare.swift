import Foundation
import Security

/// What the app shares with this extension through their common keychain group (TypeScript:
/// src/features/notifications/extension-share.ts). Items are written by expo-secure-store, whose
/// service name gets ":no-auth" appended and whose account is the item name's UTF-8 bytes.
enum PushShare {
  static let service = "bargu.push:no-auth"

  struct Device: Decodable {
    let deviceId: String
    let dhSecretKey: String
  }

  /// TypeScript `PushContacts` (push-contacts.ts); the recipients list is not needed here.
  struct Contacts: Decodable {
    let devices: [String: Contact]
    let circles: [String: Circle]

    struct Contact: Decodable {
      let userId: String
      let name: String
      let identityKey: String
    }

    struct Circle: Decodable {
      let name: String
    }
  }

  /// TypeScript `Mutes` (mutes.ts).
  struct Mutes: Decodable {
    let people: [String: Person]
    let places: [String: Bool]

    struct Person: Decodable {
      let places: Bool
      let pokes: Bool
    }

    static let none = Mutes(people: [:], places: [:])
  }

  static func read<T: Decodable>(_ item: String, as type: T.Type) -> T? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: Data(item.utf8),
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }
}

/// What a notification shows, or that it stays quiet.
enum ShownPush: Equatable {
  case show(title: String, body: String, circleId: String, thread: String)
  case muted
}

/// Opens a sealed notification (docs/PROTOCOL.md §7) and words it like the app does
/// (src/features/notifications/push-text.ts, background-push.ts).
enum PushOpener {
  /// A notification older than this when it arrives is not shown any more (app: PUSH_FRESH_MS).
  static let freshSeconds: Double = 3_600

  static func open(
    sealed: String, now: Date,
    device: PushShare.Device?, contacts: PushShare.Contacts?, mutes: PushShare.Mutes?,
    history: [String]? = nil, live: [String]? = nil
  ) -> ShownPush? {
    guard let device, let contacts,
      let secret = try? Encoding.base64url(device.dhSecretKey, length: 32),
      let opened = try? BarguProtocol.openPush(
        sealed, recipientDeviceId: device.deviceId, recipientDhSecretKey: secret,
        senderIdentityKey: { deviceId in
          contacts.devices[deviceId].flatMap { try? Encoding.base64url($0.identityKey, length: 32) }
        })
    else { return nil }
    let body = opened.body
    guard now.timeIntervalSince1970 * 1000 - Double(body.ts) <= freshSeconds * 1000 else {
      return nil
    }
    let mutes = mutes ?? .none
    switch body.kind {
    case .notice:
      let circle = contacts.circles[body.circleId]?.name ?? ""
      // Someone new in a circle that sees the location or the history: they can see it too
      // (Faz 9, docs/ADR/0019).
      let joined = body.notice == "memberJoined"
      let seesLive = joined && (live ?? []).contains(body.circleId)
      let seesHistory = joined && (history ?? []).contains(body.circleId)
      let what = seesLive && seesHistory ? "Both" : seesLive ? "Sees" : seesHistory ? "History" : ""
      let text: String
      if !joined {
        text = localized("notice.\(body.notice ?? "")")
      } else if circle.isEmpty {
        text = localized("notice.memberJoined\(what)")
      } else {
        text = String(format: localized("notice.memberJoined\(what)In"), circle)
      }
      return .show(title: "Bargu", body: text, circleId: body.circleId, thread: "social")
    case .bump:
      guard let sender = opened.senderDeviceId.flatMap({ contacts.devices[$0] }) else { return nil }
      if mutes.people[sender.userId]?.pokes == true { return .muted }
      return .show(
        title: "Bargu", body: String(format: localized("poked"), sender.name),
        circleId: body.circleId, thread: "social")
    case .late:
      guard let sender = opened.senderDeviceId.flatMap({ contacts.devices[$0] }),
        let minutes = body.minutes
      else { return nil }
      if mutes.people[sender.userId]?.places == true { return .muted }
      return .show(
        title: contacts.circles[body.circleId]?.name ?? "Bargu",
        body: String(format: localized("late"), sender.name, minutes),
        circleId: body.circleId, thread: "meetings")
    case .place:
      guard let sender = opened.senderDeviceId.flatMap({ contacts.devices[$0] }),
        let placeId = body.placeId, let name = body.name, let emoji = body.emoji
      else { return nil }
      if mutes.people[sender.userId]?.places == true || mutes.places[placeId] == true {
        return .muted
      }
      return .show(
        title: "\(emoji) \(name)",
        body: String(format: localized(body.event == "exit" ? "left" : "arrived"), sender.name),
        circleId: body.circleId, thread: "places")
    }
  }

  static func localized(_ key: String) -> String {
    NSLocalizedString(key, comment: "")
  }
}
