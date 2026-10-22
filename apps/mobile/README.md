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

## Mağaza sürümü (Google Play)

Kaynak: `docs/play-store/KONTROL-LISTESI.md` (K1, K3, K4). Durum: 2026-10-22. Aşağıdakiler
**sahibin ve Play hesabının gerekmediği** kısımlar; kalanlar en sonda.

### Paket türü: AAB (K1)

- `production` profili **AAB** (Android App Bundle) üretir (`eas.json`: `buildType: app-bundle`,
  `distribution: store`). Play yeni uygulamada APK kabul etmez. `preview` ve `development` APK
  kalır, elle kurulur.
- Bu bilgisayarda deneme: `FORMAT=aab scripts/build-android-local.sh [commit]` →
  `~/bargu-builds/bargu-<commit>-check.aab` (yaklaşık 7 dakika). Bu bir **kontrol paketidir**:
  projenin debug anahtarıyla imzalı (Play bunu kasten reddeder), API adresi yok, çalıştırılmaz.
  Şunu kontrol eder: paket derleniyor mu, manifestteki hedef SDK 36 ve üstü mü (altındaysa betik
  reddeder), paketin içindeki JavaScript'te geliştirici aracı var mı (aşağıda).
- Gerçek mağaza paketi: `FORMAT=aab SIGN=eas scripts/build-android-local.sh [commit]` (ya da bulutta
  `eas build --platform android --profile production`). Upload key ve production ortamı EAS'tan
  gelir; bunlar yokken bu yol **denenmedi**.
- AAB'yi `scripts/publish-apk.sh` ile sunucuya koyamazsın: betik `.apk` dışını ve `.apk` adı
  verilmiş paketi reddeder (mağaza paketi web bağlantısına çıkmaz).

### Hedef SDK 36 (K3)

- Expo SDK 57 ile React Native 0.86.3'ün varsayılanı zaten: minSdk 24, targetSdk 36, compileSdk 36,
  buildTools 36.0.0 (`react-native/gradle/libs.versions.toml`; `expo-modules-core`'un yedek
  değerleri de 36). Bu yüzden `expo-build-properties` eklenmedi, `app.config.ts`'e bir şey yazılmadı.
- Doğrulama: derlenmiş paketin birleşik manifesti `minSdkVersion="24" targetSdkVersion="36"`
  (`b4ec27b`, 2026-10-22). Betik her AAB kontrolünde bunu okur; ileride bir Expo ya da RN güncellemesi
  değeri sessizce düşürürse derleme reddedilir.
- Google kuralı (Play yardımı, 2026-10-22'de okundu): yeni uygulama ve güncellemeler Android 16'yı
  (API 36) hedeflemeli; tarih 31 Ağustos 2026, 1 Kasım 2026'ya kadar uzatma istenebiliyor. API 37
  henüz şart değil.
- Android 16'nın hedef 36 için davranışı (Android geliştirici belgesi): kenardan kenara ekran
  kapatılamaz (uygulamada zaten açık: `edgeToEdgeEnabled=true`); tahmini geri varsayılan açık, ama
  `predictiveBackGestureEnabled: false` ile bilerek kapalı ve Android 16 bu kapatmaya izin veriyor.
  **Android 16 telefonda denenmedi** (test oturumuna ya da sahibe kalır).

### versionCode her zaman artar (K4)

- Kural: Play aynı `versionCode`'u iki kez ve öncekinden küçüğünü kabul etmez. Numarayı tek bir
  yer verir: EAS'ın uzak sayacı (`eas.json`: `appVersionSource: remote` ve `production`'da
  `autoIncrement: true`). Bulutta ve bu bilgisayarda alınan mağaza derlemeleri **aynı sayaçtan**
  numara alır; sayaç geri gidemez. `preview` ve `development` sayacı artırmaz.
- `app.config.ts`'e `android.versionCode` yazma: EAS onu yok sayar, kaynak ileride `local` olursa her
  makine kendi sayısını sayar. Bu kuralları `src/config/release-config.test.ts` bekçiler.
- Yerel betikte (`SIGN=eas`): derlemeden önce ve sonra `eas build:version:get` ile sayaç okunur;
  artmadıysa ya da okunamadıysa paket **silinir** ve betik reddeder. `SIGN=check` paketinin
  `versionCode`'u anlamsızdır (mağazaya zaten yüklenemez).
- Uzak sayaç şu an **1** (`eas build:version:get`, 2026-10-22); ilk production derlemesi 2 alır. Play'e
  daha önce bir kod yüklenmedi, başlangıç değerine dokunmak gerekmiyor.
- `version` **0.9.0** (kapalı test); mağazada görünen ad. 1.0.0 herkese açık sürüm için ayrılmıştır.

### Android izinleri

Yayın manifestosunun gerçek listesi (Gradle birleştirmesinden sonra, 38 izin; 2026-10-22): 16'sı
kalır, 22'si `app.config.ts` içindeki `blockedPermissions` ile çıkarılır. Her izin için kaynağı
`manifest-merger` raporundan okundu. `FORMAT=aab` denemesi çıkan izinlerin manifestoda **gerçekten
olmadığını** denetler ve kalan listeyi yazar (`scripts/check-manifest.mjs`); `release-config.test.ts`
gerekli izinlerin yanlışlıkla engellenmediğini denetler.

**Kalanlar (16):**

| İzin                                                      | Kaynak                              | Neden                                                                                 |
| --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`          | expo-location                       | Konum paylaşımı (yalnız "kullanırken"; arka plan konumu istenmez)                     |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`       | expo-location                       | Kilitli ekranda sürsün diye görünür bildirimli konum servisi (Play beyanı C9)         |
| `CAMERA`                                                  | expo-camera                         | QR okuma, kayıt yok                                                                   |
| `POST_NOTIFICATIONS`                                      | expo-notifications, firebase        | Android 13+ bildirim izni (bağlamda istenir)                                          |
| `RECEIVE_BOOT_COMPLETED`                                  | expo-notifications                  | Telefon yeniden başlayınca yerel hatırlatmalar yeniden kurulur (aşağıda)              |
| `USE_BIOMETRIC`, `USE_FINGERPRINT`                        | expo-local-authentication, androidx | Uygulama kilidi; Android 7 ve 8'de (minSdk 24) parmak izi için `USE_FINGERPRINT` şart |
| `VIBRATE`                                                 | expo-haptics                        | Dokunsal geri bildirim                                                                |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`   | şablon, netinfo, maplibre           | Ağ ve bağlantı durumu                                                                 |
| `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | firebase-messaging                  | Push (FCM)                                                                            |
| `app.bargu.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`      | androidx.core                       | Uygulamanın kendi imzasına özel; kitaplık ekler, kullanıcıya görünmez                 |

**Çıkarılanlar (22):**

| İzin                                                                                        | Kaynak                                                           | Neden gerekmez                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SYSTEM_ALERT_WINDOW`                                                                       | prebuild şablonu                                                 | Yalnız geliştirici menüsünün katmanı (debug)                                                                                                                       |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` (Android 12 ve eski)                      | şablon, expo-file-system, expo-image-picker, expo-screen-capture | Fotoğraf sistem seçicisinden gelir (Expo belgesi: kitaplık için izin istenmez); dışa aktarma kullanıcının seçtiği klasöre (SAF) yazılır                            |
| `READ_MEDIA_IMAGES`, `DETECT_SCREEN_CAPTURE`                                                | expo-screen-capture                                              | Yalnız "ekran görüntüsü alındı" dinleyicisi içindir; Bargu yalnız engeller (`usePreventScreenCapture`, FLAG_SECURE), dinlemez. Play `READ_MEDIA_IMAGES`'i kısıtlar |
| `BIND_GET_INSTALL_REFERRER_SERVICE`                                                         | installreferrer (expo-application)                               | Kurulum kaynağı okunmuyor                                                                                                                                          |
| `READ_APP_BADGE` ve 15 başlatıcı izni (Samsung, Huawei, Sony, HTC, OPPO, Apex, Solid, ZUK…) | ShortcutBadger (expo-notifications)                              | Uygulama simgesine sayı rozeti içindir; Bargu rozet sayısı koymaz                                                                                                  |

**`DUMP` bir izin isteği değildir:** `androidx.profileinstaller`ın alıcısında `android:permission`
olarak yazılıdır (alıcıyı yalnız sistem ve adb tetikleyebilsin diye); engellenecek bir şey yok.

**`RECEIVE_BOOT_COMPLETED` neden kalıyor, yeniden başlatınca ne olur:**

- Uygulama yerel zamanlı bildirim kurar: deneme bitişi (`trial-reminder.ts`), haftalık "kim
  görüyor" hatırlatması (`sharing-reminder-notification.ts`) ve buluşmaya "çıkmalısın" hatırlatması
  (`plan/reminders.ts`). Android yeniden başlayınca bu alarmları siler; expo-notifications bunları
  `BOOT_COMPLETED` alıcısıyla yeniden kurar. İzin olmazsa üç hatırlatma da telefon yeniden başladıktan
  sonra sessizce kaybolur. `expo-task-manager`ın alıcısı da aynı yayını dinler (kayıtlı görevleri geri
  yükler).
- **Konum paylaşımı yeniden başlatınca büyük olasılıkla kendiliğinden sürmez** (bu izinden bağımsız):
  konum servisi yalnız uygulama önde açıkken başlatılabilir (`tracker.ts` yorumu; arka plan konum
  izni bilerek istenmiyor) ve Android, bu izni olmayan uygulamanın konum servisini açılış
  yayınından başlatmasına izin vermez. Yani bugün paylaşım, kullanıcı uygulamayı bir kez açana
  kadar durur ve arkadaşları o arada "Çevrim dışı" görür. **Bunu telefonda denemedim**; kod ve Android
  kuralından çıkarım. Bu bir ürün kararı: yeniden başlatma sonrası "paylaşım durdu, aç" bildirimi
  gibi bir çözüm istenirse ayrı iş.

### Geliştirici araçları üretim paketinde olmaz

- Neler: Ben > Uygulama'daki geliştirici satırları, haritada 50 sahte kişi (sürü) ve paneli, ölçüm
  katmanı ve takılma ölçeri, kripto hız testi, bileşen galerisi, ödeme taklidi ekranı ve hepsinin
  metinleri; ayrıca **test satın alma** (Bargu+ ve pin süsleri) ile sunucudaki iki yolu
  (`/v1/billing/test/purchase`, `/v1/billing/test/simulate`).
- Nasıl: `index.ts` bunları `process.env.EXPO_PUBLIC_DEV_TOOLS` (derlemede sabit olur) arkasında
  `import()` ile yükler (`src/features/dev/measure`, `src/features/dev/tools.ts`); Metro üretim
  paketinde atar. Ekranlar boş yuvalara (`src/features/dev/slots.ts`) bakar. `features/dev` içinden
  yalnız `slots` ve `route` üretim koduna girebilir; başka bir şey ona statik `import` ederse araç
  sızar ve aşağıdaki kontrol kırılır. Metinler `src/i18n/locales/dev.*.json` içinde, ortak
  sözlükte değil.
- Test satın alma ayrı bir bayrakla yüklenir: `EXPO_PUBLIC_TEST_BILLING=1` (`eas.json`: yalnız
  `development` ve `preview`; `index.ts`, `src/features/billing/test-billing.ts`'i yükler). Üretim
  paketinde Bargu+ ekranı "Yakında Google Play üzerinden" der ve ne satın alma ne iptal çağrısı
  yapabilir: sunucu ne derse desin. Önizlemede bugünkü test satın alma aynen sürer.
- Kontrol: `pnpm check:bundle` (makine kilidiyle, yaklaşık 2 dakika) bayraksız bir paket üretir ve
  işaretlerin **hiçbirinin** olmadığını, bayraklı (önizleme gibi) paketin **hepsini** içerdiğini
  doğrular. İşaretler `dev.*.json` metinlerinden otomatik çıkar; ayrıca koddan dört dize ve iki test
  satın alma yolu vardır. Aynı iş yerel AAB denemesinde de yapılır. Sonuç (2026-10-22): bayraksız 97
  işaretten **0** bulundu, bayraklı 97'nin 97'si var; bu işlerden önce aynı kontrol bayraksız pakette
  97 işaretten 96'sını buldu (iki test satın alma yolu dahil).
- Üretimde bilerek kalanlar (kod ya da metin değil, hiç çalışmaz): `app/_dev/` altındaki üç satırlık
  yol dosyaları (expo-router dosya yollarını ister; boş yuvada ana sayfaya yönlendirir), konum
  hattındaki boş `probe` kancaları, `passkeyDiagnostic` yardımcısı (yalnız önizlemede hata metnine
  eklenir) ve `DEV_TOOLS_ENABLED` sabiti (passkey iletisi için).

### Sahibe ve PM'e kalanlar

1. **K2, upload key:** EAS'ta üret (`eas credentials`); dosya ve parola iki ayrı yerde yedeklenir,
   depoya girmez. Bu olmadan `SIGN=eas` ve bulutta `production` derlemesi imzalanamaz.
2. EAS'ın **"production" ortamı şu an boş** (eas-cli 2026-10-22'de "hiç değişken yok" dedi). Orada
   `EXPO_PUBLIC_API_URL` (https) ve Firebase dosyası değişkeni (`GOOGLE_SERVICES_JSON`) tanımlanmadan
   alınan mağaza paketi açılışta "EXPO_PUBLIC_API_URL is required" diye düşer. Adres için alan adı
   kararı gerekir (K12). Yerel kontrol paketinde ikisi de bilerek yok.
3. İlk gerçek paketi `SIGN=eas` ile aldıktan sonra sayaç çıktısına bak (`versionCode önceki -> yeni`).
4. Play Console'a yükleme, Play App Signing (D2), 14 günlük kapalı test: hesap açılınca sahibin işi.
5. Android 16'lı bir telefonda uygulamayı açıp kenardan kenara düzeni ve geri hareketini denemek.

## Komutlar

| Komut            | Ne yapar                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `pnpm typecheck` | Expo Router tiplerini üretir, sonra `tsc --noEmit`                  |
| `pnpm lint`      | ESLint 10 (tip bilgili) + React Hooks/Compiler + Expo env kuralları |
| `pnpm test`      | Jest (`jest-expo` preset)                                           |
