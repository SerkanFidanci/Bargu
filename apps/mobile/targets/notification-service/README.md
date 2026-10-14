# Bargu Notification Service Extension (iOS)

Opens sealed notifications on the iPhone (docs/ADR/0016): APNs delivers a content-free placeholder
and the sealed box; `NotificationService.swift` opens it with this device's X25519 key, checks the
sender against the contacts the app trusts and writes the text in the phone's language. Apple never
sees more than the placeholder.

- `expo-target.config.json`: generated into the Xcode project by `@bacons/apple-targets` on
  prebuild. The keychain group must match `PUSH_KEYCHAIN_GROUP` in `apps/mobile/app.config.ts`.
- `BarguCrypto.swift`: a copy of `packages/crypto/swift/Sources/BarguCrypto/BarguCrypto.swift`
  (the code the CryptoKit cross-implementation tests run); a Jest test keeps the two identical.
- `PushShare.swift`: reads what the app shares (`src/features/notifications/extension-share.ts`)
  and words the notification like `src/features/notifications/push-text.ts`.
- CI type-checks these sources against the iOS SDK (job "Swift (CryptoKit)").
