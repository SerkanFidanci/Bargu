# @bargu/mobile

Expo SDK 57 (React Native 0.86, New Architecture, Hermes V1), Expo Router, TypeScript strict.
Expo Go is not used; development happens in a **development build** (dev client).

## Daily development

```bash
pnpm dev          # from the repo root: API + Metro
pnpm dev:mobile   # Metro only, with Expo's keyboard shortcuts
```

Open the dev client on the phone and connect to Metro (same Wi-Fi, or `pnpm dev:mobile -- --tunnel`).
In development the app reaches the API on the machine running Metro, port 3000.

## EAS

The EAS project is linked (`owner` and `extra.eas.projectId` in `app.config.ts`; identifiers, not
secrets). Each developer logs in once:

```bash
pnpm dlx eas-cli@24.12.1 login
```

Android signing credentials are generated and stored by EAS (remote credentials).

### Android dev client

```bash
pnpm dlx eas-cli@24.12.1 build --platform android --profile development
```

Install the resulting APK on the emulator or phone (EAS shows a QR code / link).

### iPhone dev client (no Mac needed)

Requires a paid Apple Developer Program membership; EAS manages certificates and profiles.

```bash
pnpm dlx eas-cli@24.12.1 device:create        # register the iPhone (open the link on the phone)
pnpm dlx eas-cli@24.12.1 build --platform ios --profile development
```

On the iPhone, enable **Settings → Privacy & Security → Developer Mode**, then install the build
from the EAS link. A new native build is needed only when native code or config plugins change;
JavaScript changes load from Metro.

## Scripts

| Script           | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `pnpm typecheck` | Generates typed-route types, then `tsc --noEmit`               |
| `pnpm lint`      | ESLint 10 (type-aware) + React Hooks/Compiler + Expo env rules |
| `pnpm test`      | Jest (`jest-expo` preset)                                      |
