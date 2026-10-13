# @bargu/mobile

Expo SDK 57 (React Native 0.86, New Architecture, Hermes V1), Expo Router, TypeScript (sıkı mod).
Expo Go kullanılmaz; geliştirme **development build** (dev client) üzerinde yapılır.

## Günlük geliştirme

```bash
pnpm dev          # repo kökünden: API + Metro
pnpm dev:mobile   # sadece Metro, Expo'nun klavye kısayollarıyla
```

Telefonda Bargu dev client'ı aç ve Metro'ya bağlan: aynı Wi-Fi'de **Enter URL manually** →
`http://<bilgisayarın-yerel-IP'si>:8081`. Farklı ağdaysan `pnpm dev:mobile -- --tunnel`.
Geliştirmede uygulama, Metro'nun çalıştığı bilgisayardaki API'ye (port 3000) bağlanır.

## EAS (bulut build)

EAS projesi bağlı (`app.config.ts` içindeki `owner` ve `extra.eas.projectId`; bunlar kimlik bilgisi
değil, gizli değildir). Her geliştirici bir kez giriş yapar:

```bash
pnpm dlx eas-cli@24.12.1 login
```

Android imza anahtarı (keystore) EAS tarafından üretilir ve Expo'da saklanır.

### Android dev client

```bash
pnpm dlx eas-cli@24.12.1 build --platform android --profile development
```

Build bitince EAS'in verdiği link / QR ile APK'yı telefona kur.

### iPhone dev client (Mac gerekmez)

Ücretli **Apple Developer Program** üyeliği gerekir; sertifika ve profilleri EAS yönetir.

```bash
pnpm dlx eas-cli@24.12.1 device:create        # iPhone'u kaydet (çıkan linki telefonda aç)
pnpm dlx eas-cli@24.12.1 build --platform ios --profile development
```

iPhone'da **Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu**'nu aç, sonra EAS linkinden kur.
Yeni native build sadece native kod ya da config plugin değişince gerekir; JavaScript değişiklikleri
Metro'dan anında gelir.

## Komutlar

| Komut            | Ne yapar                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `pnpm typecheck` | Expo Router tiplerini üretir, sonra `tsc --noEmit`                  |
| `pnpm lint`      | ESLint 10 (tip bilgili) + React Hooks/Compiler + Expo env kuralları |
| `pnpm test`      | Jest (`jest-expo` preset)                                           |
