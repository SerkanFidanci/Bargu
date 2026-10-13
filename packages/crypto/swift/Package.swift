// swift-tools-version:6.0
// Swift side of the Bargu protocol (docs/PROTOCOL.md), for the iOS Notification Service Extension.
// Uses Apple CryptoKit on Apple platforms; swift-crypto (same API) only on Linux, for local tests.
import PackageDescription

let package = Package(
  name: "BarguCrypto",
  platforms: [.iOS(.v16), .macOS(.v13)],
  products: [
    .library(name: "BarguCrypto", targets: ["BarguCrypto"])
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-crypto.git", exact: "5.0.0")
  ],
  targets: [
    .target(
      name: "BarguCrypto",
      dependencies: [
        .product(name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux]))
      ]
    ),
    .testTarget(name: "BarguCryptoTests", dependencies: ["BarguCrypto"]),
  ]
)
