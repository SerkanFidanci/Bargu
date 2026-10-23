# 0034. Kalıcı alan adı bargu.app ve kapalı test sunucusu

- Durum: Önerildi (PM'in isteği, 2026-10-23; sahip alan adını "bargu.app" seçti; karar PM ve
  sahipte, sunucu parası sahibin)
- Tarih: 2026-10-23
- İlgili: [ADR 0003](0003-staging-deployment.md) (staging, paylaşımlı sunucu),
  [ADR 0009 Ek](0009-circles-keys-and-events.md) (https davet bağlantıları, App Links),
  `docs/play-store/KONTROL-LISTESI.md` K6 (Play imzası) ve K12 (alan adı), Faz 10 (yedek ve geri
  yükleme).

## Bağlam

Bugün her şey tek adda: `api.46-62-162-70.sslip.io`. API, canlı bağlantı, harita dosyaları,
davet sayfaları (`/i#…`, `/g#…`), `/.well-known` dosyaları ve geçiş anahtarlarının (passkey) RP
ID'si bu adda. Sunucu rastamen'le ortak ve yedeksiz.

Kapalı testten sonra şu dördü değişmemeli:

1. **Uygulamaya gömülü API adresi** (`EXPO_PUBLIC_API_URL`): değişirse eski APK'lar sunucuyu
   bulamaz.
2. **Davet bağlantılarının alanı**: insanlar bağlantıları paylaşır; alan değişirse eskiler
   uygulamayı açmaz.
3. **Geçiş anahtarlarının RP ID'si**: değişirse kayıtlı bütün passkey'ler çalışmaz, herkes
   yeniden oluşturur.
4. **App Links doğrulaması**: Android, bağlantıyı uygulamada açmadan önce o alanın
   `assetlinks.json`'una bakar.

## Önerilen karar

### 1. Ad düzeni

| Ad                  | Ne çalışır                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bargu.app`         | Davet bağlantıları (`bargu.app/i#…`, `/g#…`) ve kart görseli. `/.well-known/assetlinks.json` ve `apple-app-site-association`. Geçiş anahtarlarının RP ID'si. Kök sayfa `otenus.com`'daki Bargu sayfasına yönlendirir, başka bir şey yok. |
| `api.bargu.app`     | API, canlı bağlantı (WebSocket), harita dosyaları (`/map/`)                                                                                                                                                                              |
| `staging.bargu.app` | Staging'in hepsi tek adda (bugünkü düzen): API, harita, davetler, `.well-known`, RP ID `staging.bargu.app`, APK indirme bağlantıları (`/apk/`)                                                                                           |

Gerekçe:

- **RP ID kökte (`bargu.app`).** Android'in Credential Manager'ı `assetlinks.json`'u RP ID'nin
  kendisinde arar. Kök, ileride bir web sayfasında (`bargu.app` ya da bir alt alanı) aynı
  passkey'le girişe de izin verir. Bu ad bir kez seçilir, değişmez.
- **Davetler kökte.** En kısa bağlantı ve marka (`bargu.app/i#…`). App Links (`autoVerify`) bu ad
  için kurulur. Kök aynı zamanda RP ID olduğu için tek bir `assetlinks.json` ikisini birden taşır
  (bugün de öyle).
- **API ayrı alt alanda.** API taşınsa, büyüse, önüne CDN konsa da kök alan ve davetler
  etkilenmez.
- **Staging'in RP ID'si ayrı (`staging.bargu.app`).** Test passkey'leri üretime karışmaz. Uygulama
  kimliği ikisinde de `app.bargu`; imzalar farklı:
  - önizleme ve yerel derlemeler bugünkü anahtarla imzalı;
  - mağaza sürümü Play App Signing ile imzalı (K6).

  Her alanın `assetlinks.json`'u kendi sertifikasını listeler (`ANDROID_CERT_SHA256`).

- **Harita** `api.bargu.app/map/` altında, bugünkü gibi. CDN ancak gerekirse
  (`tiles.bargu.app`), şimdi değil.
- **Geçiş süresi:** sslip.io adı staging sunucusunda bir süre daha açık kalır. Eski önizleme
  APK'ları onu kullanır. Yeni APK yalnız yeni adın davetlerini uygulamada açar; eski adla
  paylaşılmış bir davet tarayıcıda davet sayfası olarak açılır.

### 2. Kapalı test hangi sunucuda

| Seçenek                                                      | Aylık (KDV hariç, Ekim 2026)                                                                                                                                                                         | Artı                                                                                                                                          | Eksi                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Bugünkü staging sunucusu                                  | 0                                                                                                                                                                                                    | Hazır, ek iş yok                                                                                                                              | Yedek yok; staging ve "üretim" aynı veritabanı ve aynı otomatik dağıtım (her `main` push'u testçilerin verisine dokunur); rastamen'le kaynak paylaşımı. Gerçek kullanıcı verisi (KVKK) için önermiyorum |
| **B. Ayrı küçük üretim sunucusu (önerim)**                   | Hetzner Cloud 2 vCPU / 4 GB / 40 GB (CX23 ya da CAX11) ~5,5–6 € + IPv4 0,50 € + otomatik yedek (sunucunun %20'si, ~1,2 €) + veritabanı dökümleri için Storage Box BX11 (1 TB) ~3,20 € = **~10–11 €** | Testçi verisi ayrı ve yedekli; üretime dağıtım elle onaylı; staging rahatça denenir; Faz 10'un yedek ve geri yükleme denemesi buradan yapılır | Aylık para; kurulum işi (bir gün kadar)                                                                                                                                                                 |
| C. Yönetilen platform ve veritabanı (Render, Railway, Neon…) | ~25–50 €                                                                                                                                                                                             | Bakım az                                                                                                                                      | Pahalı; veriler AB dışında olabilir (KVKK yurt dışı aktarım); bugünkü Docker düzeninden uzak                                                                                                            |

Öneri: **B**.

Hetzner Haziran 2026'da fiyatları artırdı. Bazı kaynaklar CX/CAX planlarının bir dönem
"şu an yok" göründüğünü yazıyor. Satın almadan önce hetzner.com'da güncel fiyata ve stoğa
bakılmalı; aynı bantta bir CPX planı ya da başka bir AB sağlayıcısı da olur.

B'nin düzeni:

- Staging olduğu yerde kalır (`staging.bargu.app`, otomatik dağıtım).
- Üretim aynı Docker imajını çalıştırır. GitHub'daki "production" ortamı elle onayla dağıtır.
- Gece `pg_dump`, şifreli olarak Storage Box'a gider. Redis geçici veri tutar, yedeklenmez.
  Harita dosyaları yeniden indirilebilir.
- Bir kez geri yükleme denemesi yapılır (Faz 10).

### 3. Değişecek yapılandırmalar (kod, karardan sonra)

**Üretim sunucusu (`.env` / compose):**

- `WEBAUTHN_RP_ID=bargu.app`.
- `WEBAUTHN_ORIGINS=android:apk-key-hash:<Play imzası>`; web girişi gelirse `https://bargu.app`
  da eklenir.
- `INVITE_HOST=bargu.app`.
- `ANDROID_CERT_SHA256`: Play App Signing ve upload key sertifikaları (K6).
- `NOTICE_SIGNING_KEY`: üretime **ayrı** anahtar (ör. `prod-n1`), staging'inki değil.
- `MIN_CLIENT_LEVEL`, push (FCM üretim projesi) ve gerçek e-posta göndericisi.

**Staging (`.env`):**

- `WEBAUTHN_RP_ID=staging.bargu.app`.
- `INVITE_HOST=staging.bargu.app`.
- `WEBAUTHN_ORIGINS` önizleme imzasıyla.

**API kodu:** `STAGING_INVITE_HOST` sabiti (`apps/api/src/config/env.ts`, bugün sslip adı) yeni
ada geçer ya da kalkar.

**Uygulama (EAS ortamları, `eas.json`):**

- `production`:
  - `EXPO_PUBLIC_API_URL=https://api.bargu.app`;
  - `EXPO_PUBLIC_MAP_URL=https://api.bargu.app/map`;
  - `EXPO_PUBLIC_INVITE_HOST=bargu.app`;
  - `EXPO_PUBLIC_NOTICE_KEYS=prod-n1:<açık anahtar>`;
  - `GOOGLE_SERVICES_JSON` (üretim Firebase).
- `preview` ve `development`:
  - adres `https://staging.bargu.app`;
  - `EXPO_PUBLIC_INVITE_HOST=staging.bargu.app`;
  - `EXPO_PUBLIC_NOTICE_KEYS` aynı kalır (`stg-n1`).
- `app.config.ts`: davet intent filtresi zaten `EXPO_PUBLIC_INVITE_HOST`'tan geliyor. iOS'ta
  `associatedDomains` (`applinks:` ve `webcredentials:`) aynı ada, iOS diliminde.
- Davet bağlantısını açan kod (`+native-intent.tsx`, `config/invite-host.ts`) tek ad kabul ediyor;
  değişiklik gerekmez, adı derleme verir.

**nginx ve TLS:**

- Üretim sunucusunda iki site:
  - `bargu.app`: yalnız `/i`, `/g`, `/.well-known/`, kart görseli; `/` → `otenus.com`
    yönlendirmesi; gerisi 404;
  - `api.bargu.app`: API, `/map/`, WebSocket.
- Davet adresleri erişim günlüğüne yazılmaz (QA-34 düzeni, `~*`).
- Staging: `staging.bargu.app` sitesi bugünkü şablonla (`__API_DOMAIN__`). sslip sitesi geçiş
  süresince kalır.
- TLS: Let's Encrypt (certbot, HTTP-01). 80 numaralı port yalnız sertifika doğrulaması ve
  https'e yönlendirme içindir.
- `.app` alanları HSTS ön yükleme listesinde: tarayıcılar yalnız https açar. Sunucu da HSTS
  başlığı gönderir (1 yıl). Sertifika yenilemesi certbot'un zamanlayıcısıyla.

### 4. Sahibin adımları

1. **Alan adını al.** Cloudflare Registrar maliyet fiyatına satar (`.app` yenilemesi yılda yaklaşık
   14 $). Porkbun'da ilk yıl yaklaşık 9 $, sonra yaklaşık 15 $. İkisinde de WHOIS gizliliği
   ücretsiz. Otomatik yenilemeyi aç.
2. **DNS kayıtlarını gir** ("A" kaydı = sunucunun IP adresi):

   | Ad                  | Tür | Değer                                                            |
   | ------------------- | --- | ---------------------------------------------------------------- |
   | `bargu.app`         | A   | üretim sunucusunun IP'si (B seçilirse; A seçilirse 46.62.162.70) |
   | `api.bargu.app`     | A   | aynı                                                             |
   | `staging.bargu.app` | A   | 46.62.162.70                                                     |
   | `bargu.app`         | CAA | `0 issue "letsencrypt.org"`                                      |

   Cloudflare kullanılırsa kayıtlar "DNS only" (gri bulut) olmalı. Proxy açık olursa canlı
   bağlantı ve sertifika düzeni değişir.

   E-posta `bargu.app` adından gidecekse SPF, DKIM ve DMARC kayıtları da gerekir. Bunlar
   gönderici seçilince eklenir; destek adresi `support@otenus.com` buna bağlı değil.

3. **Kodlama oturumuna "aldım" yaz,** üretim sunucusu alındıysa IP'siyle. Sertifikalar, nginx ve
   ayarları kodlama oturumu yapar; sunucu adımlarını sen onaylarsın.

## Sıra (karardan sonra)

1. Alan adı ve DNS (sahip).
2. `staging.bargu.app`: site, sertifika, staging `.env` (RP ID, `INVITE_HOST`), `preview`
   profili, yeni önizleme APK'sı.
3. Üretim sunucusu (B seçilirse): kurulum, yedek, bir geri yükleme denemesi (Faz 10).
4. `production` profili ve Play kapalı testi.

## Sonuçlar ve riskler

- Bu adlar kapalı testten **önce** kesinleşir. Sonra değişirse passkey'ler yeniden oluşturulur ve
  paylaşılmış davetler bozulur.
- Staging'in yeni ada geçişinde önizleme passkey'leri (RP ID sslip adı) yeni adda çalışmaz.
  Testçiler e-posta koduyla girer ve passkey'i yeniden oluşturur. Bu yalnız staging'de olur, bir
  kez.
- B'de aylık ~10–11 € ve yıllık ~14 $ alan adı.
