# Proje Durumu

Her faz sonunda güncellenir: ne bitti, nasıl test edildi, açık riskler, kalan işler. Plan:
[BARGU_PLAN.md](../BARGU_PLAN.md) · Kararlar: [docs/ADR](ADR/README.md)

## Özet

| Faz                              | Durum                                         |
| -------------------------------- | --------------------------------------------- |
| Faz 0 — Temel & Güvenlik Altyapı | ✅ Onaylandı (açık madde: iPhone dev client)  |
| Faz 1 — Kripto Çekirdeği         | ✅ Onaylandı (açık madde: cihazda hız ölçümü) |
| Faz 2 — Auth & Cihazlar          | 🔄 Onay bekliyor                              |

## Ortamlar

| Ne                 | Nerede                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Staging API        | `https://api.46-62-162-70.sslip.io` (geçici ücretsiz domain; bkz. ADR 0003)              |
| Staging deploy     | `main`'e her yeşil CI → GHCR imajı → migration → API + işçi (otomatik, sağlık kontrollü) |
| Staging e-posta    | İç ağdaki Mailpit (dışarı açık değil); gerçek aktarıcı domain ile gelecek (ADR 0006)     |
| Expo / EAS projesi | hesap `otenus`, proje `bargu` (`app.config.ts`)                                          |
| Android sürümleri  | `development` (dev client, Metro'ya bağlanır), `preview` (bağımsız, staging'e bağlanır)  |
| Uygulama kimliği   | `app.bargu` (mağazaya çıkınca değiştirilemez)                                            |

## Faz 2 — Auth & Cihazlar (2026-10-13)

Kararlar: [ADR 0005](ADR/0005-auth-and-devices.md) (giriş, cihaz, RLS) ·
[ADR 0006](ADR/0006-jobs-and-notifications.md) (kuyruk ve bildirim) · Protokol eki:
[PROTOCOL.md §12](PROTOCOL.md#12-hesap-yardımcıları-faz-2)

### DoD

| Madde                                           | Durum | Kanıt                                                                                             |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| Auth e2e testleri                               | ✅    | 54 entegrasyon testi, gerçek Postgres + Redis + kuyruk (CI'da ayrı görev)                         |
| Brute-force testi                               | ✅    | 8 haneli kod, cihaza bağlı; 5 yanlışta kod ölür; cihaz ve adres sınırları; eşzamanlı tahmin testi |
| Refresh reuse testi                             | ✅    | Dönmüş token tekrar kullanılınca bütün oturum ailesi iptal + güvenlik olayı                       |
| `app.user_id` set edilmeden sorgu 0 satır döner | ✅    | Her tabloda test; ayrıca `app` şemasında zorlanmış RLS'i olmayan tablo kalırsa test kırılıyor     |

### Yapılanlar

- **Giriş**: e-posta kodu (türetilir, hiçbir yerde saklanmaz), passkey (kayıt + giriş), EdDSA erişim
  token'ı (10 dk), cihaza bağlı ve her kullanımda dönen refresh token.
- **Cihaz**: girişte anahtar paketi + cihazın kendi imzası; hesap başına tek aktif cihaz veritabanında
  zorunlu; yeni cihaz eskisini ve oturumlarını anında iptal ediyor; App Attest ve Play Integrity
  doğrulaması (staging'de isteğe bağlı, production'da zorunlu).
- **İstek imzalama**: durum değiştiren her istek cihaz anahtarıyla imzalı ve tek kullanımlık; imza
  politikası belirtilmemiş bir uç kendiliğinden reddediliyor.
- **Veri minimizasyonu**: e-posta adresi saklanmıyor (anahtarlı özet); IP saklanmıyor; kuyruktaki
  e-posta adresi şifreli.
- **Veritabanı**: sahip rol / uygulama rolü ayrımı, her tabloda zorlanmış RLS, SQL migration'lar
  (değiştirilirse durur), migration adımı ayrı container'da.
- **Kuyruk ve bildirim**: Kafka/RabbitMQ yerine pg-boss (Postgres): iş, veriyle aynı işlemde
  ekleniyor; ayrı işçi container'ı; e-posta SMTP ile (staging'de iç ağdaki Mailpit).
- **Mobil**: cihaz anahtarları güvenli depoda (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, yedeğe gitmez);
  istekleri imzalayan ve token'ı tek seferde yenileyen API istemcisi. Ekranlar Faz 3'te.
- **Kripto paketi**: istek imzası, kod türetme, e-posta özeti, token özeti, sunucuda şifreleme ve JWT
  anahtarı eklendi; API'de `node:crypto` kullanımı lint ile yasak.

### Test sonuçları

| Paket                   | Test | Not                                                              |
| ----------------------- | ---- | ---------------------------------------------------------------- |
| `packages/crypto`       | 118  | %100 satır, ifade, dal, fonksiyon                                |
| `packages/schemas`      | 31   |                                                                  |
| API birim + HTTP        | 65   | env kuralları, hata biçimi, App Attest (test CA), Play Integrity |
| API entegrasyon         | 54   | giriş, brute-force, oturum, tek cihaz, RLS, passkey, onay, işçi  |
| Mobil                   | 21   | anahtar deposu, imzalı istemci, token yenileme, saat düzeltme    |
| Swift (CryptoKit uyumu) | 10   |                                                                  |

Ek doğrulamalar:

- Semgrep (CI kural setleriyle) temiz.
- Mutasyon testleri: imza doğrulaması ve yanlış deneme hakkı ayırma bilerek kapatılınca testler
  kırıldı.
- Derlenmiş API + işçi ile uçtan uca deneme: kod isteği → kuyruk → işçi → Mailpit'e e-posta. İlk
  denemede yanlış SMTP portu yüzünden gitmeyen iş, tekrar denemeyle teslim edildi.

### Bağımsız güvenlik incelemesi (kapanış kontrolü)

Kod, ayrı bir inceleyiciyle saldırgan gözüyle tarandı; iki bulgu canlı test sunucusuna karşı deneme
testiyle doğrulandı. Kritik bulgu yok; token, RLS, oturum dönüşümü ve tek cihaz kuralı sağlam çıktı.

| Bulgu                                                                                     | Önem  | Durum                                                                               |
| ----------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| Eşzamanlı yanlış kodlarla kilit aşılabiliyordu; IPv6'da her adres ayrı sayılıyordu        | Orta  | ✅ Hak, kod karşılaştırılmadan önce tek adımda ayrılıyor; IPv6 /64; 8 hane          |
| Herkes bir adresin yanlış deneme hakkını harcayıp sahibini kilitleyebiliyordu             | Orta  | ✅ Kod isteyen cihaza bağlı; hak (adres, cihaz) başına; adres için günlük üst sınır |
| Giriş öncesi bazı uçlarda istek sınırı yoktu (Redis doldurma, Google kotası)              | Orta  | ✅ İstemci ağı başına sınır; doğrulama sınırı pahalı kontrollerden önce             |
| JSON dışı gövdeler imzanın dışında kalabiliyordu                                          | Düşük | ✅ Yalnızca JSON (415) + imzasız gövde reddi                                        |
| `NODE_ENV=production` ama `APP_ENV` yoksa geliştirme ayarları devreye giriyordu           | Düşük | ✅ Production'da `APP_ENV` zorunlu                                                  |
| Silinmekte olan hesabın adresiyle giriş 500 dönüyordu                                     | Düşük | ✅ `ACCOUNT_UNAVAILABLE`                                                            |
| Deploy betiği çekilemeyen imajı geri dönüş hedefi yapabiliyordu                           | Düşük | ✅ İmaj ancak çekilip migration geçince kaydediliyor                                |
| Saat farkı "geçersiz imza" görünüp oturumu kapatıyordu; Google kesintisi "geçersiz cihaz" | Bilgi | ✅ `CLOCK_SKEW` + istemci düzeltmesi; kesintide 503                                 |
| IP özeti anahtarsızdı; migration şifreyi her çalışmada gönderiyordu; aynı passkey 500     | Bilgi | ✅ Anahtarlı takma ad; şifre yalnızca gerektiğinde; 409                             |

### Açık riskler

1. **Platform doğrulaması gerçek cihazla denenmedi**: Apple Developer ve Google Play Console hesabı
   yok. Doğrulayıcılar Apple'ın belgelenen biçimiyle üretilmiş test zinciri ve sahte Google
   yanıtlarıyla test edildi; staging'de `optional`.
2. **Gerçek e-posta teslimi yok**: domain ve aktarıcı (Scaleway önerisi) gelene kadar staging kodları
   sunucudaki Mailpit'e gidiyor; telefondan giriş ancak kodu oradan okuyarak denenebilir.
3. **Passkey alan adı geçici** (sslip.io). Gerçek domainde passkey'ler yeniden oluşturulacak (henüz
   kullanıcı yok). Android'de passkey için `assetlinks.json`'a uygulamanın imza parmak izi
   eklenmeli (`ANDROID_CERT_SHA256`).
4. **İşçinin sağlık kontrolü yok** (HTTP sunucusu yok); kuyruk metrikleri ve alarmlar Faz 10'da.
5. **E-posta ile girişte kasıtlı engelleme hâlâ mümkün**: çok sayıda cihaz anahtarıyla bir adrese günde 50 yanlış
   kod denenirse adres 24 saat kilitlenir (tahmini sınırlamanın bedeli). Production'da her cihaz
   anahtarı gerçek bir telefonla onaylanmak zorunda; passkey'li kullanıcılar etkilenmez.
6. **Yoğun saldırıda Redis belleği** (staging 256 MB, `noeviction`): dağıtık bir saldırı giriş öncesi
   uçlarla belleği doldurabilir; CDN/WAF ve ölçekli sınırlar Faz 10'da.
7. İşçi container'ı kullanmadığı bazı anahtarları da alıyor (aynı ortam dosyası); Faz 10'da ayrılacak.
8. Mobil bağımlılıklarda 2 orta seviye bulgu (`uuid` Expo derleme araçlarında, `decode-uri-component`
   `expo-router` içinde); yüksek/kritik yok. Expo güncellemelerinde tekrar bakılacak.

### Kalan işler

| İş                                            | Kim                              | Ne zaman                 |
| --------------------------------------------- | -------------------------------- | ------------------------ |
| Gerçek domain                                 | Proje sahibi alır, bağlama bizde | Faz 3 (passkey ekranı)   |
| E-posta aktarıcısı hesabı (Scaleway TEM)      | Proje sahibi (ödeme/kimlik)      | Domain ile birlikte      |
| Apple Developer Program / Google Play Console | Proje sahibi                     | En geç Faz 5             |
| Android imza parmak izini staging'e ekle      | Bizde                            | Faz 3, passkey ekranında |

## Faz 1 — Kripto Çekirdeği (2026-10-13)

Protokol: [PROTOCOL.md](PROTOCOL.md) · Tehdit modeli: [THREAT_MODEL.md](THREAT_MODEL.md) · Kararlar:
[ADR 0004](ADR/0004-e2ee-protocol.md)

### DoD

| Madde                                  | Durum | Kanıt                                                                                                |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| Test vektörleri geçer                  | ✅    | RFC 7748 (X25519), 8032 (Ed25519), 8439 (ChaCha20-Poly1305), 5869 (HKDF) — RFC metninden             |
| `packages/crypto` %100 satır coverage  | ✅    | Satır, ifade, dal ve fonksiyon %100 (CI'da eşik olarak zorunlu)                                      |
| Tamper / replay / epoch testleri yeşil | ✅    | Tek bit değişikliği (property), tekrar ve eski `seq`, yanlış epoch/çember/gönderen                   |
| Cihazda şifreleme < 5 ms               | ⏳    | Saf JS ile Android'de p95 6,70 ms (geçmedi) → yerel eğri işlemleri (ADR 0007), yeni ölçüm bekleniyor |

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

- `packages/crypto`: 84 test (RFC vektörleri, fast-check property testleri, tamper, replay, epoch,
  çıkarılan üye, kötü niyetli gönderici, fixture, performans) — %100 kapsam.
- `packages/schemas`: 21 test. Swift: 10 test (Linux'ta swift-crypto ile; CI'da macOS CryptoKit ile).

### Bağımsız güvenlik incelemesi (kapanış kontrolü)

Faz kapanmadan önce kripto kodu ayrı bir inceleyiciyle saldırgan gözüyle tarandı. Bulgular ve durum:

| Bulgu                                                                                                   | Önem   | Durum                                                                |
| ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Tekrar koruması çemberi ayırt etmiyordu: bir çemberdeki yeni epoch, diğerinde eski mesajı geri açıyordu | Yüksek | ✅ Düzeltildi: `(çember, gönderen)` başına durum + iki çember testi  |
| Epoch tabanı yoktu: sunucu eski bir epoch'un mesajlarını yeniden gönderebilirdi                         | Orta   | ✅ Düzeltildi: N − 2 ve öncesi reddedilir                            |
| Sırası karışan olaylar (ör. `place_enter`) sessizce düşüyordu                                           | Düşük  | ✅ Düzeltildi: 64'lük kayan pencere; eski konum `STALE`              |
| Zarf boyutu hassasiyet seviyesini ve hareketi sızdırıyordu                                              | Düşük  | ✅ Düzeltildi: tüm mesajlar tek boy (512 bayt); `acc` yuvarlanıyor   |
| Swift tarafı UUID / bilinmeyen alan / `ct` boyutunda TypeScript kadar katı değildi                      | Düşük  | ✅ Düzeltildi + Swift testleri                                       |
| CryptoKit küçük mertebeli Ed25519 anahtarlarını reddetmiyor                                             | Düşük  | Belgelendi: eklenti yalnızca TS ile doğrulanmış anahtarları kullanır |
| Bildirim eklentisinin tekrar durumu, değişen kimlik anahtarına otomatik dağıtım                         | Bilgi  | Faz 4 ve Faz 7 kalan işlerine eklendi                                |

### Testlerin bulup düzelttiği hatalar

- Hassasiyet ızgarası tarih değiştirme hattında idempotent değildi (property testi buldu) → ızgara artık
  180°/360°'yi tam bölüyor.
- Güvenlik numarasında rakam eşitliğinde iki telefonun farklı QR üretme ihtimali → sıralama tam
  parmak izine göre.
- noble'ın `isValidPublicKey` fonksiyonu küçük mertebeli noktaları kabul ediyor → ek kontrol eklendi.

### Açık riskler

1. İlk telefon ölçümü bütçeyi aştı (saf JS, Hermes): şifreleme p95 6,70 ms, doğrulama + çözme 15 ms,
   anahtar dağıtımı 22 ms. Ed25519/X25519 artık telefonda yerel (CryptoKit / Tink, öz testli; ADR
   0007); yeni build ile ölçülecek. iOS tarafı Apple hesabı gelene kadar derlenemiyor.
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
- **Faz 4:** anahtar deposu mevcut epoch'tan eski dağıtımı reddetsin; kimlik anahtarı değişen üyeye
  sender key, kullanıcı uyarıyı onaylayana kadar otomatik dağıtılmasın.
- **Faz 7:** iOS bildirim eklentisi tekrar korumasını (`ReplayGuard` durumu) uygulamayla uygulama
  grubu üzerinden paylaşsın.
