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
    | Biri seni haritada izliyor (canlı mod) | 1 sn (2 dk, saatte en çok 15 dk; ADR 0028) |
    | Kendi haritan açık | 1 sn |
    | Uygulama kapalı, hareket hâlinde | GPS 30 sn'de bir (kaba konum 60 sn); sistem biriktirir, uygulama dakikada en çok bir kez uyanır ve gönderir (ADR 0036) |
    | Durağan | Konum değişmediği için gönderim yok; 5 dk'da bir heartbeat (pil, aktiflik) |

  - **Pil (ADR 0036, PM onayı 2026-10-29):**
    - Uygulama kapalıyken pin en çok ~1 dk geriden gelir; biri bakınca canlıya döner.
    - v2 (durunca GPS'i kapat, hareketle aç) yalnız ölçüm isterse yapılır. Ölçüt: sahibin bir günlük normal kullanımında Android pil ekranında Bargu'nun payı %10'u geçerse.
    - v2'de yol: Activity Recognition ile küçük yerel modül. "Her zaman konum" izni istenmez.

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
  - Avatar **pin** (proje sahibinin seçimi, 2026-10-18; 2026-10-16 tarihli çıkartma ve ada yerine; ADR 0008 eki): mor tonlu halkalı yuvarlak avatar, aşağı sivri uç, ucun altında küçük nokta (tam konum), sağ altta yeşil "canlı" noktası, altında küçük etiket (ör. eskimişse "23 sa").
- Yakın kişiler **tek çerçeve** (proje sahibinin düzeltmesi, 2026-10-16): birlikte duranlar tek bir ortak pinde (2026-10-18'den beri pin biçiminde; önce ortak beyaz çıkartma çerçevesiydi), halka bir kişinin renginden ötekine geçer, altta tek uç. Çerçevede en çok 2 avatar, her biri ayrı dokunulur; kullanıcı oradaysa hep görünür. İkiden fazla kişide sağ üst köşede toplam sayı yazar; çerçeveye dokununca oradakilerin listesi açılır ("Sen" önce), listeden kişi kartına gidilir.
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
- Yalnızca o çembere tam konum paylaşılırken kaydedilir; hayalet modda, paylaşım kapalıyken ya da mahalle/şehir hassasiyetinde kaydedilmez. Hayalet moda geçince ya da paylaşım durunca henüz gönderilmemiş son parça da atılır: hiçbir şey gitmez; konum servisi dururken de, hayaletten dönünce eski parça gönderilmez (karar 2026-10-15, QA G6; Faz 8 onayından önce).
- Kapatma, o anda süren gönderimle yarışmaz: kapattıktan sonra sunucuya hiçbir parça yazılmaz (QA G1; Faz 8 onayından önce).
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
**Sıra (PM, 2026-10-15; her dilim ayrı commit, her dilimden sonra test oturumu):**
1. Gizlilik açıkları: ayrılınca geçmiş kapanır (W4), QR iptali (O2, O3), hatırlatıcı temizliği (O5), kapalı uygulamada yeni izleyici uyarısı (G2), geçmiş listeleme sınırı (G3), istek zaman aşımı + tek yeniden deneme (kabulde 15 sn, geçmiş silme), "Çember bulunamadı" yarışı, kişi kartındaki dört düğmenin yazıları sığmıyor ("Dür t", "Yol ta…"; proje sahibinin ekran görüntüsü, 2026-10-15).
2. Çember rolleri ve planlama yetkisi: roller, O4 sunucu yetkisi, O6 QR katıl–ayrıl, buluşma noktaları haritada (ADR).
3. Güvenlik özellikleri: 7 günlük hatırlatma (geçmiş dahil), yeni izleyici bildirimi, tümünü durdur, biyometrik kilit, uzaktan cihaz iptali, güvenlik olayları listesi.
4. KVKK ve Play: hesap silme + web silme sayfası (K7), veri dışa aktarma, amaç başına ayrı rıza ve ayrı aydınlatma, K10, K11, K13 (sayfalar geçici alan adında), ön plan servisi beyanı ve video.
5. Yaş 15+: önce ADR (e-Devlet yaş belirtecine bireysel geliştirici erişebiliyor mu; erişemiyorsa geçiş çözümü), sonra uygulama.
6. Ölçek ve küçükler: O1, O7 yük testi, D1–D10, G4, G5, G7–G10, eskiyen temizlik kaydı uyarısı, kalıcı C1–C4 / M1–M2 testleri.
- **İlk iş (proje sahibi kararı 2026-10-15, QA 5 / W4):** çemberden ayrılınca ya da çıkarılınca geçmiş, bekleyen parçaları atar ve o çemberin ayar kaydı silinir. Aynı çembere dönünce geçmiş kapalı başlar; katılmak geçmişe onay sayılmaz.
- Periyodik paylaşım hatırlatması (7 günde bir), yeni izleyici bildirimi, tek dokunuşla tüm paylaşımı durdur.
- Biyometrik uygulama kilidi (opsiyonel), uzaktan cihaz iptali, güvenlik olayları listesi.
- KVKK: aydınlatma metni, konum için açık rıza, veri dışa aktarma, uygulama içinden hesap silme (anında devre dışı, 7 gün içinde kalıcı silme).
- **Yaş sınırı 15+ (karar 2026-10-15):** avukat ertelendi; ön araştırma `docs/arastirma/yas-siniri-ve-kvkk.md`. 5651'in "sosyal ağ sağlayıcı" tanımı "konum" paylaşımını sayıyor; Bargu kapsamda varsayılır. 15 yaş altı yönetmeliği 1 Kasım 2026'da yürürlükte; mevcut hesaplar 31 Mart 2027'ye kadar yaş doğrulamalı. Faz 9'da ADR ile tasarlanır: yaş doğrulama yolu (e-Devlet yaş belirteci), 15–18 yaş için kapalı varsayılanlar, ebeveyn araçları ve ücretli işlemleri engelleme (Bargu+ dahil). Avukata sorulacaklar araştırma dosyasının 4. bölümünde.
- **KVKK 2026 kuralları:** her amaç için ayrı rıza (konum paylaşımı, arka planda konum, her bildirim türü ayrı); aydınlatma metni ile rıza metni ayrı, birleşik "okudum, kabul ediyorum" kutusu yok. Rıza hiçbir zaman ilgisiz bir özelliğin şartı olmaz.
- **Play zorunlulukları (`docs/play-store/KONTROL-LISTESI.md`):** K7 hesap silme (uygulama içi yol + e-posta kodlu web silme sayfası; tüm satırlar, üyelikler, anahtarlar, fotoğraf ve geçmiş gider, çemberlere rekey), K10 konum açıklama ekranına "uygulama kapalıyken de" cümlesi, K11 Android 13+ bildirim izni bağlamda, K13 gizlilik politikası ve silme sayfasının yayını.
- **Yurt dışı sunucu:** KVKK standart sözleşmesi imzalanır, 5 iş günü içinde KVKK'ya bildirilir. Şifreleme konumu korur ama hesap, çember üyeliği ve bildirim token'ı yine kişisel veridir.
- **Faz 8 test bulguları** (QA raporları `QA-RAPOR-Faz8-ve-planlama.md` ve `QA-RAPOR-2-Cember-gecmisi.md`; proje sahibi 2026-10-15'te Faz 9'a bıraktı):
  - **O2 + O3, etkinlik QR güvenliği:** sahip, etkinliğin bütün davetlerini (başka üyenin ürettiği QR dahil) iptal edebilsin ya da yalnızca sahip QR üretsin; "Yeni kod" iptal başarısızsa uyarsın. THREAT_MODEL'deki "Ele geçen etkinlik QR'ı" satırı buna göre düzelir.
  - **O5, hatırlatıcı temizliği:** etkinlik bitince, ayrılınca ya da hesaptan çıkınca çıkış hatırlatıcısı iptal edilir ve telefondaki meeting:* kayıtları silinir.
  - **O4, planlama belgelerinde sunucu yetkisi:** buluşma belgesi hep ortak, oy satırı anket + yazara bağlı, anketi yalnızca başlatan ya da sahip kapatır, üye başına belge kotası.
  - **O1, süpürme ölçeği:** çok etkinlik aynı anda bitince süpürme kilit süresini aşmasın (tek geçişte tarama ya da çember anahtar indeksi, sahip belirteçli kilit, "şimdi bitir" yalnızca kendi çemberini temizler).
  - **O6, QR ile katıl–ayrıl döngüsü:** aynı QR ile kişi başına tek giriş, epoch üretimine hız sınırı.
  - **O7:** 50 kişilik etkinlik yük testi. D1–D10 küçük bulgular iş listesine.
  - **G2, yeni izleyici uyarısı uygulama kapalıyken:** geçmişi açık çemberlerde "yeni biri katıldı" bildirimi "artık geçmişini görebilir" desin ya da arka plan işleyicisi kontrol etsin.
  - **G3, geçmiş listeleme sınırı:** istek başına aralık ve parça sınırı, kullanıcı başına hız sınırı.
  - **Geçmiş kapatma ayrıntıları (QA 4):** çevrimdışı kapatıp hemen açınca kapatma işareti yeni parçaları da reddetmesin (işaret zamana bağlı); geçmiş isteklerine 15–20 sn zaman aşımı, böylece yanıt gelmese de sunucudaki kopya silinir. Etkinlik DoD testlerinin süresi 30 sn sınırına yakın (O1 ile birlikte).
  - **Telefon denemesi (proje sahibi, 2026-10-15; "sonra düzeltirsin, task olarak topla"):**
    - Hata: davet bildirimine basınca çember listesi yüklenmeden "Çember bulunamadı" açılıyor. Ekran çemberi getirmeyi beklesin; yalnızca sunucu "yok" derse bu ekran çıksın.
    - Hata: daveti kabul etmek yaklaşık 15 sn sürüyor; sunucuda istek 35 ms, gecikme telefonda. Büyük olasılıkla arka plandan dönünce ilk istek ölü bağlantıda bekliyor. İsteklere zaman aşımı ve tek seferlik yeniden deneme eklensin (geçmiş isteklerindeki zaman aşımıyla birlikte), cihazda doğrulansın.
    - İstek: buluşma noktaları haritada ayrı görünsün ve dokunulabilir olsun.
    - İstek: çemberde roller (WhatsApp grupları gibi temel düzeyde). Yönetici olmayan üye oylama ve etkinlik başlatamasın; sunucu da denetlesin. O4 (anket kapatma ve belge yetkisi) ile birlikte ele alınsın.
  - **G4, G5, G7–G10:** iş listesine (hassasiyet düşünce anahtar ile bayrak tutarlılığı, yeniden kurulumda eski parçaları silebilme, toplu katılımda bildirim yağmuru, ağ hatasını "veri yok" gibi göstermeme).
- Store: iOS privacy manifest + nutrition label, Play background location beyanı + video, Data safety formu.
- **DoD:** OWASP MASVS-PRIVACY checklist tamam; hukuki görüş ve yaş ADR'si yazılı; rıza ekranları amaç başına ayrı (test); Faz 8 QA bulgularından O2, O3, O4, O5, G2 ve G3 kapalı ve test oturumunun ilgili senaryoları yeşil.

### Faz 9B — Para Modeli & Yayın Öncesi Ürün
Faz 10'dan önce gelir; numaralar kaymasın diye 9B. Kaynak: pazar araştırması (Bölüm 0).
**Durum (2026-10-22):** kod ve testler bitti, PM onayladı (kapanış raporu: docs/DURUM.md). Proje sahibinde kalanlar: seviye 5 APK'sıyla telefon denemeleri, 3 kişiyle kullanılabilirlik testi ve sunucu betiğinin iki kez çalıştırılması. Bunlar kapalı testten önce şart. Proje sahibinin kararıyla, telefon denemesine kadar yeni özellik yok.
- **Para modeli: "kuran öder"** (karar 2026-10-15; kuralların son hâli ve ödeme kütüphanesi ADR'de):
  - Bir çember (1:1 arkadaşlık dahil), üyelerinden en az biri Bargu+ abonesi ya da denemedeyse çalışır. Davetle katılmak hep bedava.
  - Yeni kullanıcıya 21 günlük deneme: bu sürede istediği kadar çember kurar ve davet eder.
  - Ödeyen kalmazsa çember silinmez, veri kaybolmaz; konum paylaşımı duraklar ve "çemberi açık tutmak için biri abone olsun" kartı çıkar. Ödeme hatasında önce ek süre tanınır.
  - Güvendeyim, eve vardım ve "hepsini durdur" duraklamış çemberde de çalışır; hep bedava.
  - **Paketler (PM, 2026-10-16; proje sahibi "kafana göre belirle" dedi).** Tek abonelik Bargu+; abone, kurduğu ve içinde olduğu bütün çemberleri herkes için açık tutar ("ailede bir kişi öder, herkes kullanır").

    | Özellik | Bedava (davetli üye) | Deneme (21 gün) | Bargu+ |
    |---|---|---|---|
    | Fiyat | ₺0 | ₺0, kart istenmez | ₺99,99 / ay ya da ₺799,99 / yıl (yaklaşık %33 indirim) |
    | Davetle katılmak (arkadaşlık, grup, etkinlik) | Var | Var | Var |
    | Ödeyeni olan çemberde canlı konum ve geçmiş (yer varış bildirimleri dahil, çünkü canlı konuma bağlı) | Var | Var | Var |
    | Dürt, durum, yerler, buluşma, oylama (duraklamış çemberde de; ADR 0024) | Var | Var | Var |
    | Kendi çemberini ya da etkinliğini kurup açık tutmak | Kurabilir; ödeyen yoksa duraklar | Var | Var, sınırsız |
    | Çember geçmişi, son 14 gün | Ödeyeni olan çemberde | Var | Var |
    | Özel bitiş saatli paylaşım ("21:30'a kadar") | Yok | Var | Var |
    | Kendi geçmişin: keşif haritası, rotalar, yıl sonu kartı (Faz 11) | Yok | Var | Var |
    | Harita temaları ve widget stilleri | Varsayılan tema | Bütün temalar | Bütün temalar |
    | Her ay bir hediye süs | Yok | Yok | Var |
    | Güvenlik ve gizlilik: Güvendeyim, eve vardım, hayalet, hassasiyet, tümünü durdur, kilit, hesap silme, dışa aktarma | Hep var | Hep var | Hep var |

    - 15–17 yaşta satın alma ebeveyn onayıyla (ADR 0023). Öğrenci indirimi ve "kurucu üye" ömür boyu planı sonraya; öğrencilik doğrulanamadığı için şimdilik yok.
    - Deneme bitince kart istenmeden Bargu+'ya geçmez; kullanıcı kendisi seçer. Bitimden 3 gün önce uygulama içi hatırlatma.
  - **Tek seferlik süs paketleri** (tek paket ₺29,99, sezon paketi ₺49,99; pin görünümüne göre):
    - Pin halkası stilleri ve desenleri, pin ucu ve etiket stilleri, ortak pin stilleri
    - Avatar çerçeveleri (altın, neon, hareketli)
    - Figür kostümleri (yürüyen figüre şapka, forma; araç yerine spor araba, motosiklet, scooter)
    - Hız izi renkleri ve desenleri
    - Buluşma efektleri (konfeti, kalpler, havai fişek), dürtme animasyonları, hayalet modu kostümleri
    - Harita temaları
    - Sezon paketleri (yılbaşı, bayram, yaz); maç günü takım renkleri kulüp adı ve logosu olmadan (tescilli marka)
  - Süs kuralları: yalnızca görünüş, hiçbir işlev ya da güvenlik özelliği süsün arkasında değil; rastgele kutu (sürpriz paket) yok. Arkadaşın telefonu bir süsü göstermeden önce satın alındığını doğrular (sunucunun imzaladığı hak), değiştirilmiş uygulama bedava süs gösteremez.
    - Dilim 3'ün ilk paketleri (PM, 2026-10-16): "Halka desenleri" ve "Pin çerçeveleri" (2026-10-18'de pin kararıyla "Ada desenleri" ve "Çıkartma kenarları"nın yerine), tanesi ₺29,99, dörder stil. Hiçbiri satılmadığı için paket kimlikleri değişebilir. Sezon paketi, kostümler, buluşma efektleri ve aylık hediye süs sonraki dilimde.
    - Hak, sunucunun imzaladığı kısa süreli bir geçiş belgesidir; seçilen görünümle birlikte profilin yanında ayrı bir şifreli mesajla gider (profil dolgusu dolu olduğu için). Sunucu hangi stilin seçildiğini bilmez. Staging ile üretimin imza anahtarları ayrıdır; staging'deki test süsü üretim uygulamasında geçmez.
    - 15–17 yaşta süs de 2c'deki ebeveyn isteğiyle alınır. Hareketli stiller sade modda ve pil tasarrufunda durur.
  - Etkinlik çemberini düzenleyen öder (Faz 11'deki etkinlik paketi), katılımcı bedava.
  - **Şimdilik sahte ödeme (proje sahibi, 2026-10-16):** mağaza hesabı ve gerçek paketler yokken ödeme akışı test satın almayla kurulur.
    - Sunucuda hak (entitlement) modeli hesap bazlı ve kaynaklı: `test` / `play` / `appstore`. Çember açıklığı bu haktan hesaplanır.
    - Ödeme ekranı gerçek akışla aynı. "Satın al" staging'de sunucunun test satın alma ucunu çağırır ve hak verir; ekranda "TEST — gerçek ödeme yok" bandı.
    - Üretimde test ucu kapalı (ortam bayrağı; sunucu 404 döner), test düğmesi yalnızca preview derlemesinde.
    - Geliştirici menüsünden yenileme, iptal, süre dolması ve ödeme hatası (ek süre) taklit edilebilir; duraklayan çember ve hatırlatmalar böyle denenir.
    - Gerçek mağaza bağlantısı Play hesabı açılınca aynı hak arayüzünün arkasına eklenir.
  - Gerçek ödemede önce Google Play Billing; App Store abonelikleri iOS yayınıyla gelir. Abonelik hakkı mağazaya değil hesaba bağlı tutulur, böylece iOS gelince aynı hak orada da geçerli olur. Satın alma, yenileme, iptal ve iade mağaza sunucu bildirimleriyle sunucuda doğrulanır; hak ve duraklama değişiklikleri WS olayıyla herkese anında gider (polling yok).
  - Ödeme ekranı Türkçe, fiyatlar TL, iptal tek dokunuş; yıllık plan özendirilir. Sınırlar yayından önce ekranda yazılıdır; sonradan bedava bir özellik ücretliye taşınmaz.
  - Ödeme kütüphanesi seçimi ADR ile (gerekçe + bakım durumu). Ödeme kayıtlarında konum ya da çember içeriği yok.
  - Vergi yapısı (bireysel 20/B istisnası ya da şirket) mali müşavirle; KDV ve dijital hizmet vergisini mağaza keser (proje sahibi).
- **Buluşma (proje sahibinin telefon denemesi, 2026-10-16; ADR 0026; dilim 3b'den önce):**
  - Haritada buluşma kayıtlı yerden ayrı görünür: farklı renk, kesik kenar, bayraklı iğne ve saat ("17:30 · Ev"); oylanıyorsa "oylanıyor" yazar. Kayıtlı bir yer buluşma yeri olursa buluşma süresince buluşma görünümüne geçer. Oradaki kişilerin pinleri buluşma iğnesinin üstünde görünür kalır.
  - Dokununca buluşmanın kendi ekranı: yer, saat, kim geliyor, küçük harita, yol tarifi, "geç kalıyorum"; yetkili kişi yer ve saati değiştirir, buluşmayı bitirir.
  - Etkinlik dışı çemberde de (aile, arkadaş, ikili) "Buluşma başlat", davetsiz. Çemberde aynı anda tek buluşma; başlatan ve çember yöneticileri değiştirir ya da bitirir (ikili çemberde iki kişi eşittir, ikisi de değiştirir ve bitirir; QA 21); bitince birkaç saat sonra sunucudan kendiliğinden silinir. Oylama şimdilik yalnızca etkinlikte.
  - Gizlilik: "kim geliyor" yalnızca kişinin o çemberde zaten paylaştığından hesaplanır. Hayalet modda, kaba hassasiyette ve duraklamış çemberde varış tahmini yok. "Geldi" yalnızca tam hassasiyette ya da kişi kendisi "geldim" deyince. Yol tarifi yalnızca dokununca harita uygulamasını açar.
- **Harita kısayolları ve buluşma sayacı (proje sahibinin isteği, 2026-10-16; yalnızca uygulama):**
  - Sağ kenarda en çok 3 yuvarlak düğme: konumuma dön (harita kaydırılınca), hayalet modu, buluş. Buluşma varken "buluş", sayaç çipine dönüşür. "Geldim" yalnızca saate ya da yere yaklaşınca çıkar. Hayalet modu tek dokunuşla açılır; kapatırken kısa bir onay sorulur ("Konumun yeniden paylaşılacak").
  - Sayaç çipi üstte: "🏠 Ev · 17:30 · 25 dk"; saatinde "2/4 geldi · 1 yolda". Sayılar buluşmanın gizlilik kurallarıyla hesaplanır: kaba hassasiyetteki ya da hayalet moddaki kişi "yolda" sayılmaz. Telefonun saatiyle çalışır, yoklama yok. Herkes gelince konfeti, sade moda uyar.
  - Sonra (ayrı dilim, yerel modül): bildirim çubuğunda canlı sayaç (Android süren bildirim, iOS Live Activity).
  - Efektler (proje sahibi "PM yönlendirsin" dedi; PM, 2026-10-17): düğmelerin yaylı girişi (yalnızca harita ilk açılınca), hayalet açılınca süzülme (birkaç tur, sonra durur) ve kapanınca "pof", "Konumuma dön"de radar halkası, "Geldim" belirince birkaç nabız, sayaçta kayan rakamlar. Yeni efektler hep sonludur (pil). Sade mod (tam / az / kapalı) bu dilimde gelir ve bütün efektleri ölçekler. "Tam"da (varsayılan) haritadaki kişiler bugünkü gibi canlıdır. Hava katmanı ise "tam"da da harita açılınca, hava değişince ve dokununca yaklaşık 20 saniye oynar, sonra son karede durur; "az"da durağandır, "kapalı"da yoktur. "Az"da her yeni konumda tek kısa döngü, "kapalı"da hiç; bu ikisinde boştaki harita kare üretmez. Pil tasarrufu açıkken ya da pil %20'nin altındayken uygulama kendiliğinden "az" gibi davranır. "Hareketi azalt" açıkken "kapalı" gibi davranır.
  - QA 23 notları (sonraki uygulama dilimine): titreşim yalnızca Efektler seçimine ve telefonun kendi titreşim ayarına bağlıdır; "Hareketi azalt" ve pil tasarrufu titreşimi kapatmaz (PM kararı, ADR 0027'ye yazılır). QR ekranlarındaki döngüler sade mod canlı değişince de dursun.
  - QA 22 düşük notları (sonraki uygulama dilimine): çip, saati geçmiş ama henüz silinmemiş buluşmayı yaklaşan buluşmanın önüne koyuyor, yaklaşan öne gelsin. Alıcı, kaba konumla gelen tahmini de "yolda" sayıyor; gönderici zaten atıyor, savunma için alıcı da doğruluk ≤ 100 m şartı arasın. Buluşma saatinin sunucuda tam saate yuvarlanması (ADR 0026, "sonra") da bu dilime.
- **Tema yenileme (proje sahibinin gönderdiği tasarım, 2026-10-18; ADR 0008 eki; dilim 3b'den önce; yalnızca uygulama):**
  - Koyu temada lacivert-mor tonlu yüzeyler, ince mor kenarlı kartlar, daha parlak mor vurgu, seçili öğede durağan mor parıltı; açık temanın karşılığı da çıkarılır. Renk kontrast testi geçer.
  - Açıklama satırlarında ⓘ simgesi.
  - "Seni görüyor" hapı iki satır ve ok. İkinci satır gerçek durumu söyler: hayalet ya da dondurulmuşsa "konumun paylaşılıyor" demez.
  - Hava ayrı kart, sıcaklık ve şehir. Şehir adı telefonda haritanın kendi etiketlerinden çıkar, ağa sorulmaz (ADR 0013).
  - Kısayol düğmeleri koyu ve ince kenarlı. Hayalet düğmesindeki mor nokta "konumun şu an paylaşılıyor" demektir (proje sahibi): en az bir çember konumunu şu an alıyorsa görünür; hayalet, dondurma, duraklama ya da paylaşım kapalıyken kalkar.
  - Dock'ta seçili sekme göstergesi. Ben sayfasında simgeli seçim çubukları ve gruplu kartlar.
  - Parıltılar sade moda uyar.
  - Kişi işareti pin olur (proje sahibi, 2026-10-18; Bölüm 4.3).
- **Konum gecikmesi ve sapma (proje sahibinin telefon denemesi, 2026-10-18; birinci öncelik):**
  - Önce uçtan uca ölçüm (yalnızca süreler, koordinat yok), sonra düzeltme. Hedef: iki taraf da açıkken 1–3 sn.
  - Alıcıdaki tahmin en çok birkaç saniye ileri gider ve hiç geri sıçramaz (bugün 10 sn ileri gidip dönüşte geri sıçrıyordu). Kötü örnekler (düşük doğruluk, olanaksız hız) süzülür.
  - Arka planda gecikme: izlenen telefonun canlı moda geçirilmesi araştırılır; aralık politikası değişirse ADR. Canlı mod dışında pil geriye gitmez.
  - 1. adım yapıldı ve QA 25'ten geçti (ADR 0028): tahmin en çok 1 sn, geri sıçrama yok, gönderen süzgeci, kapalı alanda belirsizlik dairesi, kaba çembere giden konum değişmedi. Düşük not: 24,8 günden uzak paylaşım bitişinde zamanlayıcı taşıyor, parçalı kurulsun. 2. adım: proje sahibinin ölçümü; 3. adım: arka planda canlı mod (ADR 0028 onayıyla).
  - 3. adımın tasarımı (PM, 2026-10-21):
    - Sunucu, canlı bağlantısı olmayan üyeye mühürlü bir "watch" haberi yollar; içinde yalnızca çember kimliği var, izleyenin kimliği yok, ekranda bildirim yok.
    - Telefon, o çemberle tam konum paylaşıyorsa 2 dakika saniyede bir gönderir.
    - Sınırlar yapılandırılabilir: alıcı başına 90 sn'de bir ve saatte 20 haber; telefonda saatte en çok 15 dakika.
    - Hiç açılmaz: hayalet, kaba hassasiyet, pil tasarrufu, %20 altı pil, bitmiş paylaşım, duraklamış çember.
    - Android arka plandaki uygulamanın konum servisini yeniden ayarlamasına izin vermiyor. Telefonda tutmazsa sıra: önce servisi yeniden başlatmadan güncelleyen küçük bir yerel modül, olmazsa arka planda 5 sn. Arka plan konum izni şimdi istenmez (Play beyanı ve gizlilik metni gerektirir; proje sahibinin kararı). iOS ayrı.
    - Ayar "Arka planda canlı konum": 18+ için açık başlar ve bir kez kısa bir açıklama gösterilir. 15–17 için kapalı başlar ve yalnızca gencin kendisi açabilir; ebeveyn açamaz, ebeveyn araçlarında görünmez.
- **Daha gerçekçi hareket görselleri (proje sahibi, 2026-10-18; konum düzeltmesinden sonra, dilim 3b'den önce):**
  - Yürüme, koşma, bisiklet ve araba yeniden çizilir; donma nedeni bulunur. Pil tasarrufu sade modu "az"a çektiyse Ben > Efektler'de bunun nedeni yazar.
  - 120 km/sa üstünde yarış arabası ve hız çizgileri; korkuluklarla:
    - Yalnızca paylaşan "Hızımı göster" açık ve tam hassasiyetteyse.
    - 200 km/sa üstü yarış arabası değil, hızlı ulaşım (tren ya da uçak) görünür.
    - Hız kutlanmaz: konfeti, ses ya da rozet yok.
    - Sade moda uyar.
  - Önce proje sahibine görsel önizleme.
- **UX düzeni (proje sahibinin paylaştığı GPT notu, 2026-10-21; PM; hareket görsellerinden sonra, dilim 3b'den önce; yalnızca uygulama):**
  - Kişi kartında "Sessize al" ve sessiz göstergesi; Ben > Bildirimler'de sistem ayarına geçiş ve sessize alınanların listesi.
  - Ben sayfası başlıklı gruplar: Profil · Konum ve gizlilik (hayalet, kimler görüyor, konum geçmişim) · Güvenlik (geçiş anahtarı, güvenlik, ebeveyn) · Bildirimler · Görünüm ve harita · Bargu+ ve uygulama · Çıkış ayrı. "Gizlilik ve hesap" içeriğine göre "Hesap ve veri" olur.
  - "Seni görenler" ekranındaki çember kartı o çemberin paylaşım ayarını açar; Ben'den de bu ekrana gidilir.
  - Ekle menüsünün adı "Ekle" olur ve içine "Çember oluştur" eklenir. "Çemberden ayrıl" ayrı bir tehlike bölümüne taşınır. Boş bölümler açıklama ve işlem gösterir.
  - Kişi kartında görünür kapat (×) düğmesi. Karttaki "Profil" düğmesinin adı açtığı ekrana göre düzeltilir.
  - Sonraya: alt ekrandan dönünce Ben ya da Çemberler sayfasının ve kaydırma yerinin korunması.
- **Sıra ve tasarım notları (PM, 2026-10-21):** 3c (15–17 süs isteği) ve sayaç sıfırlama → Güvendeyim → Neden eski → dünya haritası → zengin davet kartı.
  - Güvendeyim: yeni şifreli tür; konum her çembere o çemberin hassasiyetiyle gider; hayalette tek seferlik onay; sunucu yalnızca tekrar engeli için kimlik özetini 24 saat tutar (ADR 0029).
  - Neden eski: ayrı bir şifreli durum mesajı, koordinatsız; "çevrim dışı"yı alan telefon çıkarır.
  - Dünya haritası: zoom 0–6, yaklaşık 45 MB.
  - Davet sayfası: geçerli ve geçersiz belirteç için aynı içerik; indirme yolu "yakında Google Play'de", APK linki yok.
- **Buluşmada katılım yanıtı (proje sahibinin isteği, 2026-10-22; tasarım şimdi, kod telefon denemesinden sonra):** "Geliyorum / Gelemiyorum / Belki"; buluşma ekranında kim ne dedi, adı ve sayısıyla. Yanıt şifreli belge (ADR 0018'deki oy gibi), sunucu kimin ne dediğini görmez; etkinlikteki katılım yapısı yeniden kullanılır; saat değişince "hâlâ geliyor musun?" sorulur; başlatana tek özet bildirim (ADR 0026 eki). Ayrıca hata: buluşma için eklenen yer buluşmayla silinir, başlatana "Yeri sakla" sorulur.
- **Güvendeyim düğmesi:** tek dokunuşla seçilen çemberlere "iyiyim" + konum + pil. Mevcut şifreli bildirim yolundan gider; zayıf ağda kuyruğa alınır, küçük paketle tekrar denenir. SMS yedeği ayrı karar (Bölüm 7).
- **"Neden eski?" durumu:** eski konumun yanında nedeni: çevrim dışı (saatiyle), pil tasarrufu, konum izni kapalı. Nedeni gönderen telefon bilir, şifreli nabız mesajına eklenir. Hayalet modda neden gösterilmez.
- **Zengin davet kartı:** davet linki WhatsApp ve Instagram'da önizlemeli açılır. Önizlemeyi o şirketlerin sunucuları çektiği için kişisel veri içermez (ad, fotoğraf yok); ad ve fotoğraf uygulamada çözülür.
- **Sade mod:** efekt, ses ve titreşim yoğunluğu ayarı (tam / az / kapalı); motion tokenlarıyla ölçeklenir, sistemin "Hareketi azalt" ayarından bağımsız.
- **Düşük detaylı dünya haritası:** Türkiye dışındaki arkadaş boş haritada kalmasın; self-host düşük zoom'lu dünya katmanı.
- **Lansman ölçümü (ertelendi, proje sahibi 2026-10-16):** konum ve kimlik içermeyen sayımlar (günlük aktif, davet başına katılan, 30. gün tutunma, ödemeye geçiş). Üçüncü parti analitik SDK'sı yok.
- **DoD:**
  - Satın alma, yenileme, iptal ve iade çemberdeki herkeste yenileme gerektirmeden WS olayıyla görünür (entegrasyon testi).
  - Ödeyeni kalmayan çember duraklar, biri abone olunca yenileme gerektirmeden açılır; duraklamış çemberde Güvendeyim çalışır (test).
  - Ödeme kayıtlarında ve log'larda konum, e-posta, token yok (otomatik test).
  - Güvendeyim uçak modunda kuyruğa girer, ağ gelince bir kez gider (test); içeriği APNs/FCM'de düz görünmez.
  - Davet önizlemesinde kişisel veri yok (test).
  - Bedava ve ücretli sınırlar ekranda yazılı, iptal tek dokunuş (3 kişiyle kullanılabilirlik testi).

### Faz 9C — Kullanışlılık ve Zenly hissi (2026-10-29)

Sahip, 2026-10-29: "Devam et hepsini yap planla herşeyi". Kaynak: [ürün geliştirme raporu](docs/arastirma/urun-gelistirme-2026-10-29.md). Kodlar (T1–T8, Ö1–Ö13) rapordakilerle aynı.

Raporun "önermediklerim" listesi bu fazda yok:
- seri tutma ve sıralama;
- sesli mesaj;
- galeriden fotoğraf ya da video;
- sürüş raporu;
- müzik paylaşımı.

Kurallar:
- Her paket tek APK, her APK'da tek QA turu (test oturumu). Paketin ADR'si koddan önce yazılır, PM onaylar.
- Paketin gizlilik politikası ve Play belgesi etkisini kod oturumu listeler; belgeleri PM günceller.
- Kripto, protokol ve tasarım kararları Opus'ta; geri kalan iş Sonnet'te.
- Kapalı test paketleri beklemez. Play hesabı ve 12 test kullanıcısı hazır olunca o anki en son APK ile başlar; sonraki paketler test sırasında güncelleme olarak çıkar.
- Her pakette Bargu'nun ilkeleri geçerli: sunucuya düz konum gitmez, yeni izin istemeden önce gerekçe, "her zaman konum" izni yok, 15–17 kuralları (ADR 0023) aynen.

**Sektör analizi kararları (PM, 2026-10-29).** Kaynak: [sektör analizi](docs/arastirma/sektor-analizi-2026-10-29.md). Sahip: "bizim daha iyi olmamız şart".
- **Bulgu:** "Eve vardım / varmadı" Life360, Snap ve Google'da 12 ay içinde çıktı. Uygulamasız süreli link Life360 ve Google'da var. Artık bunlar beklenen özellik. Bargu'nun farkı: sunucu bunları da göremez.
- **Yeni sıra:** B → C → D → E → F. Paket C (güvenlik) D'nin önüne alındı. C'nin ve E'deki Ö9'un ADR'leri B kodlanırken ayrı bir Opus oturumunda yazılır, PM onaylar. Kod sırayı bekler.
- **Paket C'ye eklenenler:**
  - Ö5 için rakiplerden ders: tek seferlik ve tekrarlı seçenek; tek seferlik kontrol 24 saatte kendiliğinden kapanır; uyarıdan önce birkaç dakikalık ek süre.
  - N1 tazelik: her kişide "3 dk önce" gibi etiket ve eskiyince olası neden (var olan "Neden eski?" üzerine). Pil çok düşünce telefon şifreli son konumu bir kez gönderir, çemberde "pili bitmek üzereydi" yazar. Ö5, eski konumla "varmadı" demez.
  - N4 yoklama "Herkes yerinde mi?": etkinlik çemberinde yalnız sahip başlatır, üyeler tek dokunuşla "Buradayım" der, 10 dakikada kapanır. Şifreli küçük öğe. 15–17'de en çok 8 üyeli çemberlerde. Yeni ADR.
- **Paket D'ye eklenenler:**
  - N2 "Sunucu ne biliyor?" ekranı: görür (e-posta, çemberler, güncelleme sıklığı, bildirim jetonu) ve göremez (konum, mesaj, fotoğraf, yer adları, geçmiş). Metin THREAT_MODEL'deki "kabul edilen sızıntı" ile aynı. Test oturumu metni kodla karşılaştırır.
  - N3 güvenli abonelik: Bargu+ ekranında fiyat ve yenileme tarihi, tek dokunuşla Play abonelik sayfası, yıllık planda yenilemeden 3 gün önce telefonda hatırlatma.
- **Paket E:** Ö9 linki etkinlik çemberinde de olur. Süreler 1, 4, 8 saat ya da gün sonu.
- **Sonraya:** N6 programlı gizlilik ("her gece 00–07 dondur") Faz 11'e. Grupta kişiye özel paylaşım v2'de kalır; kapalı testten sonra yeniden bakılır.
- **Sahibin kararı gerekir:** N5 bağımsız güvenlik denetimi ve `packages/crypto`'nun açık kaynak olması (para ve lisans). Kapalı testten sonra, açık yayından önce.
- **Kapalı testte ölçülecek:** deneme bitince "kim ödeyecek" sürtünmesi. Bump, whoo ve Snap ücretsiz.
- **Mağaza metni (paket çıktıkça PM günceller):** yarışsız kazıma haritası; varış tahmini telefonda hesaplanır ve konum kimseye gitmez; harita kendi sunucumuzda; pil ölçümü kanıt olarak.

**QA-39 (2026-10-29, `4f29fe7`):** Yüksek bulgu yok.
- Doğrulananlar: pil ayarları, yer adlarının yalnız telefonda bulunması, DM kontrastı, K14 ve QA-38 düzeltmeleri.
- Ek 1 şartları için açılan orta bulgu ve 1 düşük bulgu `f43919f` ile kapandı.
- Kalan 6 düşük bulgu A APK'sına girer:
  - etkinlik-yalnız kişiye view gitmez ve yeniden denenmez (PM kararı);
  - kişiyi unutunca görenler kaydı silinir;
  - toplu konumda en doğru konum seçilir;
  - sıklık sabitleri ADR 0036 ile uyumlu olur;
  - + yayı ve toast kayması sade moda uyar;
  - grup sohbetine ⋮ menüsü gelir (Bildir ve Engelle kolay bulunsun).

**Paket A: görünüm ve küçük kolaylıklar** (QA-39 düzeltmeleriyle birlikte)
- **Durum (2026-10-29):** kodlandı (`2c5f9f8`..`3821598`) ve QA-39'un tamamıyla birlikte `e1c7e4a` APK'sı yayında. CI yeşil.
- `e1c7e4a` için ayrı test turu yok (PM kararı, jeton tasarrufu). Bu APK'daki değişiklikler QA-41'de B APK'sıyla birlikte denenir.
- Ara düzeltme `9b0abb9` (sahibin ekran görüntülerinden):
  - ana düğmelerdeki geçiş düğmenin tamamını kaplıyor;
  - ilk kullanım ipucu düğmelerin üstünde çiziliyor;
  - QA-40 düşük 3 kapandı;
  - Ö7 bayrakla kapalı.
  - Bunun için de ayrı test turu yok, QA-41 kapsar.
- Ö1 "Sorun bildir" kullanıcının kendi e-posta uygulamasıyla gider, sunucudan geçmez. Gizlilik politikasına "destek yazışmaları" satırı eklendi (en geç 12 ay saklanır). Play formunda ayrı veri türü değil.
- Grup sohbetindeki ⋮ menüsünün iPhone bildirim eklentisi tarafı iOS dilimine kaldı.
- **QA-40 (`3821598`):** yüksek bulgu yok.
  - O1 (grup ⋮ menüsünde sessize al ve ayrıl yoktu): `e1c7e4a` ile kapandı; QA-41'de bakılacak.
  - O2 (kişi kartında Bildir ve Engelle yok): "Daha fazla" altına iki ayrı satır olarak eklenecek.
  - 6 düşük bulgu:
    - arka plan gönderim eşiği 50 sn;
    - düğme parlaması yazı kontrastını düşürmesin;
    - koyu temada iki renk çifti 4,5'e çıksın;
    - davet sayfası ve davet kartında mor kalmış, lacivert ve turuncuya geçecek;
    - Sorun bildir metni 500 karakter;
    - canlı aralık testi.
  - Hepsi paket B APK'sına girer.
- T1 renk: lacivert ve turuncu, geçişli (sahibin kararı; ADR 0008 eki).
- T2: + düğmesi hızlı eylem menüsü açar.
- T3: kişi kartında 3 ana eylem.
- T4: harita üstünde tek bilgi kartı.
- T5: hayalet modu her yerde aynı üç seçenek ve aynı adlar.
- T6: ilk kullanım ipuçları.
- T7: boş ekranlarda davet düğmesi.
- T8: yeni ekranlarda koyu tema ve büyük yazı kontrolü.
- Ö1: "Sorun bildir".
- Ö3: mesaja ve hikayeye emoji tepki (ADR 0035 eki).

**Paket B: kontrol**
- Ö2 pil modu: Canlı / Dengeli / Pil dostu, "bugün GPS şu kadar çalıştı" bilgisiyle (ADR 0036 eki). Sahibin pil ölçümünden sonra.
- Ö6 kişiye süreli paylaşım ve tek kişiye sessiz dondurma: "21:30'a kadar" (Faz 11'den öne alındı).
- Ö8 "Yakındayım, gelir misin?": tek dokunuş, seçilen çembere. Mesafeyi alan telefon hesaplar; yeni şifreli tür.
- **PM kararları (2026-10-29):**
  - **ADR 0037 (Ö8) kabul.**
    - Mesafe 50 m'ye yuvarlanır. Gönderenin hassasiyeti tam değilse yalnız "yakınlarda" yazar.
    - Hayalet modda kapalı.
    - 15–17 için yalnız arkadaşlıklarda ve en çok 8 üyeli çemberlerde var.
    - Hazır cevaplar "Geliyorum" ve "Şimdi olmaz" sıradan yazı mesajı olarak gider.
  - **ADR 0038 (Ö6) kabul.**
    - Yalnız arkadaşlıklarda var. Gruptaki kişiyi çemberin ayarı yönetir; kişiye özel paylaşım v2 fikri.
    - Süre dolunca arkadaş haritadan kaybolur, iki tarafa tek satırlık bilgi düşer.
  - Ö2 sahibin pil ölçümünü bekliyor.
  - Bu arada paket D (Ö7, Ö12) başladı.
  - **Sahibin istekleri (2026-10-29), B APK'sına girer.** Sahip: "APK'yı en son çık", yani ara APK yok.
    - Haritada kendi pin çerçevesi görünmüyor; neden aranıyor.
    - Haritadaki Mağaza şeridi küçülür: yazısız, geçişli, yuvarlak düğme.
    - Hayalet düğmesinin yanındaki yazı kalkar, yalnız ikon kalır. Bu, T5'teki "kısa etiket" maddesini sahibin kararıyla geri alır.
    - PM şartı: ikon üç durumu (Kapalı, Dondur, Gizle) yalnız renkle değil, şekliyle de ayırt ettirir. Ekran okuyucu durumu söyler. Gizli olduğunu fark etmemek olmamalı.
    - Genel ilke: haritada az yer kaplamak.
  - **Sıra (PM, 2026-10-29): B ve D ayrı APK.** Önce B (QA-40 bulguları, Ö8, Ö6), sonra D (Ö7, Ö12).
    - Ö7'nin kodu B'den önce main'e girdiği için B APK'sında Ö7'ye giriş gizli kalır. Kayıt kapalıdır, açılamaz, hiçbir şey yazılmaz.
    - QA-41 bunu da kontrol eder: ayarda ve haritada Ö7'ye giriş yok, telefonda geçmiş dosyası oluşmuyor.
    - Ö7, D APK'sında Ö12 ile birlikte açılır. Açılmadan önce gizlilik politikası, /gizlilik ve veri güvenliği formu Ö7'yi anlatır (yalnız telefonda, Bargu+).

**Paket C: güvenlik**
- Ö5 eve vardım kontrolü (Faz 11'den öne alındı). Yeni ADR gerekir, tasarım Opus'ta.
- Önerilen yol "mühürlü emanet":
  - Telefon, seçilen kişilere uyarıyı baştan şifreler ve sunucuya bir açılma saatiyle bırakır.
  - Yol boyunca son konumla yeniler.
  - Kişi varınca ya da "iyiyim" deyince uyarı silinir.
  - Varmaz ve cevap vermezse sunucu, açamadığı uyarıyı saatinde iletir. Böylece telefon kapansa bile uyarı gider.
- Sunucu yalnız "bir emanet var" ve saatini görür. Ekranda KADES ve 112 kısayolu olur. Bargu acil servis değildir; bu ekranda yazar.
- THREAT_MODEL ve gizlilik politikası güncellenir.

**Paket D: kendi dünyan**
- Ö7 kendi konum geçmişin ve kazıma haritası (ADR 0030, onaylı): gün gün iz, duraklar, gezilen yerlerin açılması. Hepsi telefonda.
- Ö12 varış tahmini: "eve 12 dk", "4 dk'ya orada". Telefonda, mesafe ve hızdan hesaplanır ve "yaklaşık" yazar. Yol tarifi motoru eklenmez.

**Paket E: dışarıya açılan**
- Ö9 uygulamasız şifreli konum linki (Faz 11'den). Yeni ADR ve THREAT_MODEL gerekir.
  - Anahtar linkin # kısmında durur. Link süreli, tek dokunuşla iptal edilir.
  - Sayfa kendi haritamızla bargu.app'te açılır, bu yüzden alan adı gerekir.
- Ö11 "Bir aradasınız" anı: iki arkadaş buluşunca iki telefonda küçük bir kutlama. Telefonda hesaplanır, sade moda uyar. Seri ya da sayaç yok.

**Paket F: ana ekran ve yüz yüze**
- Ö10 Android widget'ı: arkadaşların yüzü ve uzaklığı.
  - Yerel modül gerekir; bağımlılık gerekçesi ve ADR yazılır.
  - Kilit ekranında görünüp görünmeyeceği ayardan seçilir.
- Ö13 sallayarak ekleme. Ancak sunucuya konum vermeyen bir yol bulunursa yapılır (örneğin Bluetooth ile yakındaki telefonu bulmak). Önce kısa bir tasarım denemesi (spike) ve ADR. Yol yoksa QR kalır, PM kapatır.

**Bitiş şartı:** Her paket için:
- QA'nın yüksek ve orta bulgusu yok;
- testler ve Linux CI yeşil;
- sahip telefonda denemiş;
- DURUM.md'de satırı yazılı;
- gerekiyorsa gizlilik ve Play belgeleri güncel.

### Faz 10 — Sertleştirme & Yayın
- OWASP MASVS L2 + ASVS L2 checklist; mümkünse bağımsız pentest.
- Maestro ile kritik akış E2E testleri (onboarding, davet, paylaşımı durdur).
- k6 ile WS yük testi (10k eşzamanlı bağlantı).
- Sentry (PII scrubbing), OpenTelemetry, Grafana + alarmlar.
- Prod: en az yetkili DB rolü, şifreli yedek (WAL-G) + restore testi, Redis ACL + TLS, firewall, Caddy (TLS 1.3, HSTS).
- SPKI pinning (2 yedek pin) + rotasyon planı.
- EAS Build/Submit; OTA güncellemeleri kod imzalı veya kapalı; `runtimeVersion` fingerprint policy.
- **Play derleme ve imza (`docs/play-store/KONTROL-LISTESI.md`):** K1 AAB profili (EAS ve yerel betik), K2 upload key (depoya girmez, sahip iki yerde yedekler), K3 targetSdk 36, K4 artan versionCode, K5 `app.bargu` son onay, K6 Play App Signing sertifikası sunucudaki Play Integrity izin listesine, K8 inceleyici için demo hesap, K9 Open-Meteo ticari plan ya da kendi sunucu, K12 kalıcı alan adı: **bargu.app** (proje sahibi 2026-10-23). Geliştirici markası Otenus: Play'de geliştirici adı "Otenus", geliştirici sitesi otenus.com (Bargu ürün ve gizlilik sayfasıyla), destek support@otenus.com. Bargu'nun hizmet adresleri bargu.app altında (ör. api.bargu.app); sunucu değişince yalnız DNS değişir, uygulama yeniden derlenmez. 14 günlük kapalı testin saati erken başlasın diye K1–K4 hesap açılır açılmaz yapılabilir.
- **Önce Google Play:** 13 Kasım 2023'ten sonra açılan kişisel geliştirici hesabı, üretime çıkmadan önce en az 12 test kullanıcısıyla 14 gün kesintisiz kapalı test yapmak zorunda ([Google](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)). Hesap ve 12 kişilik test grubu Faz 10'dan önce hazırlanır (proje sahibi); bu grup ilk lansman grubunun çekirdeği olabilir. iOS yayını Apple üyeliğinden sonra.
- **Deneme mağazaya taşınır:** gerçek ödemeye geçince 21 günlük deneme, Google Play'in kendi ücretsiz deneme teklifiyle verilir (Google hesabı başına bir kez); hesabı silip yeniden açarak yeni deneme alma riski böylece kapanır (QA 19 P5, ADR 0024).
- **İleri uyumluluk:** telefon bütün sunucu cevaplarını yeni alanları atlayarak okusun; istekler katı kalsın. Böylece sunucuya alan eklenince kurulu APK'lar bozulmaz (32b0f2d'de çember ve üye kartı için yapıldı). Tanımadığı tür değerini (yeni istek ya da bildirim türü) de bozulmadan atlasın. Sunucu, yeni bir türü onu tanımayan eski sürüme (x-bargu-client seviyesi düşük) göndermesin (2c'de ebeveyn isteklerindeki "purchase" türüyle başladı). Şifreli profil içeriği de tanımadığı alanı atar (b85ac9d); tanımadığı içerik türünü alıcı yok sayar.
- **Deniz (proje sahibi 2026-10-21):** EVREN modeliyle yönetilen, İstanbul'da yaşayan uydurma bir kişi. Proje sahibinin hobi ve deneysel işi; Bargu'dan ayrı tutulur ("o işi bu projeden ayrı tut"). Bargu deposuna, ADR'lerine ve CI'ına girmez; staging sunucusunda ayrı çalışır ve Bargu'ya yalnızca bir test kullanıcısı gibi API'den bağlanır. Bargu için tek kural: Deniz gerçek kullanıcılara asla gerçek bir insan gibi gösterilmez, kapalı testten önce gerçek test kullanıcılarının çemberlerinden çıkarılır.
- **Test botu (@deneme.arkadas):** kodu depoya alınır (sırlar dışarıda), kaynağı `/tmp`'den kalıcı bir yere taşınır. Bot, staging sunucusunda çemberdeki kişilerin konumunu çözüyor ("tour" kipi proje sahibinin konumunun çevresinde dolaşır). Bu yüzden konum asla loglanmaz, ve kapalı test başlamadan önce bot gerçek test kullanıcılarının çemberlerinden çıkarılır.
- **Uygulamayı silip yeniden kuran kullanıcı (proje sahibinin 2026-10-22 deneyimi; kapalı testten önce karar):**
  - Yerel anahtarlar gidince çember başına paylaşım seçimleri, sessize almalar, güven kayıtları ve kendi izin kaybolur. Bunlar bilerek telefonda.
  - Ayrıca eski anahtar döneminde mühürlenen kayıtlı yerler, buluşma belgeleri ve 14 günlük çember geçmişi, onları yeniden mühürleyecek başka etkin bir üye yoksa yeni telefonda açılmaz.
  - Seçenekler (ADR ile): "telefon değiştiriyorum" akışında eski telefondan yenisine QR ile kasa aktarımı; geçiş anahtarı ya da parolayla şifreli hesap yedeği (Açık Kararlar'daki "uzun yedek"); çemberdeki her etkin üyenin uygulamasının yerleri kendiliğinden yeniden mühürlemesi.
  - Küçük düzeltme: geri dönen kullanıcıya yaş sorusu sorulmasın ya da sorunun yok sayıldığı açıkça yazsın.
- **İmzalı sunucu haberleri (QA 28 B-1, kapalı test kapısı; ✅ staging'de 2026-10-23, MIN_CLIENT_LEVEL=5, eski sürümler 426 alıyor):** bütün sunucu haberleri (ADR 0016 notice) sunucunun ayrı bir anahtarıyla imzalanır; imza alıcı cihazı, zamanı ve haber kimliğini kapsar. Telefon gömülü açık anahtarla doğrular, tazelik ve tekrar denetimi yapar. İmzasız haber atılır. Kapalı test, telefon tarafı yayında olmadan başlamaz; üretim için ayrı anahtar.
- **Süs geçiş belgesi için üretim imza anahtarı:** ayrı bir anahtar ve kid üretilir, açık anahtar üretim derlemesine girer. O zamana kadar üretim derlemesi hiçbir süs belgesine güvenmez, yani süsler görünmez (ADR 0025 §2).
- **Emülatörde duman testi** (2026-10-21'deki donmadan sonra): Jest, Reanimated worklet'lerini JS thread'de çalıştırdığı için UI thread hatalarını görmez; bc5f925'teki worklet olmayan fonksiyon çağrısı telefonu dondurdu. Her APK'dan önce bir Android emülatöründe kısa bir açılış ve harita testi (CI'da ya da yerelde). O zamana kadar `worklet-calls` testi bu hata türünü yakalar.
- **Geliştirici araçları production paketinden derleme zamanında çıkar** (QA 25): bugün kapalı da olsa sürü denemesi, test satın alma ve kripto ölçümü kodu pakette duruyor; ölçüm katmanı gibi bayrakla tamamen dışarıda kalsın. Doğrulama `expo export --clear` ile.
- **Dış tarama notları (GPT taraması, 2026-10-21; PM doğruladı):**
  - `decode-uri-component` 0.2.2 (GHSA-vcc3-ghjq-m6fr, orta): expo-router'ın bağlantı ayrıştırmasıyla uygulamada çalışıyor. Bozuk bir davet bağlantısı uygulamayı dondurabilir. Gelen bağlantı ayrıştırılmadan önce süzülsün (`+native-intent`: uzunluk, bilinen yollar, bozuk yüzde kodlaması reddedilir). Expo ile uyumluysa yamalı sürüme geçilsin. Bir sonraki uygulama dilimine.
  - `uuid` 7/8 (GHSA-w5hq-g745-h8pq, orta): yalnızca iOS proje araçlarında (xcode, @bacons/xcode), uygulamaya girmiyor; Expo güncellemesinde kendiliğinden kalkar.
  - Kullanılmayan kod adayları (Knip): `memoryVaultForTests` gerçekten ölü; yalnızca dosya içinde kullanılan export'lar temizlensin. Toplu temizlik Faz 10'da, her aday elle doğrulanarak.
- Jailbreak/root tespiti: sadece uyarı.
- **DoD:** kritik/yüksek bulgu yok, restore testi başarılı.

### Faz 11 — Yayın Sonrası: Büyüme (ilk 3 ay)
- **Eve vardım kontrolü (Faz 9C paket C'ye alındı, 2026-10-29):** hedef ya da süre seçilir; varılmaz ve cevap verilmezse seçilen kişilere konum ve pil gider. KADES ve 112'ye kısayol (yalnızca bağlantı; Bargu acil servis değildir).
- **Uygulamasız şifreli konum linki (Faz 9C paket E'ye alındı):** süreli web linki; anahtar linkin `#` kısmında, sunucuya hiç gitmez; sayfa self-host haritayla çizer. Süre bitince ya da tek dokunuşla iptal. ADR + THREAT_MODEL güncellemesi (link sızarsa ne olur).
- **Widget ve Live Activity (Android widget'ı Faz 9C paket F'ye alındı; iOS sonra):** Android ana ekran widget'ı; iOS kilit ekranında "Yoldayım, 4 dk" (varış tahmini). İçerik şifreli kalır (Bölüm 8'den taşındı).
- **Yüz yüze ekleme (Faz 9C paket F, şartlı):** QR'a ek olarak telefonları sallayarak ekleme.
- **Özel bitiş saati ve kişiye dondurma (Faz 9C paket B'ye alındı):** "21:30'a kadar" gibi süre; tek kişiye sessizce dondurma.
- **Programlı gizlilik (sektör analizi N6, 2026-10-29):** "Her gün 00:00–07:00 çemberimde dondur" gibi tekrarlı kural. Telefon her güncellemede saate bakar; kesin alarm izni gerekmez. Yeni izleyici bildirimi ve "Beni kimler görüyor" bozulmaz; 15–17 için ADR 0023'e bakılır.
- **Davet ödülü:** davet eden ve gelen birer ay Bargu+. Nakit ödül ve zorla davet yok.
- **Etkinlik paketi:** Faz 8 etkinlik çemberinin, düzenleyenin ödediği süreli paketi (gezi, tur, kamp); katılımcı bedava. Fiyat denemesi.
- **Kendi geçmişin (Bargu+, isteğe bağlı):**
  - **Temel görünüm öne alındı** (proje sahibi 2026-10-22: "Kendi konum geçmişimi de görebilmek istiyorum"): Faz 9B kapanışından hemen sonra, kendi izini gün gün haritada ve duraklar listesiyle görmek. Keşif haritası, rotalar, haftalık özet ve yıl sonu kartı Faz 11'de kalır.
  - Tasarım (PM onayı 2026-10-22; ADR 0030, iki dilim; kod sahip seviye 5 APK'sını denedikten sonra):
    - Yalnız paylaşım açıkken gelen konumlar kaydedilir: tam paylaşımda iz, yalnız yaklaşık paylaşımda kaba noktalar. Hayalette, kimseyle paylaşmazken ve plan bitince kayıt yok.
    - Ayrı şifreli dosyalar, ay başına bir tane, ayrı anahtar. Varsayılan süre 30 gün, istenirse 1 yıl.
    - 15–17 açabilir; varsayılan kapalı, ebeveyn görmez.
    - Kapı telefonda; kabul edilen risk.
  - Kapalı başlar; kullanıcı açarsa çalışır. Kendi izin telefonda, şifreli kasada tutulur (ADR 0019'daki yerel kayıt). Aşağıdaki özetler telefonda üretilir, sunucuya gitmez.
  - İçinde: keşif haritası ("kazıma haritası"), "geçen cumartesi neredeydim" rotaları, haftalık özet, paylaşılabilir yıl sonu kartı ("2026'da 14 şehir, 230 buluşma"; kartta koordinat yok).
  - Kayıt yalnızca paylaşım açıkken zaten alınan konumlardan yapılır; ayrıca arka planda konum istemez (Play beyanı tek özellik kalır).
  - Süre seçilir (30 gün / 1 yıl), tek dokunuşla silinir, dışa aktarılabilir. Abonelik bitince kayıt durur ama mevcut geçmiş silinmez; görülebilir ve dışa aktarılabilir.
  - Arkadaşların izi yalnızca çember geçmişi kurallarıyla görünür (Ek iş, ADR 0019; Bargu+ ile son 14 gün). THREAT_MODEL güncellenir: kilidi açık telefonda geçmiş görünür, biyometrik kilit önerilir.
- **Lansman (ertelendi, proje sahibi 2026-10-16; davet ödülüyle birlikte):** önce tek bir fakülte, yurt ya da kulüp; 72 saatte grubun %25'i aktif değilse sebebi bulunmadan genişlenmez. Şubat 2027 deneme, Eylül 2027 yeni kayıt dönemi. Ücretli içerik paylaşımlarında "#Reklam" etiketi.
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
- **Hosting:** kapalı test bugünkü staging sunucusunda (proje sahibi 2026-10-23, seçenek A; ADR 0034). Canlıya geçerken Türkiye'de bir sunucuya taşınır; böylece yurt dışı aktarım sorunu da kalkar. A'nın riskleri bedava önlemlerle azaltılır: gece ve dağıtım öncesi şifreli yedek, sunucu dışında kopya, geriye uyumlu migration'lar. Hesap verisi AB'de tutulduğu sürece KVKK'daki yurt dışı aktarım şartı (standart sözleşme ve bildirim) avukata sorulur.
- **Marka:** renk paleti ve display font. Logo proje sahibinden geldi (2026-10-23, ADR 0008 eki); ay yıldız marka tescilinde engel olabilir, avukata sorulacak.
  - **Renk kararı (sahip, 2026-10-29):** "Lacivert turuncu renk geçişleri". Lacivert ana renk, turuncu vurgu; ikisi logodan örneklenir. Mor çıkar.
  - Lacivertten turuncuya geçiş şu yerlerde kullanılır: + düğmesi, hikaye halkası, kendi mesaj baloncukların, Mağaza ve Bargu+ şeridi, ana düğmeler. Yazı yoğun yüzeylerde kullanılmaz.
  - Kontrast AA olmalı ve testle denetlenir. Kişilerin seçtiği pin renkleri ve süsler değişmez. Ayrıntı ADR 0008'in yeni ekine yazılacak.
- **Kullanışlılık paketleri:** sahip 2026-10-29'da raporun tamamını istedi. Plan: Faz 9C, paket A–F (Bölüm 5).
- **Mesajlaşma ve anlık hikaye (ADR 0035; 0032 ve 0033'ün yerine geçti):** 2026-10-23'te PM kararıyla kapalı test sonrasına kalmıştı. Proje sahibi 2026-10-27'de yapılmasına karar verdi: "hikaye de olsun anlık paylaşım foto sadece o şekilde paylaşılabilsin hikayeyi birine de paylaşabilirsin herkese de ... farklı modül yapmaya gerek yok ... 24 saatte de silinsin mesajlar. diğer tüm detayları belirle sen". PM'in belirlediği kurallar:
  - **Tek modül:** Yazılı mesaj ve anlık fotoğraf aynı yerde. Fotoğraf yalnızca uygulamanın kamerasıyla o an çekilir; galeriden yükleme ve video yok.
  - **Kime:** Bir kişiye, bir çembere ya da "hikaye" olarak bütün çemberlerine (ya da seçtiklerine). Yalnızca çember üyeleri arasında; yabancı, keşfet ya da herkese açık akış yok.
  - **Ömür:** Her şey gönderildikten 24 saat sonra sunucudan ve telefonlardan silinir. Hikaye, haritada kişinin pininin çevresinde halka olarak görünür.
  - **Gizlilik:** Uçtan uca şifreli; sunucu yalnızca şifreli kopyayı ve kimin kime gönderdiğini görür. Bildirimde içerik yok. Android 14+'da ekran görüntüsü alınınca gönderene haber verilir. Ekran görüntüsü engellenmez, çünkü başka bir telefonla fotoğrafı çekmek yine mümkün; engel sahte bir güven verir.
  - **Güvenlik (Play kullanıcı içeriği ve çocuk güvenliği şartları):** her mesaj ve hikayede "Bildir" (bildiren kişinin telefonu içeriği açıp bize gönderir, kişi bunu bilerek yapar); kişiyi "Engelle"; otenus.com'da topluluk kuralları ve çocuk güvenliği standartları sayfaları; iletişim support@otenus.com. Çocuk istismarı bildiriminde içerik saklanır, hesap kapatılır ve yetkililere bildirilir. İçerik taranmaz (uçtan uca şifreleme); denetim bildirime dayanır.
  - **15–17:** Aynı kurallar; ebeveyn mesajları göremez. Bildir ve engelle her ekranda bir dokunuş uzakta.
  - **Sınırlar:** Kişi başına günde en çok 50 fotoğraf ve 500 mesaj; fotoğraf telefonda küçültülür (en çok ~500 KB); sunucuda fotoğraflar için toplam disk sınırı ve dolarken uyarı (staging rastamen'le ortak).
  - **Ödeme:** Mesaj ve hikaye duraklamış çemberde de çalışır, bedava (iletişim temel hizmet).
  - **Belgeler:** Gizlilik politikası güncellenir (şifreli mesaj ve fotoğraf, 24 saat; bildirilen içerik açık hâliyle 90 gün ya da yasal süre). Play'deki "Uygulama içeriği" beyanları (kullanıcı içeriği, çocuk güvenliği) güncellenir. Avukata sorulacaklar listesine eklenir.
  - **Tasarım:** [ADR 0035](docs/ADR/0035-messages-and-moments.md) (`ee79eea`). PM 2026-10-27'de şu eklerle onayladı:
    - zarflara ve dosyaya anahtar bağlılığı (bildirme kanıtı yalnız Poly1305'e dayanmasın);
    - hikayenin varsayılan kitlesinde etkinlik çemberleri yok, yalnız elle eklenir;
    - etkinlik çemberi silinince içindeki öğeler de silinir;
    - çekimden sonra tek ekranda "Hikaye / Çember seç / Bir kişi";
    - sunucu kurulumu (dosya dizini, env) apply-pending adımı olarak, sahip onayıyla;
    - Engelle ekranı "konumunu gizlemez, çemberden ayrıl" der.

    Cevaplar:
    - okundu bilgisi yok;
    - staging fotoğraf diski 2 GB, %80'de uyarı;
    - bildirim e-postası support@otenus.com, içeriksiz.

    İstemci seviyesi 6. `MIN_CLIENT_LEVEL` herkes yeni APK'yı kurana kadar 5'te kalır.
  - **Zaman:** Kod onaydan hemen sonra 5 dilimde başlar: M0 kripto (Opus), M1 sunucu, M2 yazı, M3 fotoğraf ve hikaye, M4 QA ve PM belgeleri.
  - **Durum (2026-10-27 14:50):** M0–M3 main'de, CI yeşil.
    - Commitler: M0 `9c0b0fd`; M1 `85ddbf8` ve `e31dae5` (staging'de, 41 migration); M2 `03bb2f4`; M3 `f883385` ve `54dddc5`.
    - QA-38 test oturumunda.
    - Play şartı olarak eklendi: ilk gönderimden önce topluluk kurallarını kabul (K14); sunucudaki /gizlilik kopyası yenilenecek.
    - PM belgeleri güncellendi: IZINLER, VERI-GUVENLIGI, GIZLILIK-POLITIKASI, MAGAZA-METNI, KONTROL-LISTESI (C13, C14, K14) ve yeni TOPLULUK-KURALLARI.md.
    - otenus.com'a iki sayfa eklenecek: /bargu/kurallar ve /bargu/cocuk-guvenligi. Bu işi ayrı bir oturum yapar; sahibin başlatması gerekir.
  - **QA-38 (2026-10-27):**
    - Kripto, yedek, sınırlar, günlükler ve 15–17 temiz; testler yeşil.
    - Y1: "Hikaye (bütün çemberlerim)" QR arkadaşa gitmiyordu.
    - O1: engellenen kişinin çember mesajı yine canlı ve bildirim olarak geliyordu.
    - O2: yalnız etkinlikte karşılaşanlar kişisel mesaj yazabiliyordu. **PM kararı:** kişisel mesaj için etkinlik dışı bir ortak çember gerekir; o çember gidince ikisi arasındaki kişisel öğeler silinir; etkinlikte yalnız grup sohbeti var.
    - 8 düşük bulgunun hepsi bu APK'dan önce düzelir.
    - Y1, O1 ve O2 için hedefli yeniden denetim yapılacak.
    - Düzeltmeler: `b0a61fb`; K14 kural kabulü: `0399316`. İkisi de staging'de, CI yeşil.
    - Hedefli yeniden denetim (QA-38b, 16:15): yüksek ya da orta bulgu yok; Y1, O1, O2 ve K14 doğrulandı.
      - 4 düşük bulgu APK'dan önce düzelecek.
      - PM kararı: kurallar penceresi göndermeden önce değil, Mesajlar'a ilk girişte, ilk fotoğraf ya da hikaye açılışında ve ilk gönderimde çıkar. Kabul etmeyen içerik açamaz. Böylece ekran görüntüsü haberi kabul etmemiş kişiden de gider.
  - **APK çıktı (2026-10-27):** `8dbccf9`, CI yeşil; staging bu sürümde.
    - İçinde: QA-38 ve 38b düzeltmeleri, K14, /gizlilik (`d2a5d8d`), aydınlatma sürüm 2.
    - Sunucu adımları sahibin onayıyla bitti:
      - yedek sohbet tablolarını almıyor;
      - `MEDIA_MAX_BYTES` 2 GB;
      - `OPS_EMAIL` support@otenus.com;
      - `MIN_CLIENT_LEVEL` 5.
    - Bekleyen: sahibin iki telefonla denemesi (8 madde). `MIN_CLIENT_LEVEL` 6'ya çıkarma kararı, bütün telefonlar bu APK'yı kurunca.
    - otenus.com/bargu/kurallar sayfası henüz yok; bağlantı 404 veriyor.
  - **Sahibin telefon denemesinden sonra (2026-10-28):** kod oturumu sahibin isteklerini APK'larda verdi.
    - APK'lar: `7d25fd8` pil; `e53ff09` alt çubuk; `2c87984` geçmişte yer adları, hikayeyi görenler, mesaj ekranları; `4f29fe7` Instagram DM düzeni.
    - **Hikayeyi görenler (ADR 0035 Ek 1):** PM 2026-10-29'da iki şartla onayladı:
      - görüntüleyen ilk açılışta bir kez "Açtığını {ad} görür." satırını görür;
      - telefon, hikayenin alıcısı olmayan birinden gelen görüntülenmeyi atar.

      Okundu bilgisi yine yok. Gizlilik politikasına cümle eklendi. Aydınlatma sürümü değişmez, çünkü bu bilinen bir davranış.
    - QA-39 (pil, görenler, yer adları, DM düzeni, K14) test oturumunda.
    - PM kararı: aydınlatma metni sürümü 2. Yeni APK'da herkes güncel gizlilik metnini bir kez yeniden onaylar.
  - **APK şartları:**
    1. QA-38'in bütün bulguları düzelir ve hedefli yeniden denetimden geçer.
    2. K14 yapılır.
    3. Sahip iki sunucu adımını onaylar: `install-backup.sh --apply`, ardından `apply-pending.sh --min-level 5` (adım 3b: `MEDIA_MAX_BYTES` 2 GB, `OPS_EMAIL`).

    Bilinen v1 sınırları:
    - Android 14'ten eski telefonda ekran görüntüsü haberi yok.
    - Gönderilemeyen fotoğraf yeniden denenmez; "Gönderilemedi, yeniden çek" yazar.
    - Sohbette fotoğraf "Fotoğraf" balonu olarak görünür.
  - **Sürüm kuralı (sahip, 2026-10-27):** "hepsini tamamlamadan yeni sürüm çıkmasın". Mesajlaşma ve hikayenin hepsi bitip testlerden ve QA turundan geçmeden yeni APK çıkmaz. Bekleyen düzeltmeler (52f338f, mağaza 7de32c1 ve sonrası) o APK'ya biner. İstisna yalnızca gerçek bir çökme ya da güvenlik sorunu; o zaman da önce PM karar verir.
- **Fiyatlar (PM önerisi, 2026-10-16; piyasa denemesiyle değişebilir):** Bargu+ ₺99,99/ay ya da ₺799,99/yıl; tek süs paketi ₺29,99, sezon paketi ₺49,99; etkinlik paketi ₺199–499 (Faz 11). Öğrenci indirimi doğrulama yolu bulununca. ₺99,99'luk aboneliğin net getirisi yaklaşık ₺57. Para modelinin kendisi kararlaştırıldı (Bölüm 1, Faz 9B).
- **Yaş sınırı ve doğrulama:** hukuki görüşe bağlı (Faz 9).
- **Güvendeyim SMS yedeği:** şebeke çökünce işe yarar ama SMS düz metindir; konumsuz "iyiyim" SMS'i mi, hiç SMS yok mu?
- **Gelirin vergi yapısı:** bireysel (20/B istisnası) ya da şirket; mali müşavirle.
- **Kendi geçmişinin uzun yedeği:** çember geçmişi sunucuda en çok 14 gün kalır; telefon değişince daha eski kendi izin kaybolur. Yalnızca dışa aktarma mı, yoksa şifreli uzun yedek mi? Uzun yedek ADR ister.

## 8. v2 Fikirleri
- Operatör kanalı: Turkcell Pasaj gibi pazar yerlerinde yıllık aile paketi kodu
- Apple Watch
- MLS'e geçiş, multi-device
- Grup çemberinde tek bir kişiye özel süreli paylaşım ya da dondurma: ayrı bir kripto tasarımı gerekir, çünkü konum çember anahtarıyla mühürleniyor (ADR 0038)
