# Bargu — Sıfırdan Geliştirme Planı

> Claude Code için ana referans. Fazları sırayla uygula. Her faz sonunda **dur**: değişiklik özeti, test sonuçları ve açık riskleri raporla, onay bekle.

---

## 0. Ürün

Arkadaşlar ve aile ile canlı konum paylaşımı. **Zenly hissi, Signal güvenliği.**

- Konum verisi **uçtan uca şifreli (E2EE)**. Sunucu hiçbir zaman düz koordinat görmez.
- Map-first, tek ana ekran, animasyon dolu, her aksiyon en fazla 2 dokunuş.
- iOS + Android. Dil: tr (varsayılan) + en (i18n).
- Ücretli ürün: ilk günden gelir; reklam ve konum verisi satışı yok (Bölüm 1, Faz 9B).

Pazar araştırması (2026-10-15): [Bargu — Sektör ve Rakip Analizi](https://claude.ai/code/artifact/0cb450e2-0c22-412b-99a9-6be834654dc8). Faz 9, 9B ve 11'deki ürün ve para maddeleri bu rapordan gelir.

---

## 1. Temel Kararlar

| Konu | Karar | Neden |
|---|---|---|
| Gizlilik modeli | E2EE, çember başına sender keys | Sunucu ele geçse bile konum sızmaz |
| Kripto primitive'leri | X25519, Ed25519, HKDF-SHA256, ChaCha20-Poly1305 (RFC 8439) | iOS CryptoKit ile birebir uyumlu (Notification Service Extension'da çözme) |
| Kripto lib (TS) | `@noble/curves`, `@noble/ciphers`, `@noble/hashes` + `expo-crypto` (RNG polyfill) | Audit'li, saf TS; client, server ve testler aynı kodu kullanır |
| Sosyal model | Her şey çember. 1:1 arkadaşlık = 2 kişilik `pair` çember | Tek kavram, tek kod yolu |
| Cihaz | Hesap başına 1 aktif cihaz | Multi-device E2EE karmaşıklığından kaçınma |
| Auth | Passkey (birincil) + email OTP (fallback). Telefon no ve rehber yükleme YOK | SIM swap riski yok, veri minimizasyonu |
| Arkadaş ekleme | Kullanıcı adı, QR, tek kullanımlık davet linki | Rehber gerekmez |
| Mobil | Expo (dev client, New Architecture, Hermes) + Expo Router + TS strict | — |
| Arkaplan konum | `react-native-background-geolocation` (Transistorsoft), kendi HTTP sync'i kapalı | Kategorinin kırılma noktası pil + güvenilirlik. Android release için ücretli lisans |
| Harita | MapLibre RN + self-host Protomaps (PMTiles) | 3. parti tile sağlayıcısına viewport (= konum) sızmaz |
| Reverse geocoding | Cihazda veya self-host Photon | Koordinat 3. partiye gitmez |
| Animasyon | Reanimated 4, Gesture Handler, Skia, Rive, expo-haptics | UI thread'de 60/120 fps |
| Backend | NestJS (Fastify) + PostgreSQL + Drizzle + Redis + BullMQ + Socket.io (Redis adapter) | — |
| Gerçek zamanlı | Tek kalıcı WebSocket; tüm durum değişiklikleri sunucudan push; event stream + resume. Polling / yenileme / kapat-aç YOK | Her şey herkeste anında |
| Konum saklama | Canlı konum: yalnızca Redis, şifreli zarf, TTL 24 saat. Geçmiş: yalnızca paylaşan açtıysa, telefonda şifrelenmiş parçalar Postgres'te 14 gün (ADR 0019). Düz koordinat hiçbir yerde YOK | Sunucu ele geçse bile okunacak konum yok; geçmiş kısa ve isteğe bağlı |
| Push | FCM v1 + APNs direkt (Expo push servisi değil), payload şifreli | 3. parti bağımlılığı azaltma |
| Yerel cache | MMKV (şifreli, anahtar SecureStore'da) | — |
| Monorepo | pnpm + Turborepo | — |
| Gelir | "Kuran öder" (karar 2026-10-15): bir çember, üyelerinden biri Bargu+ abonesi ya da denemedeyse çalışır; davetle katılmak hep bedava. Tek abonelik (Bargu+) + tek seferlik paketler. Reklam ve konum verisi satışı YOK. Acil durum özellikleri hep bedava (Faz 9B) | Zenly gelirsiz kaldığı için kapandı. Ödeme duvarı kurulum başına yaklaşık 8 kat gelir getirir, bedava katılım davet döngüsünü korur. E2EE ile konum satmak zaten imkânsız, reklam güven vaadiyle çelişir |
| Yayın sırası | Önce Android (Google Play), iOS sonra (Apple üyeliği alınınca; karar 2026-10-15). iOS kodu ve CI derlemesi bu arada bozulmadan sürer | Türkiye'de telefonların ~%77'si Android. Google Play bir kerelik 25 dolar, Apple Developer Program yıllık 99 dolar |

> MLS (RFC 9420) v2'de değerlendirilir. ≤50 kişilik çemberler için sender keys yeterli.

---

## 2. Tehdit Modeli (özet → `docs/THREAT_MODEL.md`)

**Varlıklar:** konum, sosyal graf, kimlik anahtarları, oturum token'ları.

| Saldırgan | Önlem |
|---|---|
| Meraklı / ele geçirilmiş sunucu, admin | E2EE; sunucu sadece ciphertext + public key görür; güvenlik numarası (QR) ile MITM tespiti |
| Takipçi (kontrolcü partner, aile üyesi) | Gizli paylaşım imkansız; yeni izleyicide bildirim; periyodik "X kişi seni görüyor" hatırlatması; tek dokunuşla durdur; "Görenler" her an ekranda |
| Çalınan telefon | Anahtarlar Keychain/Keystore'da; opsiyonel biyometrik kilit; email OTP ile uzaktan cihaz iptali → rekey |
| Ağ saldırganı | TLS 1.3, SPKI pinning (2 yedek pin), istek imzalama |
| Bot / sahte istemci | App Attest + Play Integrity, rate limit |
| Tedarik zinciri | Lockfile, Renovate, audit, Semgrep, gitleaks, OTA kod imzalama |
| Tile / geocoding sağlayıcısı | Self-host |

**Kabul edilen sızıntı:** sunucu metadata görür (kim hangi çemberde, ne sıklıkla güncelleme gönderiyor). Belgelenir.

---

## 3. Mimari

```
apps/
  mobile/         Expo
  api/            NestJS
packages/
  crypto/         E2EE protokolü (saf TS, tam test)
  schemas/        zod şemaları (REST, WS, şifreli payload)
  config/         eslint, tsconfig, prettier
docs/
  THREAT_MODEL.md  PROTOCOL.md  MOTION.md  ADR/
infra/
  docker-compose.yml  caddy/  tiles/
```

### 3.1 E2EE Protokolü (`packages/crypto`)

- **Cihaz anahtarları:** `identityKey` (Ed25519), `dhKey` (X25519). Private key'ler `expo-secure-store`'da, `keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (telefon kilitliyken arkaplan görevinin okuyabilmesi için şart). iOS NSE ile ortak Keychain access group.
- **Sender key:** her çemberde her üye cihazın `epoch` numaralı 32 byte `senderKey`'i var.
- **Dağıtım:** her alıcıya ayrı zarf → X25519(ephemeral, recipient.dhKey) → HKDF → ChaCha20-Poly1305; gönderen Ed25519 ile imzalar. Sunucu sadece taşır.
- **Mesaj anahtarı:** `HKDF(senderKey, info = "bargu/v1/msg" ‖ circleId ‖ epoch ‖ seq)` → 32B key + 12B nonce. Paket kaybına dayanıklı, O(1).
- **Rekey (epoch++):** üye ekleme/çıkarma, cihaz değişimi, her 24 saatte bir.
- **Zarf:**
  ```ts
  { v: 1, circleId, epoch, senderDeviceId, seq, ct, sig }
  // AAD = header (v, circleId, epoch, senderDeviceId, seq)
  // sig = Ed25519(header ‖ ct)
  ```
- **Payload** (zod discriminated union, `kind`): `loc {lat,lng,acc,spd?,hdg?,bat,chg,ts}`, `bump`, `place_enter`, `place_exit`, `share_stop`, `status`.
- **Replay:** alıcı `(senderDeviceId, epoch)` başına son `seq`'i tutar, eski/tekrar reddedilir. Sunucu imzayı ve gönderenin üyeliğini doğrular.
- **Hassasiyet:** şifrelemeden ÖNCE gönderen cihazda. Tam / Mahalle (~1 km grid) / Şehir (~10 km grid). Rastgele gürültü değil grid snap (ortalama alınarak gerçek konum bulunamasın).
- **Güvenlik numarası:** iki identity key'in SHA-256 fingerprint'i → 60 haneli sayı + QR. Key değişince çemberde uyarı.
- **Push payload:** alıcı cihaz başına sealed box (X25519 + HKDF + ChaCha20-Poly1305). iOS: NSE'de CryptoKit ile çözülür. Android: data-only FCM, headless JS çözer.
- **Test:** RFC 7748 / 8032 / 8439 test vektörleri, fast-check property testleri, tamper / replay / yanlış epoch testleri, Swift ile cross-impl fixture testi.

### 3.2 Backend (`apps/api`)

**Modüller:** auth, devices, users, circles, invites, keys, relay (WS), push, places, safety.

**Tablolar:**
```
users(id uuidv7, username unique, display_name, avatar_url, created_at, deleted_at)
devices(id, user_id, platform, identity_pub, dh_pub, push_token, attested_at, last_seen, revoked_at)
circles(id, kind pair|friends|family|event, name, epoch, expires_at, created_by)
circle_members(circle_id, user_id, role owner|member, status invited|active|left, joined_at)
key_envelopes(circle_id, epoch, sender_device_id, recipient_device_id, ciphertext, created_at)
invites(id, circle_id, token_hash, expires_at, max_uses, used_count, created_by)
places(id, circle_id, ciphertext, updated_at)          -- geofence tanımı şifreli
refresh_tokens(id, device_id, family_id, token_hash, expires_at, revoked_at)
security_events(user_id, type, ip_hash, created_at)
```

- **Postgres RLS:** her istekte transaction içinde `set_config('app.user_id', …)`. App rolü tablo sahibi değil, RLS bypass yok.
- **Redis:** `loc:{circleId}:{deviceId}` → son zarf (TTL 24s), presence, rate limit, Socket.io adapter, BullMQ. ACL + TLS (prod).
- **WS:** handshake'te access token + cihaz imzası; her `publish`'te üyelik kontrolü; max 1 publish / 2 sn / cihaz; payload max 2 KB.
- **Auth:**
  - Email OTP: 6 hane, 10 dk geçerli, argon2 hash, 5 hatalı denemede kilit, email + IP rate limit.
  - Passkey: associated domains + `assetlinks.json`.
  - Access token: EdDSA JWT, 10 dk. Refresh: opak, her kullanımda rotate, reuse tespitinde tüm aile iptal.
  - Hassas istekler cihaz identity key'iyle imzalı: `x-bargu-sig = sign(method ‖ path ‖ ts ‖ sha256(body))`, ±60 sn tolerans.
  - Cihaz kaydında App Attest / Play Integrity doğrulaması.
  - Yeni cihaz girişi → eski cihaz revoke + tüm çemberlerde rekey + "cihaz değişti" olayı.
- **BullMQ işleri:** push fanout, davet süre dolumu, event çember kapanışı, hesap silme.
- **Sertleştirme:** helmet, CORS kapalı, body limit, timeout, pino log redaction (lat, lng, token, push token, email).

### 3.3 Mobil (`apps/mobile`)

- **State:** Zustand (UI) + TanStack Query (API) + şifreli MMKV.
- **Konum motoru:**
  - Frekans tablosu:

    | Durum | Gönderim |
    |---|---|
    | Biri seni haritada izliyor (canlı mod) | 1 sn |
    | Arkaplanda hareket halinde | 5 sn veya 10 m |
    | Durağan | Konum değişmediği için gönderim yok; 5 dk'da bir heartbeat (pil, aktiflik) |

  - **Canlı mod:** izleyen kişi haritayı açınca client `watch` olayı yollar → sunucu hedef cihaza WS ile (bağlı değilse silent push ile) iletir → hedef 1 sn frekansa geçer. İzleyen ekranda kaldıkça her 60 sn yenilenir, ayrılınca 2 dk sonra normale döner. Kimse bakmıyorsa pil harcanmaz. (iOS'ta silent push best-effort; hareket halindeyken arkaplan takibi zaten aktif olduğu için WS yolu çalışır.)
  - Akış: konum → çember başına bulanıklaştır → şifrele → WS publish. Offline'da sadece en son konum kuyrukta.
  - Alıcı: imza doğrula → çöz → güncellemeler arası interpolasyon (hız + yön ile dead reckoning, max 10 sn) → avatarlar akıcı kayar.
- **İzinler:** önce "Kullanırken"; "Her zaman" sadece kullanıcı paylaşımı açınca, öncesinde animasyonlu açıklama ekranı (Google Play prominent disclosure şartı).
- Güvenlik numarası ve hassas ekranlarda screenshot engeli (`expo-screen-capture`).

### 3.4 Gerçek Zamanlı Senkron

Kural: kullanıcı **hiçbir zaman** yenileme, pull-to-refresh veya uygulamayı kapat-aç yapmak zorunda kalmaz.

- **Tek kalıcı WS bağlantısı** (Socket.io, `transports: ['websocket']` → sticky session gerekmez, msgpack parser). REST sadece ilk yükleme ve mutasyonlar için.
- **Her şey push:** konum, üyelik değişimi, davet kabulü, hayalet modu, durum, yerler, cihaz/key değişimi, profil güncellemesi.
- **Event stream:** kullanıcı başına Redis Stream `ev:{userId}` (24 saat saklama). Her olayın monoton `eventId`'si var. Client son `eventId`'yi MMKV'de tutar; reconnect'te `resume(lastEventId)` → kaçırılanlar replay edilir; stream dışına düşmüşse otomatik full snapshot.
- **Konum** last-write-wins: stream'e yazılmaz; `loc:` key + Redis pub/sub fanout. Reconnect'te son zarflar snapshot olarak gelir.
- **Client cache:** TanStack Query cache'i WS olaylarıyla doğrudan güncellenir (`setQueryData`), refetch yok. Mutasyonlar optimistic + server ack, hata olursa rollback + toast.
- **Bağlantı yönetimi:** AppState foreground → anında reconnect + resume; NetInfo değişince reconnect; exponential backoff + jitter (max 10 sn); 20 sn heartbeat. Bağlantı koparsa üstte ince animasyonlu "Bağlanıyor…" çizgisi (modal/blok yok, eski veri gri gösterilir).
- **Hedef gecikme:** gönderen cihaz → alıcı ekranı p95 < 500 ms; sunucu relay p95 < 50 ms.
- Ölçekleme: Socket.io Redis adapter ile yatay; tek VPS ilk binlerce kullanıcı için yeterli (sunucu sadece şifreli relay).

### 3.5 Geliştirme Ortamı & Altyapı (Mac'siz)

- **Geliştirme makinesi:** mevcut Linux/PC. Android: emulator + gerçek Android cihaz.
- **iOS build:** Mac gerekmez → **EAS Build** iOS'u bulutta derler. Expo Go kullanılmaz, dev client build.
- **Apple Developer Program** (yıllık ücretli) şart: cihaza kurulum, APNs key, TestFlight, App Attest, associated domains.
- **Fiziksel iPhone şart:** arkaplan konum, push/NSE, App Attest simulator'da test edilemez (simulator zaten Mac ister). İkinci el **iPhone 12 veya üstü** yeterli.
- **iOS akışı:** EAS internal distribution (UDID kayıtlı) ile dev client kur → JS değişiklikleri Metro üzerinden anında (aynı Wi-Fi veya `--tunnel`). Sadece native değişiklikte yeni EAS build.
- **Swift NSE:** Linux'ta yazılır, EAS'ta derlenir. Native debug gerekirse sadece o gün için saatlik kiralık bulut Mac.
- **Sunucu:** fiziksel makine alma, **1 VPS kirala** → Hetzner CX33 / CAX21 sınıfı (4 vCPU, 8 GB). Dev/staging + ilk beta için yeterli.
  - Docker Compose: api, postgres, redis, caddy (otomatik TLS), tiles.
  - **Domain şart:** passkey, universal links / app links ve `apple-app-site-association` HTTPS domain ister. Örn: `api.bargu.app`, `tiles.bargu.app`.
  - Firewall: sadece 80/443 + SSH (key-only, root login kapalı, fail2ban). Postgres/Redis dışarı açık değil.
  - Günlük şifreli yedek → Hetzner Storage Box / S3 uyumlu depolama.
- **Lokal geliştirme:** kendi makinende `docker compose up`; telefon aynı ağda. Staging'e deploy GitHub Actions ile (main → staging).

---

## 4. UI / UX

### 4.1 Prensipler
1. **Harita her şeydir.** Tek ana ekran, geri kalan her şey bottom sheet.
2. Her aksiyon **≤ 2 dokunuş**.
3. **Gizlilik görünür:** kim seni görüyor, ne kadar hassas — her an ekranda.
4. Her etkileşimin animasyonu + haptic'i var. Hiçbir animasyon kullanıcıyı 400 ms'den fazla bekletmez.
5. Reduce Motion açıksa animasyonlar fade'e düşer (`useReducedMotion`).
6. Dynamic Type, VoiceOver/TalkBack etiketleri, kontrast AA.
7. Her UI fazında 3 kişiyle 5 dk kullanılabilirlik testi.

### 4.2 Motion Sistemi (`docs/MOTION.md` + `src/theme/motion.ts`)
```ts
export const spring = {
  snappy: { damping: 20, stiffness: 300, mass: 0.8 },
  bouncy: { damping: 12, stiffness: 180, mass: 1 },
  gentle: { damping: 26, stiffness: 120, mass: 1 },
};
export const duration = { fast: 150, base: 250, slow: 400 };
export const haptic = { select: 'selection', success: 'success', bump: 'heavy' };
```
- Tüm animasyonlar Reanimated worklet ile UI thread'de. JS thread animasyonu yasak.

### 4.3 Ekranlar

**Onboarding**
- 3 interaktif Rive kartı: "Konumun kilitli" (sadece arkadaşlarının anahtarı açar), "Ne kadar görüneceğini sen seç", "İstediğin an kaybol".
- Email → OTP (otomatik dolan kutucuklar, iOS one-time-code autofill) → kullanıcı adı (canlı müsaitlik kontrolü) → avatar → ilk davet.

**Ana Harita**
- Üstte **"Görenler" pill:** avatar yığını + hayalet modu düğmesi.
- Altta 3'lü dock: **Çemberler · Ekle (+) · Ben**.
- **Avatar marker'ları (ambient durum, metin yok):**
  - Hareketli → hız izi (Skia trail)
  - Evde → ev rozeti
  - Şarjda → şimşek; pil < %15 → kırmızı nabız
  - Eski veri → gri + "12 dk"
  - Avatarlar hafifçe "nefes alır" (Skia shader)
- Yakın avatarlar **Skia metaball** efektiyle sıvı gibi birleşip ayrılır (kümeleme).
- Basılı tut → **radyal menü:** Dürt · Yol tarifi · Profil · Bildirimler.
- Gece otomatik koyu harita stili.

**Kişi Sheet'i**
- Marker'dan shared element geçişi; mesafe, son görülme, pil, yer adı (cihazda reverse geocode).

**Dürt & Buluşma**
- Basılı tut-bırak → karşı tarafta haptic + avatar zıplaması (rate limit: 10/dk/çift).
- İki kişi 50 m'den yakınsa "buluştunuz" Skia partikül efekti (sadece ikisi de tam hassasiyetteyse).

**Gizlilik Merkezi**
- Çember başına hassasiyet slider'ı (Tam / Mahalle / Şehir): haritada etrafındaki bulanık daire canlı büyür/küçülür.
- Süreli paylaşım (1 sa / 3 sa / gün sonu): avatarında azalan halka.
- Hayalet modu: harita desatüre olur, avatar hayalete dönüşür (Rive). Seçenek: son konumda dondur / tamamen gizle.
- Aktif cihaz, güvenlik numaraları, paylaşım geçmişi (sadece yerelde).

**Çemberler:** liste, oluştur, event çember (geri sayım halkası).
**Davet:** marka renkli animasyonlu QR + paylaşım linki + QR tarayıcı.
**Yerler:** haritada daireyi parmakla sürükle/büyüt, haptic snap (100 / 250 / 500 m).

### 4.4 Tasarım Sistemi
- Tokenlar: renk (light/dark), tipografi ölçeği, 4'lük spacing grid, radius, gölge.
- Font: Türkçe karakter destekli karakterli bir display font + Inter (body).
- Bileşenler: Button, IconButton, Sheet (`@gorhom/bottom-sheet`), AvatarMarker, AvatarStack, Pill, Slider, Toggle, Toast, EmptyState, Skeleton.
- Dev-only `/_dev/ui` route'unda tüm bileşenler.

---

## 5. Fazlar

### Faz 0 — Temel & Güvenlik Altyapısı
- pnpm + Turborepo monorepo, TS strict, eslint (+ security plugin), prettier.
- Bölüm 6'dan `CLAUDE.md` oluştur.
- `docker-compose`: postgres, redis, mailpit.
- zod ile env doğrulama, `.env.example`; repo'da secret yok.
- CI (GitHub Actions): typecheck, lint, test, gitleaks, Semgrep, CodeQL, `pnpm audit`. Renovate.
- pre-commit: lint-staged + gitleaks.
- VPS kurulumu (Bölüm 3.5): sertleştirme, Docker Compose, Caddy + domain, GitHub Actions ile staging deploy.
- EAS projesi: Android + iOS dev client profilleri, internal distribution, Apple/Google credential'ları EAS'ta.
- **DoD:** `pnpm dev` ile api + mobile ayağa kalkar, CI yeşil, staging HTTPS üzerinden erişilebilir, dev client hem Android hem iPhone'a kurulu.

### Faz 1 — Kripto Çekirdeği
- Bölüm 3.1'in tamamı + `docs/PROTOCOL.md` + `docs/THREAT_MODEL.md`.
- **DoD:** test vektörleri geçer, `packages/crypto` %100 satır coverage, tamper/replay/epoch testleri yeşil, cihazda şifreleme < 5 ms.

### Faz 2 — Auth & Cihazlar
- Email OTP, passkey, JWT + rotating refresh, cihaz kaydı + attestation, istek imzalama middleware'i, tek aktif cihaz kuralı.
- RLS altyapısı + yetki test helper'ı.
- **DoD:** auth e2e testleri, brute-force testi, refresh reuse testi, `app.user_id` set edilmeden yapılan sorgu 0 satır döner.

### Faz 3 — Tasarım Sistemi & Harita İskeleti
- Design + motion tokenları, temel bileşenler, `/_dev/ui`.
- MapLibre + self-host Türkiye PMTiles extract, light/dark özel stil.
- Ana ekran iskeleti (harita + Görenler pill + dock + sheet sistemi), onboarding + auth ekranları.
- **DoD:** tüm geçişler 60 fps, Reduce Motion çalışır, iPhone SE + büyük font testi geçer.

### Faz 4 — Çemberler & Anahtar Dağıtımı
- Çember CRUD, davet (QR + link, tek kullanımlık, süreli, hash'li token), kabul/ret, ayrılma, çıkarma.
- 1:1 arkadaşlık = `pair` çember.
- Sender key üretimi/dağıtımı, epoch yönetimi, güvenlik numarası ekranı + QR doğrulama, key değişim uyarısı.
- Kabul edilmeden hiçbir veri paylaşılmaz.
- **DoD:** çıkarılan üye yeni epoch'u çözemez (test); davet linki tekrar kullanılamaz; yetkisiz kullanıcı çember verisine erişemez.

### Faz 5 — Konum Motoru & Relay
- Background geolocation entegrasyonu (HTTP sync kapalı, sadece callback).
- Adaptif frekans, canlı mod, hassasiyet grid snap, süreli paylaşım, hayalet modu.
- Şifrele → WS → Redis TTL → fanout; açılışta son konumları Redis'ten çek.
- Alıcıda doğrula → çöz → interpolasyon.
- Bölüm 3.4'ün tamamı: event stream, resume, optimistic mutasyonlar, bağlantı yönetimi, canlı mod.
- **DoD:**
  - log/DB/Redis'te düz koordinat olmadığını doğrulayan otomatik test
  - kilitli ekranda arkaplan gönderimi iOS + Android'de çalışır
  - gönderen → alıcı ekranı p95 < 500 ms (ölçüm raporu)
  - uçak modu aç/kapa, Wi-Fi ↔ hücresel geçişi ve 10 dk arkaplan sonrası açılışta veri, yenileme gerektirmeden günceldir (otomatik + manuel test)
  - 8 saatlik saha testi pil raporu

### Faz 6 — Harita Deneyimi
- Animasyonlu marker'lar + ambient durumlar, metaball kümeleme, radyal menü, shared element geçişi.
- Dürt + buluşma efekti, durum (emoji + kısa metin, 24 saat).
- **DoD:** 50 avatarla 60 fps; düşük seviye Android cihazda test.

### Faz 7 — Yerler & Bildirimler
- Yer oluşturma/düzenleme (şifreli, çembere ait), OS geofencing ile cihazda giriş/çıkış.
- FCM v1 + APNs, sealed payload, iOS NSE (Swift + CryptoKit) + Expo config plugin, Android data-only handler.
- Kişi/yer bazlı sessize alma.
- **DoD:** TS ile şifrelenen fixture'ı Swift NSE çözer (cross-impl test); bildirim içeriği APNs/FCM'de düz görünmez.

### Faz 8 — Event Çemberleri
- Süreli çember, QR ile katılım, geri sayım halkası, bitişte otomatik silme + anahtar imhası.
- **DoD:** süre dolunca sunucuda çembere ait hiçbir kayıt kalmaz.

### Ek iş — Çember Geçmişi (ADR 0019)
Faz 8'den sonra proje sahibinin isteğiyle yapılıyor (yapım aşamasında).
- Her üyenin izi çeyrek saatlik parçalar hâlinde telefonda, o çemberin geçmiş anahtarıyla şifrelenir. Sunucu parçaları 14 gün saklar, sonra siler. Sunucu konum görmez; yalnızca kimin izi olduğunu, hangi çeyrek saat olduğunu ve parçanın boyutunu (üç boydan biri) görür.
- **Ücretli (Bargu+):** çemberde Bargu+ abonesi ya da denemesi süren biri varsa üyeler son 14 günü görür (karar 2026-10-15). Ödeyeni kalmayan çember zaten duraklar (Faz 9B).
- Üyeler bir çemberin geçmişini yalnızca katıldıkları andan sonrası için görür; kendi izlerini her zaman görür.
- Yalnızca o çembere tam konum paylaşılırken kaydedilir; hayalet modda, paylaşım kapalıyken ya da mahalle/şehir hassasiyetinde kaydedilmez.
- **Kapalı başlar:** paylaşan kişi o çember için açıkça açmadıkça hiçbir iz kaydedilmez ve gönderilmez. Çembere katılmak geçmişe onay sayılmaz.
- **Kimin gördüğünü görür:** paylaşan kişi, geçmişinin hangi çemberlerde açık olduğunu ve onu kimlerin görebildiğini her an görür. Çembere yeni üye girince "artık X de geçmişini görebilir" bildirimi gelir; 7 günlük paylaşım hatırlatmasında geçmiş de yazar.
- Tek dokunuşla kapatılır; kapatınca sunucudaki parçalar da silinir.
- THREAT_MODEL güncellenir: geçmiş artık sunucuda (şifreli, 14 gün); hangi çeyrek saatlerde iz olduğu meta veri olarak görünür; partner takibi riski.
- **DoD:**
  - Geçmiş kapalı başlar; açılmadan hiçbir parça gönderilmez (test).
  - Sunucuda, log'da ve Redis'te düz koordinat yok (mevcut otomatik test geçmişi de kapsar).
  - Katılmadan önceki parçalar okunamaz; çıkarılan üye yeni parçaları açamaz (test).
  - Yeni üye girince paylaşan bildirim alır; "geçmişimi kim görüyor" ekranı doğru listeler (test).
  - Kapatınca sunucudaki parçalar silinir (test); 14 günden eski parça kalmaz (işçi testi).

### Faz 9 — Güvenlik Özellikleri & Uyum
- Periyodik paylaşım hatırlatması (7 günde bir), yeni izleyici bildirimi, tek dokunuşla tüm paylaşımı durdur.
- Biyometrik uygulama kilidi (opsiyonel), uzaktan cihaz iptali, güvenlik olayları listesi.
- KVKK: aydınlatma metni, konum için açık rıza, veri dışa aktarma, uygulama içinden hesap silme (anında devre dışı, 7 gün içinde kalıcı silme).
- **Hukuki görüş (hemen başlar, 1 Kasım 2026'dan önce; proje sahibi):** 5651 sayılı kanunun "sosyal ağ sağlayıcı" tanımı "konum" paylaşımını açıkça sayıyor. 15 yaş altı yönetmeliği 1 Kasım 2026'da yürürlükte; mevcut hesaplar 31 Mart 2027'ye kadar yaş doğrulamalı. Avukat görüşüne göre ADR: yaş sınırı (15+ / 18+), yaş doğrulama yolu (gerekirse e-Devlet yaş belirteci), 15–18 yaş için kapalı varsayılanlar ve ebeveyn araçları.
- **KVKK 2026 kuralları:** her amaç için ayrı rıza (konum paylaşımı, arka planda konum, her bildirim türü ayrı); aydınlatma metni ile rıza metni ayrı, birleşik "okudum, kabul ediyorum" kutusu yok. Rıza hiçbir zaman ilgisiz bir özelliğin şartı olmaz.
- **Yurt dışı sunucu:** KVKK standart sözleşmesi imzalanır, 5 iş günü içinde KVKK'ya bildirilir. Şifreleme konumu korur ama hesap, çember üyeliği ve bildirim token'ı yine kişisel veridir.
- Store: iOS privacy manifest + nutrition label, Play background location beyanı + video, Data safety formu.
- **DoD:** OWASP MASVS-PRIVACY checklist tamam; hukuki görüş ve yaş ADR'si yazılı; rıza ekranları amaç başına ayrı (test).

### Faz 9B — Para Modeli & Yayın Öncesi Ürün
Faz 10'dan önce gelir; numaralar kaymasın diye 9B. Kaynak: pazar araştırması (Bölüm 0).
- **Para modeli: "kuran öder"** (karar 2026-10-15; kuralların son hâli ve ödeme kütüphanesi ADR'de):
  - Bir çember (1:1 arkadaşlık dahil), üyelerinden en az biri Bargu+ abonesi ya da denemedeyse çalışır. Davetle katılmak hep bedava.
  - Yeni kullanıcıya 21 günlük deneme: bu sürede istediği kadar çember kurar ve davet eder.
  - Ödeyen kalmazsa çember silinmez, veri kaybolmaz; konum paylaşımı duraklar ve "çemberi açık tutmak için biri abone olsun" kartı çıkar. Ödeme hatasında önce ek süre tanınır.
  - Güvendeyim, eve vardım ve "hepsini durdur" duraklamış çemberde de çalışır; hep bedava.
  - **Tek abonelik: Bargu+.** Abonenin kurduğu ve içinde olduğu tüm çemberleri açık tutar; üstüne harita temaları, avatar ve figür stilleri, widget stilleri, özel bitiş saatli paylaşım, daha fazla yer, çember geçmişinin son 14 günü (ADR 0019), her ay bir hediye süs ve "kendi geçmişin" (Faz 11). Aylık ve indirimli yıllık; öğrenci indirimi.
  - **Tek seferlik süs paketleri** (paket başına ₺19–49, indirimli setler; isteğe bağlı "kurucu üye" ömür boyu planı):
    - Avatar çerçeveleri (altın, neon, hareketli)
    - Figür kostümleri (yürüyen figüre şapka, forma; araç yerine spor araba, motosiklet, scooter)
    - Hız izi renkleri ve desenleri
    - Buluşma efektleri (konfeti, kalpler, havai fişek), dürtme animasyonları, hayalet modu kostümleri
    - Harita temaları
    - Sezon paketleri (yılbaşı, bayram, yaz); maç günü takım renkleri kulüp adı ve logosu olmadan (tescilli marka)
  - Süs kuralları: yalnızca görünüş, hiçbir işlev ya da güvenlik özelliği süsün arkasında değil; rastgele kutu (sürpriz paket) yok. Arkadaşın telefonu bir süsü göstermeden önce satın alındığını doğrular (sunucunun imzaladığı hak), değiştirilmiş uygulama bedava süs gösteremez.
  - Etkinlik çemberini düzenleyen öder (Faz 11'deki etkinlik paketi), katılımcı bedava.
  - Önce Google Play Billing; App Store abonelikleri iOS yayınıyla gelir. Abonelik hakkı mağazaya değil hesaba bağlı tutulur, böylece iOS gelince aynı hak orada da geçerli olur. Satın alma, yenileme, iptal ve iade mağaza sunucu bildirimleriyle sunucuda doğrulanır; hak ve duraklama değişiklikleri WS olayıyla herkese anında gider (polling yok).
  - Ödeme ekranı Türkçe, fiyatlar TL, iptal tek dokunuş; yıllık plan özendirilir. Sınırlar yayından önce ekranda yazılıdır; sonradan bedava bir özellik ücretliye taşınmaz.
  - Ödeme kütüphanesi seçimi ADR ile (gerekçe + bakım durumu). Ödeme kayıtlarında konum ya da çember içeriği yok.
  - Vergi yapısı (bireysel 20/B istisnası ya da şirket) mali müşavirle; KDV ve dijital hizmet vergisini mağaza keser (proje sahibi).
- **Güvendeyim düğmesi:** tek dokunuşla seçilen çemberlere "iyiyim" + konum + pil. Mevcut şifreli bildirim yolundan gider; zayıf ağda kuyruğa alınır, küçük paketle tekrar denenir. SMS yedeği ayrı karar (Bölüm 7).
- **"Neden eski?" durumu:** eski konumun yanında nedeni: çevrim dışı (saatiyle), pil tasarrufu, konum izni kapalı. Nedeni gönderen telefon bilir, şifreli nabız mesajına eklenir. Hayalet modda neden gösterilmez.
- **Zengin davet kartı:** davet linki WhatsApp ve Instagram'da önizlemeli açılır. Önizlemeyi o şirketlerin sunucuları çektiği için kişisel veri içermez (ad, fotoğraf yok); ad ve fotoğraf uygulamada çözülür.
- **Sade mod:** efekt, ses ve titreşim yoğunluğu ayarı (tam / az / kapalı); motion tokenlarıyla ölçeklenir, sistemin "Hareketi azalt" ayarından bağımsız.
- **Düşük detaylı dünya haritası:** Türkiye dışındaki arkadaş boş haritada kalmasın; self-host düşük zoom'lu dünya katmanı.
- **Lansman ölçümü:** konum ve kimlik içermeyen sayımlar (günlük aktif, davet başına katılan, 30. gün tutunma, ödemeye geçiş). Üçüncü parti analitik SDK'sı yok.
- **DoD:**
  - Satın alma, yenileme, iptal ve iade çemberdeki herkeste yenileme gerektirmeden WS olayıyla görünür (entegrasyon testi).
  - Ödeyeni kalmayan çember duraklar, biri abone olunca yenileme gerektirmeden açılır; duraklamış çemberde Güvendeyim çalışır (test).
  - Ödeme kayıtlarında ve log'larda konum, e-posta, token yok (otomatik test).
  - Güvendeyim uçak modunda kuyruğa girer, ağ gelince bir kez gider (test); içeriği APNs/FCM'de düz görünmez.
  - Davet önizlemesinde kişisel veri yok (test).
  - Bedava ve ücretli sınırlar ekranda yazılı, iptal tek dokunuş (3 kişiyle kullanılabilirlik testi).

### Faz 10 — Sertleştirme & Yayın
- OWASP MASVS L2 + ASVS L2 checklist; mümkünse bağımsız pentest.
- Maestro ile kritik akış E2E testleri (onboarding, davet, paylaşımı durdur).
- k6 ile WS yük testi (10k eşzamanlı bağlantı).
- Sentry (PII scrubbing), OpenTelemetry, Grafana + alarmlar.
- Prod: en az yetkili DB rolü, şifreli yedek (WAL-G) + restore testi, Redis ACL + TLS, firewall, Caddy (TLS 1.3, HSTS).
- SPKI pinning (2 yedek pin) + rotasyon planı.
- EAS Build/Submit; OTA güncellemeleri kod imzalı veya kapalı; `runtimeVersion` fingerprint policy.
- **Önce Google Play:** 13 Kasım 2023'ten sonra açılan kişisel geliştirici hesabı, üretime çıkmadan önce en az 12 test kullanıcısıyla 14 gün kesintisiz kapalı test yapmak zorunda ([Google](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)). Hesap ve 12 kişilik test grubu Faz 10'dan önce hazırlanır (proje sahibi); bu grup ilk lansman grubunun çekirdeği olabilir. iOS yayını Apple üyeliğinden sonra.
- Jailbreak/root tespiti: sadece uyarı.
- **DoD:** kritik/yüksek bulgu yok, restore testi başarılı.

### Faz 11 — Yayın Sonrası: Büyüme (ilk 3 ay)
- **Eve vardım kontrolü:** hedef ya da süre seçilir; varılmaz ve cevap verilmezse seçilen kişilere konum ve pil gider. KADES ve 112'ye kısayol (yalnızca bağlantı; Bargu acil servis değildir).
- **Uygulamasız şifreli konum linki:** süreli web linki; anahtar linkin `#` kısmında, sunucuya hiç gitmez; sayfa self-host haritayla çizer. Süre bitince ya da tek dokunuşla iptal. ADR + THREAT_MODEL güncellemesi (link sızarsa ne olur).
- **Widget ve Live Activity:** Android ana ekran widget'ı; iOS kilit ekranında "Yoldayım, 4 dk" (varış tahmini). İçerik şifreli kalır (Bölüm 8'den taşındı).
- **Yüz yüze ekleme:** QR'a ek olarak telefonları sallayarak ekleme.
- **Özel bitiş saati ve kişiye dondurma:** "21:30'a kadar" gibi süre; tek kişiye sessizce dondurma.
- **Davet ödülü:** davet eden ve gelen birer ay Bargu+. Nakit ödül ve zorla davet yok.
- **Etkinlik paketi:** Faz 8 etkinlik çemberinin, düzenleyenin ödediği süreli paketi (gezi, tur, kamp); katılımcı bedava. Fiyat denemesi.
- **Kendi geçmişin (Bargu+, isteğe bağlı):**
  - Kapalı başlar; kullanıcı açarsa çalışır. Kendi izin telefonda, şifreli kasada tutulur (ADR 0019'daki yerel kayıt). Aşağıdaki özetler telefonda üretilir, sunucuya gitmez.
  - İçinde: keşif haritası ("kazıma haritası"), "geçen cumartesi neredeydim" rotaları, haftalık özet, paylaşılabilir yıl sonu kartı ("2026'da 14 şehir, 230 buluşma"; kartta koordinat yok).
  - Kayıt yalnızca paylaşım açıkken zaten alınan konumlardan yapılır; ayrıca arka planda konum istemez (Play beyanı tek özellik kalır).
  - Süre seçilir (30 gün / 1 yıl), tek dokunuşla silinir, dışa aktarılabilir. Abonelik bitince kayıt durur ama mevcut geçmiş silinmez; görülebilir ve dışa aktarılabilir.
  - Arkadaşların izi yalnızca çember geçmişi kurallarıyla görünür (Ek iş, ADR 0019; Bargu+ ile son 14 gün). THREAT_MODEL güncellenir: kilidi açık telefonda geçmiş görünür, biyometrik kilit önerilir.
- **Lansman:** önce tek bir fakülte, yurt ya da kulüp; 72 saatte grubun %25'i aktif değilse sebebi bulunmadan genişlenmez. Şubat 2027 deneme, Eylül 2027 yeni kayıt dönemi. Ücretli içerik paylaşımlarında "#Reklam" etiketi.
- **DoD:**
  - Konum linki sayfası anahtarı hiçbir isteğe koymaz (test); süresi biten link açılmaz.
  - Widget ve Live Activity içeriği APNs/FCM'de düz görünmez.
  - Eve vardım, uygulama kapalı ve telefon kilitliyken iOS + Android'de çalışır (saha testi).
  - İlk lansman grubunun 72 saat ölçümü raporlanır.
  - Kendi geçmişin kapalı başlar; Bargu+ özetleri telefonda üretilir, sunucuya, log'a ya da bildirime koordinat gitmez (otomatik test); "geçmişi sil" telefondaki kaydı tamamen siler (test).

---

## 6. Claude Code Kuralları (→ `CLAUDE.md`)

- Sunucuya **ASLA** düz koordinat gitmez. Her konum `packages/crypto` üzerinden şifrelenir.
- Konum, token, email, push token **log'lanmaz**.
- Kripto kodu sadece `packages/crypto`'da. Kendi primitive'ini yazma, noble kullan.
- Her endpoint: zod input doğrulama + yetki kontrolü + "başka kullanıcı erişemez" testi.
- Polling, pull-to-refresh ve "yenile" butonu yasak. Her durum değişikliği WS olayı olarak yayınlanır ve client cache'i olaydan güncellenir.
- `any`, `@ts-ignore`, `eslint-disable` yasak (gerekçeli istisna hariç).
- Animasyonlar Reanimated worklet; JS thread'de animasyon yasak. Motion tokenları dışında sabit değer yok.
- Yeni bağımlılık: önce gerekçe + bakım durumu. Expo paketleri `npx expo install` ile.
- Paket sürümlerini ezberden değil güncel dokümantasyondan doğrula.
- Kod, commit, değişken isimleri İngilizce; UI metinleri i18n (tr, en).
- Mimariyi değiştiren her karar → `docs/ADR/` altına ADR.
- Her faz sonunda dur: değişiklik özeti, test sonuçları, açık riskler → onay bekle.

---

## 7. Açık Kararlar

- **Arkaplan konum:** Transistorsoft (önerilen, ücretli) vs `expo-location` + `expo-task-manager` (ücretsiz, daha az güvenilir).
- **Hosting:** Hetzner (AB) + KVKK standart sözleşme (önerilen) vs Türkiye'de sunucu.
- **Marka:** renk paleti, logo, display font.
- **Fiyatlar (tahmin, doğrulanmadı):** Bargu+ yaklaşık ₺99,99/ay (Life360 Silver ile aynı seviye), öğrenciye ₺59,99–69,99, yıllıkta indirim; tek seferlik paket ₺19–49; etkinlik paketi ₺199–499. ₺99,99'luk aboneliğin net getirisi yaklaşık ₺57. Para modelinin kendisi kararlaştırıldı (Bölüm 1, Faz 9B).
- **Yaş sınırı ve doğrulama:** hukuki görüşe bağlı (Faz 9).
- **Güvendeyim SMS yedeği:** şebeke çökünce işe yarar ama SMS düz metindir; konumsuz "iyiyim" SMS'i mi, hiç SMS yok mu?
- **Gelirin vergi yapısı:** bireysel (20/B istisnası) ya da şirket; mali müşavirle.
- **Kendi geçmişinin uzun yedeği:** çember geçmişi sunucuda en çok 14 gün kalır; telefon değişince daha eski kendi izin kaybolur. Yalnızca dışa aktarma mı, yoksa şifreli uzun yedek mi? Uzun yedek ADR ister.

## 8. v2 Fikirleri
- Operatör kanalı: Turkcell Pasaj gibi pazar yerlerinde yıllık aile paketi kodu
- Apple Watch
- MLS'e geçiş, multi-device
