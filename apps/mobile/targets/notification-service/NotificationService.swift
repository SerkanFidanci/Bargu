import UserNotifications

/// Bargu's Notification Service Extension (docs/ADR/0016). Every notification arrives with a
/// content-free placeholder and the sealed box under "bargu"; here, on the phone, the box is opened
/// with this device's key, its sender checked against the contacts the app trusts, and the text
/// written in the phone's language. Apple never sees more than the placeholder. If anything fails
/// (no shared keys yet, unknown sender, too old), the placeholder stays.
final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var placeholder: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let content =
      (request.content.mutableCopy() as? UNMutableNotificationContent)
      ?? UNMutableNotificationContent()
    placeholder = content
    guard let sealed = request.content.userInfo["bargu"] as? String,
      let shown = PushOpener.open(
        sealed: sealed, now: Date(),
        device: PushShare.read("device", as: PushShare.Device.self),
        contacts: PushShare.read("contacts", as: PushShare.Contacts.self),
        mutes: PushShare.read("mutes", as: PushShare.Mutes.self),
        history: PushShare.read("history", as: [String].self),
        live: PushShare.read("live", as: [String].self))
    else {
      contentHandler(content)
      return
    }
    switch shown {
    case .muted:
      // Shown as nothing once Apple grants the notification filtering entitlement; until then the
      // placeholder (which says nothing) appears.
      contentHandler(UNNotificationContent())
    case .show(let title, let body, let circleId, let thread):
      content.title = title
      content.body = body
      content.threadIdentifier = thread
      content.userInfo = thread == "guardians" ? ["route": "guardians"] : ["circleId": circleId]
      contentHandler(content)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let placeholder { contentHandler(placeholder) }
  }
}
