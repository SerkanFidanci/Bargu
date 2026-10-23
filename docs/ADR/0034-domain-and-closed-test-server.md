# 0034. Kalıcı alan adı bargu.app ve kapalı test sunucusu

- Durum: Kabul edildi (2026-10-23)
  - Ad düzeni: PM onayladı.
  - Sunucu: sahip seçti ("a yı seçiyorum … en son tr ye taşıcaz zaten canlıya alırken").
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

## Karar

### 1. Ad düzeni

| Ad                  | Ne çalışır                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bargu.app`         | Davet bağlantıları (`bargu.app/i#…`, `/g#…`) ve kart görseli. `/.well-known/assetlinks.json` ve `apple-app-site-association`. Geçiş anahtarlarının RP ID'si. Kök sayfa `otenus.com`'daki Bargu sayfasına yönlendirir. |
| `api.bargu.app`     | API, canlı bağlantı (WebSocket), harita dosyaları (`/map/`), APK bağlantıları (`/apk/`)                                                                                                                               |
| `staging.bargu.app` | Şimdilik kullanılmaz. Canlı hizmet Türkiye'ye taşınınca bugünkü sunucu staging olur ve bu adı alır (6. bölüm)                                                                                                         |

Gerekçe:

- **RP ID kökte (`bargu.app`).** Android'in Credential Manager'ı `assetlinks.json`'u RP ID'nin
  kendisinde arar. Kök, ileride bir web sayfasında aynı passkey'le girişe de izin verir. Bu ad bir
  kez seçilir, değişmez.
- **Davetler kökte.** En kısa bağlantı ve marka. App Links (`autoVerify`) bu ad için kurulur.
  Tek `assetlinks.json` hem davetleri hem passkey'i taşır.
- **API ayrı alt alanda.** API taşınsa, büyüse, önüne CDN konsa da kök alan ve davetler etkilenmez.
- **Kapalı test tek sunucuda.** Önizleme ve mağaza sürümleri aynı sunucuyla konuşur: aynı API
  adresi, aynı RP ID, aynı davet adı. İki imza da tanınır:
  - önizleme ve yerel derlemeler bugünkü anahtarla imzalı;
  - mağaza sürümü Play App Signing ile imzalı (K6).

  `ANDROID_CERT_SHA256` ve `WEBAUTHN_ORIGINS` ikisini de listeler.

- **Harita** `api.bargu.app/map/` altında, bugünkü gibi.
- **Geçiş süresi:** sslip.io adı bir süre daha açık kalır; eski önizleme APK'ları onu kullanır.
  Yeni APK yalnız yeni adın davetlerini uygulamada açar. Eski adla paylaşılmış bir davet tarayıcıda
  davet sayfası olarak açılır.

### 2. Kapalı test sunucusu: bugünkü sunucu (A)

Değerlendirilen seçenekler (aylık, KDV hariç, Ekim 2026):

- **A. Bugünkü sunucu: 0 €. Seçildi.** Zayıf yanları 5. bölümde ücretsiz yollarla hafifletilir.
- **B. Ayrı küçük sunucu (Hetzner Cloud 2 vCPU / 4 GB): ~10–11 €.** Kalemler: sunucu, IPv4,
  otomatik yedek ve Storage Box.
- **C. Yönetilen platform ve veritabanı: ~25–50 €.** Pahalı; veriler AB dışına çıkabilir.

Canlıya geçerken hizmet Türkiye'de bir sunucuya taşınır (sahibin kararı, 6. bölüm).

### 3. Değişecek yapılandırmalar (alan adı alınınca)

**Sunucu (`.env`):**

- `WEBAUTHN_RP_ID=bargu.app`.
- `WEBAUTHN_ORIGINS`: önizleme ve Play imzalarının `android:apk-key-hash:` değerleri.
- `INVITE_HOST=bargu.app`.
- `ANDROID_CERT_SHA256`: önizleme imzası, Play App Signing ve upload key sertifikaları (K6).
- Haber imza anahtarı aynı kalır (`stg-n1`, tek sunucu). Türkiye'deki canlı sunucu kendi
  anahtarını alır.

**API kodu:** `STAGING_INVITE_HOST` sabiti (`apps/api/src/config/env.ts`, sslip adı) kalkar ya da
yeni ada geçer.

**Uygulama (EAS ortamları, `eas.json`):**

- `production` ve `preview` için aynı adresler:
  - `EXPO_PUBLIC_API_URL=https://api.bargu.app`;
  - `EXPO_PUBLIC_MAP_URL=https://api.bargu.app/map`;
  - `EXPO_PUBLIC_INVITE_HOST=bargu.app`;
  - `EXPO_PUBLIC_NOTICE_KEYS=stg-n1:…`.
- Fark yalnız geliştirici araçları ve test ödemesi (yalnız `preview`'da).
- `app.config.ts`: davet intent filtresi zaten `EXPO_PUBLIC_INVITE_HOST`'tan geliyor. iOS'ta
  `associatedDomains` aynı ada, iOS diliminde.

**nginx ve TLS (aynı sunucu):**

- `bargu.app` sitesi: yalnız `/i`, `/g`, `/.well-known/`, kart görseli; `/` → `otenus.com`
  yönlendirmesi; gerisi 404.
- `api.bargu.app` sitesi: bugünkü şablonla (`__API_DOMAIN__`). sslip sitesi geçiş süresince kalır.
- Davet adresleri erişim günlüğüne yazılmaz (QA-34 düzeni, `~*`).
- TLS: Let's Encrypt (certbot, HTTP-01). 80 numaralı port yalnız sertifika doğrulaması ve https'e
  yönlendirme içindir.
- `.app` HSTS ön yükleme listesinde: tarayıcılar yalnız https açar. Sunucu da HSTS başlığı
  gönderir (1 yıl).

### 4. Sahibin adımları

1. **Alan adını al.** PM'in önerisi:
   - Spaceship: ilk yıl ~5 $, yenileme ~14,7 $.
   - Cloudflare Registrar: her yıl ~14 $.

   İkisinde de WHOIS gizliliği ücretsiz. Otomatik yenilemeyi aç.

2. **DNS kayıtlarını gir.** Alan adını aldığın yerin "DNS" ya da "Advanced DNS" sayfasında
   (Spaceship) veya "DNS → Records" sayfasında (Cloudflare) şu kayıtları ekle:

   | Ad (Name / Host) | Tür | Değer                       | TTL        |
   | ---------------- | --- | --------------------------- | ---------- |
   | `@` (bargu.app)  | A   | `46.62.162.70`              | Auto / 300 |
   | `api`            | A   | `46.62.162.70`              | Auto / 300 |
   | `@`              | CAA | `0 issue "letsencrypt.org"` | Auto       |

   Cloudflare'de iki A kaydının "Proxy" düğmesi kapalı ("DNS only", gri bulut) olmalı. Açık olursa
   canlı bağlantı ve sertifika düzeni değişir. Spaceship'te böyle bir düğme yok.

   E-posta `bargu.app` adından gidecekse SPF, DKIM ve DMARC kayıtları da gerekir. Bunlar
   gönderici seçilince eklenir; destek adresi `support@otenus.com` buna bağlı değil.

3. **Kodlama oturumuna "aldım" yaz.** Sertifikalar, nginx ve ayarları kodlama oturumu yapar;
   sunucu adımlarını sen onaylarsın.

### 5. Ortak sunucunun zayıf yanları, ücretsiz hafifletme

Sunucudaki her değişiklik sahibin onayıyla yapılır. Kurulum tek komuttur (`install-backup.sh`).

**a. Yedek (Faz 10 DoD).**

`bargu-backup` (`infra/staging/backup.sh`) iki zamanda çalışır:

- her gece saat 03:30'da;
- her dağıtımdan önce.

Ne yapar:

- `pg_dump` ile veritabanını alır (tam döküm, `--format=custom`).
- **age** ile şifreler. Sunucuda yalnız açık anahtar durur. Gizli anahtar sunucuda ve depoda
  değil: sahibin bilgisayarında üretilir, sahip parola yöneticisinde ve ikinci bir yerde saklar.
- Sunucuda son 14 gece ve son 10 dağıtım öncesi yedeği tutar.
- Redis yedeklenmez (geçici veri). Harita dosyaları yeniden indirilebilir.

Yedeğin sunucu dışındaki kopyası şifreli olduğu için herhangi bir yerde durabilir. Seçenekler:

| Yer                      | Ücret       | Not                                                         |
| ------------------------ | ----------- | ----------------------------------------------------------- |
| Sahibin Otenus sunucusu  | 0           | Önerim. O sunucuya yazmak için sahibin ayrıca onayı gerekir |
| Cloudflare R2            | ilk 10 GB 0 | Alan adı Cloudflare'de alınırsa aynı hesap                  |
| Backblaze B2             | ilk 10 GB 0 | Hesap açılır                                                |
| Hetzner Storage Box BX11 | ~3,20 €/ay  | Ücretli                                                     |

Kopya her gece `rsync` ile gider. Hedef sunucuda yalnız yedek klasörüne yazabilen, kısıtlı bir
anahtar kullanılır.

**Geri yükleme denemesi** (`infra/staging/restore-check.sh`, sahibin bilgisayarında, gizli
anahtarla):

1. Son yedeği çözer.
2. Sunucudakiyle aynı sürümde, geçici bir Postgres'e yükler.
3. Uygulanan migration sayısını depodakiyle karşılaştırır, tabloların satır sayılarını yazar.
   Kişisel veri yazdırmaz.

Kapalı testten önce bir kez yapılır (Faz 10 DoD). Sonra her ay bir kez yapılır.

**b. Kapalı test süresince her `main` push'u testçi verisine dokunuyor.**

- `bargu-deploy` migration'dan önce bir yedek alır. Yedek alınamazsa migration uygulanmaz, dağıtım
  durur, çalışan sürüm olduğu gibi kalır.
- Migration'lar yalnız ekler (genişlet ve sonra daralt). CI bunu denetler
  (`scripts/check-migrations.mjs`, 0039'dan sonraki dosyalar). Şunlar ancak bir `-- contract:`
  satırıyla kabul edilir:
  - tablo ya da sütun silmek;
  - ad değiştirmek;
  - tür daraltmak;
  - `NOT NULL` eklemek;
  - veri silmek.

  O satır hangi "genişlet" migration'ını tamamladığını ve hangi uygulama sürümünün artık ona
  ihtiyaç duymadığını yazar.

**c. Test hesapları gerçek testçilerden ayrı.**

- Test botu (`@deneme.arkadas`) yalnız izin listesindeki hesapların arkadaşlık isteğini ve
  davetini kabul eder (`/tmp/bot-allow`, sahibin hesapları). Başka herkesinkini reddeder.
- QA oturumları yalnız kendi `.test` hesaplarını kullanır, gerçek testçileri eklemez ve
  çemberlerine girmez.
- Kapalı testten önce bot, gerçek testçilerin çemberlerinden çıkar (Faz 10 kuralı).

### 6. Gelecek adım: Türkiye'ye taşıma

Canlıya geçerken hizmet Türkiye'de bir sunucuya taşınır (sahibin kararı, KVKK).

- Adlar değişmez: `bargu.app` ve `api.bargu.app`'in A kayıtları yeni sunucuya çevrilir.
  Passkey'ler, davetler ve uygulamadaki adres aynı kalır.
- Veriler son yedekten yüklenir. Geri yükleme denemesi bunun provasıdır.
- Canlı sunucu kendi haber imza anahtarını alır. Uygulamada önce iki anahtar birlikte güvenilir,
  sonra eskisi çıkar.
- Bugünkü sunucu staging olur ve `staging.bargu.app` adını alır, ayrı RP ID ile. Önizleme
  sürümleri oraya döner.

## Sıra

1. Alan adı ve DNS (sahip).
2. Yedek kurulumu ve bir geri yükleme denemesi (5a). Alan adından bağımsız, hemen yapılabilir.
3. `bargu.app` ve `api.bargu.app`:
   - nginx siteleri ve sertifikalar;
   - sunucu `.env` (RP ID, `INVITE_HOST`, sertifikalar);
   - EAS ortamları;
   - yeni APK.
4. `production` profili ve Play kapalı testi.
5. Canlıya geçiş: Türkiye'deki sunucuya taşıma (6).

## Sonuçlar ve riskler

- Bu adlar kapalı testten **önce** kesinleşir. Sonra değişirse passkey'ler yeniden oluşturulur ve
  paylaşılmış davetler bozulur.
- RP ID sslip adından `bargu.app`'e geçince bugünkü önizleme passkey'leri çalışmaz. Testçiler
  e-posta koduyla girer ve passkey'i yeniden oluşturur. Bu bir kez olur, kapalı testten önce.
- Ortak sunucu ve tek veritabanı kapalı test boyunca sürer. Yedek, dağıtım öncesi yedek, yalnız
  ekleyen migration'lar ve test hesabı ayrımı riski azaltır, kaldırmaz.
