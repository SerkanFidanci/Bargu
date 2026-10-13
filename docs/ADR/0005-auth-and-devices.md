# 0005. Giriş, cihazlar ve satır bazlı yetki

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

BARGU_PLAN §3.2 ve Faz 2: e-posta kodu (OTP) + passkey, EdDSA JWT + dönen refresh token, cihaz kaydı
ve platform doğrulaması (App Attest / Play Integrity), istek imzalama, hesap başına tek aktif cihaz,
Postgres satır bazlı yetki (RLS). Planın bıraktığı ayrıntılar ve bazı yerlerde daha güvenli
alternatifler uygulama sırasında netleştirildi.

## Karar

### Hesap ve e-posta

- **E-posta adresi saklanmaz.** `users` tablosunda yalnızca sunucu anahtarıyla alınmış HMAC-SHA256
  özeti (`email_hmac`) var. Kullanıcı adresini yazınca hesap bulunur; anahtar olmadan sızan bir
  veritabanından adres çıkmaz (veri minimizasyonu, KVKK). Bedeli: sunucu kullanıcıya kendiliğinden
  e-posta atamaz (gerekmiyor; bildirimler push ile).
- **OTP kodu türetilir, saklanmaz.** Plan "argon2 hash" diyordu. Kod, meydan okuma kimliğinden sunucu
  anahtarıyla türetilir (HOTP benzeri: HMAC-SHA256, 48 bit mod 10⁶). Veritabanında, Redis'te ve iş
  kuyruğunda ne kod ne kodun özeti bulunur; 6 haneli bir kodun argon2 özeti bile çevrimdışı denemeyle
  kırılabilirdi, anahtarsız türetme kırılamaz. Ayrıca her doğrulamada pahalı argon2 hesabı olmadığı
  için CPU tüketme saldırısına açık değil.
- Meydan okuma Redis'te 10 dakika yaşar; 5 yanlış denemede ölür; aynı adrese saatte 10 yanlış
  denemede adres 1 saat kilitlenir; adres ve IP başına istek sınırları var. Yanıt, hesap var da olsa
  yok da olsa aynıdır (hesap avı yapılamaz). Kod tek kullanımlıktır (eşzamanlı iki doğru denemeden
  yalnızca biri kazanır).

### Cihaz, imza ve oturum

- **Giriş = hesap kanıtı + cihaz kaydı**, tek işlemde. Yeni cihaz anahtar paketini (Faz 1) gönderir
  ve isteği kendi kimlik anahtarıyla imzalar (anahtara sahip olduğunu kanıtlar).
- **Tek aktif cihaz veritabanında zorunlu**: `devices(user_id) WHERE revoked_at IS NULL` üzerinde
  benzersiz indeks. Yeni cihazla giriş eski cihazı ve tüm oturumlarını iptal eder, güvenlik olayı
  yazar. İptal edilen bir cihaz kimliği asla geri gelmez (uygulama yeni anahtar üretir).
- **İstek imzası**: `x-bargu-sig` = Ed25519(etiket ‖ yöntem ‖ yol+sorgu ‖ zaman ‖ nonce ‖ cihaz ‖
  SHA-256(gövde)), uzunluk önekli ve belirsizliksiz (PROTOCOL.md §12). Plana ek olarak **16 baytlık
  nonce** var ve sunucu her nonce'u bir kez kabul eder; böylece ±60 sn pencere içinde bile yakalanan
  bir istek tekrar oynatılamaz. Durum değiştiren **her** istek imzalıdır; imzasız olabilecek az
  sayıdaki herkese açık uç açıkça işaretlenir, işaretlenmemiş olan reddedilir (güvenli varsayılan).
- **Erişim token'ı**: EdDSA JWT, 10 dk, `kid` ile anahtar değişimi (önceki açık anahtar geçiş
  süresince kabul edilir). Token tek başına yetmez: her istekte cihazın ve oturumun hâlâ geçerli
  olduğu veritabanından kontrol edilir; çıkış, cihaz değişimi veya hırsızlık tespiti bir sonraki
  istekte etkili olur.
- **Refresh token**: 256 bit, yalnızca SHA-256 özeti saklanır, her kullanımda döner, cihaza bağlıdır
  (kullanmak için cihaz imzası gerekir). Dönmüş bir token tekrar kullanılırsa **ailenin tamamı**
  iptal edilir. İstisna: mobil ağda yanıt kaybolduğunda istemci aynı token'la 30 sn içinde tekrar
  dener ve halef hiç kullanılmamışsa bu bir tekrar denemedir; zincir oradan bir kez devam eder (Auth0
  "reuse interval" benzeri). Cihaz imzası zorunlu olduğu için çalınan bir token bu pencereyi
  kullanamaz.

### Passkey ve platform doğrulaması

- Passkey: keşfedilebilir kimlik bilgisi, kullanıcı doğrulaması zorunlu, kullanıcı tanıtıcısı =
  hesap kimliği. Giriş, hesap kimliğini tanıtıcıdan alıp o hesabın RLS'i altında kimlik bilgisini
  arar; sahte tanıtıcı hiçbir şey bulamaz. Kütüphane: `@simplewebauthn/server`.
- App Attest: Apple'ın 9 adımlık doğrulaması; kök sertifika koda gömülü ve parmak iziyle sabit.
  Doğrulanan veri SHA-256(sunucu meydan okuması ‖ cihaz kimlik anahtarı): onay "bir gerçek uygulama"
  için değil, **bu cihaz anahtarı** için verilir. Play Integrity: Google'ın sunucu tarafı çözümü, paket,
  imza sertifikası, tazelik ve cihaz bütünlüğü kontrolü.
- `DEVICE_ATTESTATION`: `required` (production'da zorunlu, env doğrulaması başka değere izin vermez),
  `optional` (staging: mağaza hesapları yokken), `off`. Gönderilmiş ama geçersiz bir onay her modda
  reddedilir. Meydan okuma başarılı girişte tüketilir (App Attest bir anahtarı yalnızca bir kez
  onaylayabildiği için yanlış kod sonrası tekrar denemede aynı onay kullanılabilir).

### Veritabanı ve RLS

- İki rol: `bargu_owner` (NOLOGIN, tabloların sahibi, migration'lar `SET ROLE` ile onunla çalışır) ve
  `bargu_app` (API ve işçinin tek rolü: hiçbir şeye sahip değil, `NOBYPASSRLS`, sütun düzeyinde
  sınırlı yetki). Süper kullanıcı bilgisi yalnızca tek seferlik migration adımında bulunur.
- Kullanıcıya ait her tabloda RLS açık ve **FORCE**; politika `user_id = app.current_user_id()`.
  `app.user_id` yalnızca işlem içinde ayarlanır (`set_config(…, true)`), havuzdaki bağlantıya
  sızmaz; ayarlanmadan yapılan her sorgu 0 satır döner (Faz 2 DoD, testle kanıtlı). `app` şemasında
  zorlanmış RLS'i olmayan bir tablo varsa test kırılır.
- Kullanıcılar arası tek okuma: `app.user_id_for_email(hmac)` (SECURITY DEFINER), yalnızca anahtarlı
  özetle, yalnızca kimlik döndürür. Passkey ve refresh token akışları kullanıcı kimliğini token'dan
  veya tanıtıcıdan alıp RLS altında çalışır; kullanıcılar arası arama gerektirmez.
- Migration'lar sıralı SQL dosyaları (`apps/api/migrations`), sağlama toplamıyla kayıtlı; çalışmış bir
  migration değiştirilirse adım durur. Drizzle şeması yazım içindir; SQL ile sütun sütun eşleştiği
  testle kontrol edilir. `drizzle-kit` kullanılmadı: RLS, FORCE, rol yetkileri ve SECURITY DEFINER
  düz SQL'de açık ve incelenebilir; ayrıca üç ayrı esbuild sürümü dahil ağır bir geliştirme bağımlılığı
  zinciri gelmedi.

### Kriptografi kuralı

"Kripto kodu sadece packages/crypto'da" kuralı lint ile zorunlu (API'de `node:crypto` içe aktarılamaz).
İstek imzası, OTP türetme, e-posta özeti, token özeti, sunucuda saklanan verinin şifrelenmesi ve JWT
anahtarı `packages/crypto`'da, %100 testli. Standart protokoller kendi referans kütüphaneleriyle
doğrulanır (JWT: `jose`, WebAuthn: `@simplewebauthn/server`, X.509: `@peculiar/x509`); bunlar Web
Crypto kullanır, kendi primitive'imiz yoktur.

## Sonuçlar

- Mobil taraf girişte cihaz anahtarlarını üretip saklamalı ve her durum değiştiren isteği
  imzalamalı (Faz 3 ekranlarıyla birlikte).
- Gerçek App Attest ve Play Integrity yanıtlarıyla uçtan uca deneme, Apple Developer ve Google Play
  Console hesapları açılınca yapılacak; doğrulayıcılar şimdilik test sertifika zinciri ve sahte
  Google yanıtlarıyla test edildi.
- Passkey için alan adı şart; şimdilik staging alan adı kullanılıyor, gerçek alan adına geçişte
  eski passkey'ler geçersiz olur (henüz kullanıcı yok).
- `EMAIL_LOOKUP_KEY` asla değiştirilmemeli (hesaplar ona göre bulunur); diğer anahtarlar
  döndürülebilir.
