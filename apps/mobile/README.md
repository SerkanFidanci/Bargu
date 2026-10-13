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

## One-time EAS setup

Run inside `apps/mobile`:

```bash
pnpm dlx eas-cli@24.13.0 login
pnpm dlx eas-cli@24.13.0 init
```

`eas init` prints a project id. Add it to `app.config.ts` as `extra: { eas: { projectId: '<id>' } }`
(it is not a secret).

### Android dev client

```bash
pnpm dlx eas-cli@24.13.0 build --platform android --profile development
```

Install the resulting APK on the emulator or phone (EAS shows a QR code / link).

### iPhone dev client (no Mac needed)

Requires a paid Apple Developer Program membership; EAS manages certificates and profiles.

```bash
pnpm dlx eas-cli@24.13.0 device:create        # register the iPhone (open the link on the phone)
pnpm dlx eas-cli@24.13.0 build --platform ios --profile development
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
