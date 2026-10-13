# Proje Durumu

Her faz sonunda güncellenir: ne bitti, nasıl test edildi, açık riskler, kalan işler. Plan:
[BARGU_PLAN.md](../BARGU_PLAN.md) · Kararlar: [docs/ADR](ADR/README.md)

## Özet

| Faz                              | Durum                                        |
| -------------------------------- | -------------------------------------------- |
| Faz 0 — Temel & Güvenlik Altyapı | ✅ Onaylandı (açık madde: iPhone dev client) |
| Faz 1 — Kripto Çekirdeği         | 🔄 Onay bekliyor                             |

## Ortamlar

| Ne                 | Nerede                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| Staging API        | `https://api.46-62-162-70.sslip.io` (geçici ücretsiz domain; bkz. ADR 0003)             |
| Staging deploy     | `main`'e her yeşil CI → GHCR imajı → sunucu (otomatik, sağlık kontrollü)                |
| Expo / EAS projesi | hesap `otenus`, proje `bargu` (`app.config.ts`)                                         |
| Android sürümleri  | `development` (dev client, Metro'ya bağlanır), `preview` (bağımsız, staging'e bağlanır) |
| Uygulama kimliği   | `app.bargu` (mağazaya çıkınca değiştirilemez)                                           |

## Faz 1 — Kripto Çekirdeği (2026-10-13)

Protokol: [PROTOCOL.md](PROTOCOL.md) · Tehdit modeli: [THREAT_MODEL.md](THREAT_MODEL.md) · Kararlar:
[ADR 0004](ADR/0004-e2ee-protocol.md)

### DoD

| Madde                                  | Durum | Kanıt                                                                                    |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| Test vektörleri geçer                  | ✅    | RFC 7748 (X25519), 8032 (Ed25519), 8439 (ChaCha20-Poly1305), 5869 (HKDF) — RFC metninden |
| `packages/crypto` %100 satır coverage  | ✅    | Satır, ifade, dal ve fonksiyon %100 (CI'da eşik olarak zorunlu)                          |
| Tamper / replay / epoch testleri yeşil | ✅    | Tek bit değişikliği (property), tekrar ve eski `seq`, yanlış epoch/çember/gönderen       |
| Cihazda şifreleme < 5 ms               | ⏳    | `/_dev/crypto` ekranı hazır; telefonda ölçüm bekleniyor (Node: medyan 0,46 ms)           |

### Yapılanlar

- `packages/crypto`: cihaz anahtarları (DH anahtarı kimlikle imzalı), sender key dağıtımı, mesaj başına
  anahtar (rastgele `salt` ile), tekrar penceresi, bildirim sealed box'ı, güvenlik numarası (60 rakam +
  QR), ızgara hassasiyeti, rekey kuralları. Yalnızca `@noble/*` 2.4 ve `@scure/base`.
- `packages/schemas`: içerik birleşimi (`loc`, `bump`, `place_enter/exit`, `share_stop`, `status`) ve
  kablo şemaları (zarf, dağıtım, cihaz paketi).
- `packages/crypto/swift`: çözen taraf (bildirim eklentisi için) CryptoKit ile; TypeScript fixture'larını
  birebir açtığı macOS CI job'u ile doğrulanıyor.
- Mobil: `expo-crypto` ile işletim sistemi CSPRNG'si; geliştirme / önizleme sürümlerinde `/_dev/crypto`
  hız testi ekranı.

### Test sonuçları

- `packages/crypto`: 78 test (RFC vektörleri, fast-check property testleri, tamper, replay, epoch,
  çıkarılan üye, kötü niyetli gönderici, fixture, performans) — %100 kapsam.
- `packages/schemas`: 18 test. Swift: 8 test (Linux'ta swift-crypto ile; CI'da macOS CryptoKit ile).

### Testlerin bulup düzelttiği hatalar

- Hassasiyet ızgarası tarih değiştirme hattında idempotent değildi (property testi buldu) → ızgara artık
  180°/360°'yi tam bölüyor.
- Güvenlik numarasında rakam eşitliğinde iki telefonun farklı QR üretme ihtimali → sıralama tam
  parmak izine göre.
- noble'ın `isValidPublicKey` fonksiyonu küçük mertebeli noktaları kabul ediyor → ek kontrol eklendi.

### Açık riskler

1. Telefonda hız ölçümü henüz yapılmadı; Hermes, Node'dan 10–20 kat yavaş olabilir. Bütçe aşılırsa
   önce Ed25519 ön hesaplaması, sonra native modül değerlendirilir.
2. Epoch içinde ileri gizlilik ve inkâr edilebilirlik yok (bilinçli tercih, THREAT_MODEL.md).
3. Protokol henüz uygulama akışlarına bağlı değil: anahtar saklama (Faz 2), çember ve dağıtım (Faz 4),
   konum gönderimi (Faz 5), bildirim eklentisi (Faz 7).

## Faz 0 — Temel & Güvenlik Altyapısı (2026-10-13)

### DoD

| Madde                                    | Durum | Kanıt                                                                                    |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `pnpm dev` ile api + mobile ayağa kalkar | ✅    | API :3000, Metro :8081; Android ve iOS bundle'ları derleniyor                            |
| CI yeşil                                 | ✅    | CI (format, typecheck, lint, test, build, audit) ve Security (gitleaks, Semgrep, CodeQL) |
| Staging HTTPS üzerinden erişilebilir     | ✅    | Let's Encrypt, sadece TLS 1.3, `/health/live` 200, `/health/ready` dışarıya 404          |
| Dev client Android'e kurulu              | ✅    | EAS build, telefonda "API bağlantısı hazır" görüldü                                      |
| Dev client iPhone'a kurulu               | ⏳    | Ücretli Apple Developer Program üyeliği bekleniyor                                       |

### Yapılanlar

- pnpm 12 + Turborepo monorepo; TypeScript 6 sıkı mod; ESLint 10 (tip bilgili + güvenlik +
  gerekçesiz `eslint-disable` yasağı); Prettier; CLAUDE.md kuralları lint ile zorunlu.
- API (NestJS 12, Fastify): zod env doğrulama, live/ready sağlık kontrolleri, log maskeleme, güvenlik
  başlıkları, CSRF, body limit, zaman aşımları, distroless ve root olmayan imaj.
- Mobil (Expo SDK 57): Expo Router, i18n (tr varsayılan, en), env doğrulama (release'de HTTPS zorunlu).
- Lokal altyapı: Postgres 18, Redis 8, Mailpit (sadece 127.0.0.1).
- Staging: paylaşımlı sunucuda sadece ekleme yapan kurulum; host nginx + certbot; API sadece
  loopback'te; zorunlu komutlu SSH ile deploy, otomatik geri dönüş.
- Sunucu sertleştirme (sahibinin onayıyla): SSH sadece anahtar; fail2ban (Ubuntu 24.04 filtre hatası
  düzeltildi). Sertleştirme öncesi günde ~13.000 şifre denemesi vardı.
- Tedarik zinciri: 24 saat karantina, yayın kanıtı düşüşü engeli, install script izin listesi,
  digest/SHA ile sabitlenmiş imajlar ve Actions, Renovate (7 gün).

### Test sonuçları

- API: 21 test (Vitest) — readiness 503, CSRF 403, body limit 413, log maskeleme, istek kimliği.
- Mobil: 10 test (Jest) — i18n anahtar eşitliği, API adresi kuralları.
- Ek doğrulamalar: gitleaks, Semgrep, CodeQL, actionlint, shellcheck, `nginx -t`, compose config,
  container sağlık kontrolü, gerçek Postgres/Redis ile kesinti ve toparlanma testi, deploy anahtarının
  kabuk / enjeksiyon / yabancı imaj denemelerini reddettiğinin testi, h2c smuggling denemesinin
  engellendiğinin testi.

### Bulunan ve düzeltilen sorunlar

- nginx'te h2c smuggling riski (Semgrep) → yükseltme sadece `websocket`.
- CI'dan çağrılan deploy'a secret gitmiyordu → sadece `STAGING_SSH_KEY` adıyla geçiriliyor; boşsa açık hata.
- `secrets: inherit` en az yetki ilkesine aykırıydı (Semgrep) → kaldırıldı.
- fail2ban hiçbir denemeyi saymıyordu (Ubuntu 24.04 paketi yanlış servis adını dinliyor) → düzeltildi.

### Açık riskler

1. Expo geliştirme araçlarında yaması olmayan 2 yüksek seviye bulgu (node-forge, braces): uygulama
   paketine girmiyor; `pnpm-workspace.yaml`'da gerekçeli istisna. Her Expo güncellemesinde tekrar bak.
2. Expo SDK 57 yamaları provenance olmadan yayınlanıyor (SDK 58 ile değişiyor); 7 günlük bekleme ve
   güven politikası riski sınırlıyor.
3. Paylaşımlı sunucu: `deploy` kullanıcısı docker grubunda (host'ta root eşdeğeri); zorunlu komut CI
   anahtarını sınırlıyor.
4. Staging'de yedek yok (kullanıcı verisi yok); gerçek veriden önce şifreli yedek + geri yükleme testi
   şart (Faz 10).
5. Mevcut geliştirme ağı TLS trafiğine araya giriyor, LAN ve tünel bağlantılarını engelliyor: telefon
   geliştirme sunucusuna bu ağdan bağlanamıyor. Çözüm: `preview` sürümü veya başka bir ağ.
6. sslip.io geçici: Let's Encrypt limiti diğer kullanıcılarla ortak; passkey için gerçek domain şart.

### Kalan işler

| İş                                     | Kim                              | Ne zaman                      |
| -------------------------------------- | -------------------------------- | ----------------------------- |
| iPhone dev client                      | Proje sahibi: Apple üyeliği      | Üyelik gelince (en geç Faz 5) |
| Renovate GitHub App'i kur              | Proje sahibi                     | Önerilir                      |
| Gerçek domain                          | Proje sahibi alır, bağlama bizde | Faz 2'den önce                |
| pnpm 12 + gitleaks (kendi makinesinde) | Proje sahibi                     | Komut çalıştırmak isterse     |

### Takip (tarihli)

- **2026-10-20**: lockfile'daki tüm kayıtlar 7 günü geçince `minimumReleaseAge`'i 10080'e çıkar;
  `trustPolicyExclude` listesini sil (2026-10-13 12:16 UTC'den sonra zaten gereksiz).
- **Expo yamaları** (57.0.28 vb.) olgunlaşınca güncelle; `expo-doctor` temiz olsun.
- **Node 26 LTS** (2026-10-28): araçlar destekleyince geçiş değerlendir.
- `eslint-config-expo` ESLint 10 desteği verince geri al (ADR 0001).
- Expo hesabında hesap genelinde tanımlı `GOOGLE_MAPS_ANDROID_API_KEY` Bargu build'lerine de
  yükleniyor; Bargu kullanmıyor → sadece ilgili projeye kapsamla.
- Geliştirme ve önizleme sürümlerinin telefonda yan yana durabilmesi için ayrı uygulama kimliği
  (`app.bargu.dev`) değerlendir.
