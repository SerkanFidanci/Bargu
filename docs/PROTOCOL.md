# Bargu Protokolü v1

Konum ve çember içi her olay **uçtan uca şifrelenir**: sunucu yalnızca şifreli zarfı ve açık anahtarları
görür, hiçbir zaman düz koordinat görmez. Bu belge baytlara kadar kesin tanımdır; referans uygulama
[`packages/crypto`](../packages/crypto) (TypeScript), iOS bildirim eklentisi için
[`packages/crypto/swift`](../packages/crypto/swift) (CryptoKit). İki uygulama
[`fixtures/protocol-v1.json`](../packages/crypto/fixtures/protocol-v1.json) üzerinden CI'da karşılıklı
doğrulanır. Tasarım kararları: [ADR 0004](ADR/0004-e2ee-protocol.md). Tehditler:
[THREAT_MODEL.md](THREAT_MODEL.md).

## 1. Yapı taşları

| Amaç              | Algoritma                                   | Kütüphane (TS) | iOS       |
| ----------------- | ------------------------------------------- | -------------- | --------- |
| İmza              | Ed25519 (RFC 8032), katı doğrulama¹         | @noble/curves  | CryptoKit |
| Anahtar anlaşması | X25519 (RFC 7748), düşük mertebe reddedilir | @noble/curves  | CryptoKit |
| Anahtar türetme   | HKDF-SHA256 (RFC 5869)                      | @noble/hashes  | CryptoKit |
| Şifreleme         | ChaCha20-Poly1305 (RFC 8439), 12 bayt nonce | @noble/ciphers | CryptoKit |
| Özet              | SHA-256                                     | @noble/hashes  | CryptoKit |
| Rastgelelik       | İşletim sistemi CSPRNG'si²                  | —              | —         |

¹ `zip215: false`: kanonik olmayan kodlamalar ve S ≥ L reddedilir (imza esnekliği yok).
² Node/tarayıcı: Web Crypto; React Native: `expo-crypto` (iOS `SecRandomCopyBytes`, Android
`SecureRandom`). Kaynak yoksa kütüphane hata verir; güvensiz yedeğe düşmez.

Kendi primitive'imiz yoktur; yalnızca audit edilmiş kütüphanelerin standart fonksiyonları birleştirilir.

## 2. Kodlama kuralları

- **Kimlikler** (`circleId`, `deviceId`, `userId`): küçük harfli kanonik UUID metni; başlıklarda
  16 ham bayt.
- **Tamsayılar** (`epoch`, `seq`): u32, büyük-endian (4 bayt).
- **Etiketler**: UTF-8 + `0x00` sonlandırıcı (hiçbir etiket diğerinin öneki olamaz).
- **İkili alanlar** (JSON'da): base64url, dolgusuz, kanonik (fazladan bit taşıyan kodlama reddedilir).
- **Dolgu** (ISO/IEC 7816-4, `0x80` + sıfırlar): mesaj düz metni türü ve hassasiyeti ne olursa olsun
  **tam 512 bayta** tamamlanır (tek boy: boyuttan hiçbir şey çıkmaz; v1'in en büyük içeriği ~380
  bayt). Bildirim düz metni 128 baytın katına, en fazla 2048 bayta tamamlanır.
- `‖` birleştirme demektir.

| Etiket             | Kullanım                       |
| ------------------ | ------------------------------ |
| `bargu/v1/dh-key`  | DH anahtarı imzası             |
| `bargu/v1/skd`     | Sender key dağıtımı, HKDF info |
| `bargu/v1/skd-sig` | Sender key dağıtımı, imza      |
| `bargu/v1/msg`     | Mesaj anahtarı, HKDF info      |
| `bargu/v1/msg-sig` | Mesaj, imza                    |
| `bargu/v1/push`    | Bildirim kutusu, HKDF info     |
| `bargu/v1/safety`  | Güvenlik numarası              |

Mesajlar ve anlık fotoğraf (ADR 0035, §6'nın sonunda) kendi etiketlerini kullanır:
`bargu/v1/chat-key`, `bargu/v1/chat`, `bargu/v1/chat-sig`, `bargu/v1/chat-commit`, `bargu/v1/dm`,
`bargu/v1/dm-sig`, `bargu/v1/dm-commit`, `bargu/v1/blob`, `bargu/v1/blob-commit`.

`HKDF(ikm, salt, label, ctx)` = HKDF-SHA256, `info = label ‖ ctx`, çıktı 44 bayt:
ilk 32'si **anahtar**, son 12'si **nonce**.

## 3. Cihaz anahtarları

Hesap başına tek aktif cihaz (BARGU_PLAN §1). Her cihaz kayıtta üretir:

- `identity`: Ed25519 (imzalar), `dh`: X25519 (anahtar alır).
- `dhKeySignature = Ed25519.sign(identity, "bargu/v1/dh-key\0" ‖ deviceId(16) ‖ dhPub(32))`

Sunucuya yalnızca açık paket gider:

```json
{ "deviceId": "…", "identityKey": "b64u(32)", "dhKey": "b64u(32)", "dhKeySignature": "b64u(64)" }
```

Alıcı bir paketi kullanmadan önce doğrular: kimlik anahtarı geçerli ve küçük mertebeli değil, DH
anahtarı o kimlikle o `deviceId` için imzalı. Kimlik anahtarının kendisine güven, güvenlik numarası
(§8) ile kurulur; imza ise sunucunun DH anahtarını değiştirmesini engeller.

Gizli anahtarlar cihazdan çıkmaz (`expo-secure-store`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`,
iOS'ta bildirim eklentisiyle ortak Keychain grubu — Faz 2/7). Yalnızca iki 32 baytlık gizli değer
saklanır; açık anahtarlar ve imza bunlardan yeniden üretilir (Ed25519 deterministiktir).

## 4. Sender key ve dağıtımı

Her çemberde her üye cihazın her `epoch` için 32 rastgele baytlık bir **sender key**'i vardır. Bir
cihazın o epoch'ta çembere gönderdiği her mesaj bu anahtardan türetilir.

Dağıtım, alıcı cihaz başına bir zarftır:

```
header = 0x01 ‖ circleId(16) ‖ epoch(4) ‖ senderDeviceId(16) ‖ recipientDeviceId(16) ‖ ephPub(32)   // 85 bayt
shared = X25519(ephSecret, recipient.dhPub)                       // taze geçici anahtar
key, nonce = HKDF(shared, salt = ephPub ‖ recipient.dhPub, "bargu/v1/skd\0", header)
ct  = ChaCha20-Poly1305(key, nonce, aad = header, pt = senderKey)  // 48 bayt
sig = Ed25519.sign(sender.identity, "bargu/v1/skd-sig\0" ‖ header ‖ ct)
```

```json
{
  "v": 1,
  "circleId": "…",
  "epoch": 4,
  "senderDeviceId": "…",
  "recipientDeviceId": "…",
  "ephemeralKey": "b64u(32)",
  "ct": "b64u(48)",
  "sig": "b64u(64)"
}
```

Alıcıda sıra: biçim → gönderen ve alıcı eşleşmesi → **imza** → X25519 (düşük mertebe reddi) →
çözme. Sunucu imzayı gönderen cihazın kimlik anahtarıyla doğrulayıp saklar; içeriği okuyamaz.

### Rekey (epoch + 1)

Yeni sender key'ler üretilir ve yalnızca o anki üyelere dağıtılır:

- üye eklendi veya çıkarıldı,
- bir üye cihaz değiştirdi,
- 24 saat geçti,
- bir göndericinin sıra numarası durumu kayboldu.

Çıkarılan üyeye yeni epoch'un dağıtımı gitmediği için yeni mesajları çözemez (testle kanıtlı).

## 5. Mesaj zarfı

```
header = 0x01 ‖ circleId(16) ‖ epoch(4) ‖ senderDeviceId(16) ‖ seq(4) ‖ salt(16)   // 57 bayt
key, nonce = HKDF(senderKey, salt, "bargu/v1/msg\0", header)
ct  = ChaCha20-Poly1305(key, nonce, aad = header, pt = pad(JSON(payload)))
sig = Ed25519.sign(sender.identity, "bargu/v1/msg-sig\0" ‖ header ‖ ct)
```

```json
{
  "v": 1,
  "circleId": "…",
  "epoch": 4,
  "senderDeviceId": "…",
  "seq": 5,
  "salt": "b64u(16)",
  "ct": "b64u(528)",
  "sig": "b64u(64)"
}
```

- **Mesaj başına anahtar:** her mesaj kendi anahtarını türetir; kayıp veya sıra dışı paket diğerlerini
  etkilemez (O(1), ratchet durumu yok).
- **`salt`:** her mesajda 16 taze rastgele bayt. Uygulama `seq`'i kaydedemeden kapanıp aynı `seq`'i
  tekrar kullansa bile anahtar/nonce tekrarlanmaz.
- **`seq`:** gönderilmeden **önce** kalıcı olarak artırılır. Durum kaybolursa epoch yenilenir.
- **Tek zarf, tüm çember:** gönderen bir kez şifreler, her üye kendi kopyasındaki sender key ile açar.

Alıcıda sıra: biçim → çember/epoch/gönderen eşleşmesi → **imza** → tekrar penceresi → çözme →
dolgu → JSON → şema. Tekrar penceresi yalnızca başarılı çözmeden sonra ilerler.

**Tekrar koruması** (`ReplayGuard`), her **`(circleId, senderDeviceId)`** için ayrı tutulur (epoch ve
`seq` çember başınadır):

- **Kayan pencere** (IPsec / DTLS gibi): epoch içinde en büyük `seq`'in 64 gerisine kadar sırası
  karışmış mesaj **bir kez** kabul edilir; aynı `seq` ikinci kez ve pencerenin gerisi reddedilir
  (`REPLAY`). Böylece geç gelen `place_enter` gibi olaylar kaybolmaz.
- **Epoch tabanı:** epoch N kabul edildikten sonra N − 2 ve öncesi reddedilir — o epoch'un anahtarı
  hâlâ saklanıyor olsa bile. Sunucu eski bir dağıtımı ve eski mesajları yeniden gönderemez.
- **Konum son-yazan-kazanır:** bu göndericiden daha yeni bir konum kabul edildiyse, eski konum
  doğrulanır ve kaydedilir (tekrar gönderilemez) ama `STALE` hatasıyla teslim edilmez.
- Durum şifreli yerel önbellekte saklanır, yeniden başlatmada pencere açılmaz. Anahtar deposu
  (Faz 4) mevcut epoch'tan eski bir dağıtımı kabul etmez; iOS bildirim eklentisi (Faz 7) aynı
  durumu uygulama grubundan paylaşır.

**Sunucu** imzayı ve gönderenin çember üyeliğini doğrular (`verifyMessageEnvelope`), sonra iletir.

## 6. İçerik (payload)

Zod ayrık birleşimi (`kind`), bilinmeyen alan reddedilir ([`packages/schemas`](../packages/schemas));
`profile`, `look` ve `state` bilinmeyen alanı atar (ADR 0024 §10), bilinmeyen tür `MALFORMED` olur ve
alıcı yok sayar:

| `kind`        | Alanlar                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `loc`         | `lat, lng, acc, spd?, hdg?, bat (0–100), chg, since?, eta?, ts` (ADR 0018)                       |
| `bump`        | `ts`                                                                                             |
| `poke`        | `to, style, say?, ts`: ifadeli dürtme; yalnız `to` gösterir (ADR 0031)                           |
| `place_enter` | `placeId, ts`                                                                                    |
| `place_exit`  | `placeId, ts`                                                                                    |
| `share_stop`  | `ts`                                                                                             |
| `status`      | `emoji? (≤16), text? (≤80), expiresAt, ts`                                                       |
| `profile`     | `photo` (`{ id, key }` ya da `null`), `ts` (ADR 0014)                                            |
| `place`       | `id, name (≤40), emoji (≤16), lat, lng, radius (50–1000 m), ts` (ADR 0015)                       |
| `late`        | `meetAt, minutes (1–600), ts`: buluşmaya gecikme (ADR 0018)                                      |
| `look`        | `ring, frame` (kimlik ya da `null`), `pass` (geçiş belgesi ya da `null`), `ts` (ADR 0025)        |
| `safe`        | `id` (16 bayt, base64url), `lat, lng, acc, bat (0–100), ts`: Güvendeyim (ADR 0029)               |
| `state`       | `why` (`saver`, `permission`, `nofix`, `none`), `since, ts`, `end?`: konum neden eski (ADR 0028) |

**Güvendeyim (ADR 0029).** `safe`, sunucuda tutulmayan, tek seferlik bir mesajdır; dürtme gibi
`POST /v1/safe` ile (canlı bağlantı yok, yalnızca HTTP) gider ve çevrimiçi üyelere canlı `safe` olayı
olarak iletilir. Gövde `{ id, envelope, pushes? }`: `id` zarfın içindeki `id` ile aynı, **açık** gider
(rastgele 16 bayt, bir şey söylemez). Konum, **her çemberin kendi hassasiyetinde** (§7)
kısaltılır; çember başına ayrı zarf ve ayrı `id` vardır. Sunucu isteğin gönderenin cihazıyla imzalı ve
çemberin aktif üyesinden olduğunu (`verifyMessageEnvelope`, güncel epoch) denetler, içeriği göremez.
Duraklamış çemberde çalışır, hak denetimi yoktur. Gönderen ve çember başına saatte 6. Aynı
`(gönderen, çember, id)` 24 saat içinde ikinci kez gelirse sunucu `{ "ok": true }` der ve bir şey
göndermez; yalnızca `pseudonym(EMAIL_LOOKUP_KEY, "safe-id", gönderen:çember:id)` özetini `1` değeriyle
24 saat saklar. Cevap `{ "ok": true }` ya da `{ "refused": INVALID | NOT_MEMBER | EPOCH | RATE_LIMITED }`.
Alıcı `id`'yi görüp bir kez gösterir (tekrar penceresi zarfı, `id` mesajı sayar); aynı mesaj yalnızca
aynı çemberde, aynı gönderenden ve aynı `id` ile gelen demektir. Sunucu zarfın içini göremediği için
`/v1/safe`, `/v1/bumps` ve `/v1/place-events` her zarfı iletir; **alıcı türü yola bağlar** (`safe`
yolundan yalnızca `safe`, `safe` yalnızca `safe` yolundan, konum yalnızca konum yolundan, ADR 0029 §10)
ve bir gönderenin bir çemberdeki mesajlarından kayan saatte en çok 6'sını gösterir, kalanını tek sessiz
satıra katlar. Saati 5 dakikadan fazla ileri olan mesaj düşer.

**Neden eski? (`state`, ADR 0028 Ek).** Telefon, konumunun neden eski olabileceğini çemberlerine ayrı
bir tür olarak söyler: `saver` pil tasarrufu, `permission` konum izni kapalı, `nofix` konum
alınamıyor, `none` neden bitti. Konum, doğruluk, hız ya da pil seviyesi taşımaz; her mesaj gibi 512
bayta dolgulanır. Ayrı tür olmasının nedeni `loc`'un katı okunmasıdır: ona alan eklemek eski
uygulamaların her konumu reddetmesi demekti; `state`'i tanımayan eski uygulama `MALFORMED` sayıp
sessizce atar (`packages/crypto/test/legacy-app.spec.ts`). Neden başlayınca ya da değişince, sürdükçe
5 dakikada bir ve bitince (`none`) gönderilir; hayalette, kaba ve tam hassasiyette de yalnızca bu
(konumsuz) mesaj; konumun gitmediği çembere hiç gitmez (bunlar telefonun ayarlarıdır, sunucu bilmez).
"Çevrim dışı" gönderilmez, alıcı sessizlikten çıkarır. `end: 'timed'` (ADR 0038 Ek 1): bir
arkadaşlığın süreli paylaşımı bittiğinde, konum geri çekilmeden hemen önce o arkadaşlığa bir kez
`why: none` ile gider; alan telefon "… ile süreli paylaşım bitti" der. Eski uygulama alanı atar.
Geri çekme nedeni de sildiği için yalnız o an bağlı olan arkadaş duyar. **Taşıma, `look` gibi kendi yolu:** `POST
/v1/states` (canlı bağlantıda `state`), gövde `{ envelopes }`; sunucu üye ve çember başına yalnız en
yeni zarfı 24 saat tutar, diğer üyelere canlı `state` olayı yollar, sonradan bağlanan `GET /v1/states`
(ya da `states`) ile alır; üye çıkınca `state.gone`, konum geri çekilince nedeni de silinir. Üye
olmayanı, başka cihazın imzasını, geçmiş epoch'u, duraklı çemberi (`PAUSED`) ve cihaz ve çember
başına dakikada 3'ten fazlasını (`RATE_LIMITED`) reddeder. **Alıcı türü yola bağlar** (`receive.ts`
`Route`): `state` olayından gelen zarf yalnız `state` türü, `state` türü yalnız bu yoldan sayılır.

**Saklanan mesaj (yer).** Bir çemberin yeri, son kaydeden üyenin gönderen anahtarıyla şifrelenmiş
`place` mesajı olarak sunucuda kalır. Üyeler onu yeni mesajlardan çok sonra tekrar açtığı için
`decryptStoredMessage` tekrar penceresine bakmaz (imza, çember, epoch ve gönderen yine denetlenir)
ve yalnızca `place` kabul eder. Tekrar penceresi yerine sürüm kuralı vardır: bir yerin `ts`'i
yalnızca büyür (düzenleyen `max(şimdi, önceki ts + 1)` yazar); telefon elindekinden eski `ts`'i ve
silinmiş bir yeri geri almaz. Sunucu yalnızca çemberin **güncel** epoch'uyla mühürlenmiş yeri kabul
eder; epoch ilerleyince açabilen bir üye yeri kendi yeni anahtarıyla yeniden mühürler (yeni üyeler
eskisini açamaz).

**Belgeler (etkinlik, ADR 0018).** Etkinliğin buluşması (`plan`: `id = circleId, meetAt?, placeId?,
spot?, by?, ts`; `spot = { name, lat, lng, radius }` haritadan seçilen nokta, buluşmanın içinde durur, hiçbir zaman kayıtlı yer olmaz; `placeId` ile birlikte olamaz, ADR 0026 Ek 1), oylamaları (`poll`: `id, by, about (time | place), options (2–4), closed?, ts`) ve oyları
(`vote`: `id, pollId, choices, ts`) mesajla aynı başlık, anahtar ve imzayla, ama **1024 bayta**
dolgulanarak şifrelenir (`ct` 1040 bayt; `encryptDocument` / `decryptDocument` /
`verifyDocumentEnvelope`). Boyut iki zarfı ayırır: bir mesaj imzası belge, bir belge imzası mesaj
yerine geçemez; mesaj içerikleri belgeye, belge içerikleri mesaja konamaz. Belgeler yerler gibi tekrar
penceresiz açılır, `ts` yalnızca büyür, silineni telefon geri almaz. Oy kimliği
`UUIDv8(SHA-256("bargu/v1/vote-id\0" ‖ pollId ‖ userId))` (sürüm 8, varyant 10): alıcı, oyun onu
imzalayan kişinin kimliğiyle dosyalandığını denetler.

**Buluşmaya katılım yanıtı (ADR 0026 Ek 2).** Etkinlik dışı çemberde "Geliyorum / Belki /
Gelemiyorum" aynı `vote` belgesidir: `pollId` buluşmanın belge kimliği (çemberin kimliği),
`choices` tek eleman (0 Geliyorum, 1 Belki, 2 Gelemiyorum), kimlik `voteId(çember, kişi)`. Sunucu
yalnız o çemberin o an var olan buluşmasına, üyenin kendi yanıtı olarak yazdırır; buluşma silinince
yanıtlar da gider. Anketler bu oyları saymaz (oyları anketin kimliğini taşır).

**Konum geçmişi (ADR 0019).** Paylaşanın izi, çember başına çeyrek saatlik `trail` parçaları
(`from` = çeyreğin başı, `points` = 1–250 nokta `[saniye, enlem×1e5, boylam×1e5, doğruluk]`, `ts`)
olarak, çeyreğin başladığı epoch'ın **geçmiş anahtarıyla** şifrelenir:
`historyKey = HMAC-SHA256(senderKey, "bargu/v1/hist-key\0" ‖ circleId ‖ epoch(u32 BE) ‖ senderDeviceId)`.
Başlık mesajla aynı; anahtar/nonce `HKDF(historyKey, salt, "bargu/v1/hist\0", header)`, imza
`"bargu/v1/hist-sig\0" ‖ header ‖ ct`; düz metin 512, 2048 ya da 8192 bayttan sığan en küçüğüne
dolgulanır (`encryptHistory` / `decryptHistory` / `verifyHistoryEnvelope`). Ayrı anahtar ve
etiketler sayesinde geçmiş ile canlı mesajlar birbirinin yerine geçemez; alıcılar gönderen anahtarını
iki epoch sonra silmeye devam eder, yalnızca geçmiş anahtarını 15 gün daha tutar. Alıcı, parçanın
üyenin güncel cihazınca imzalandığını ve dosyalandığı çeyrek saatle (`from`) aynı olduğunu denetler.

**Mesajlar ve anlık fotoğraf (ADR 0035).** Çembere ya da bir kişiye giden yazı ve fotoğraf; hepsi
gönderildikten 24 saat sonra silinir. Konumla aynı anahtarı kullanmaz, kendi zarflarında gider:

```
// Çembere giden öğe
chatKey    = HMAC-SHA256(senderKey, "bargu/v1/chat-key\0" ‖ circleId(16) ‖ epoch(4) ‖ senderDeviceId(16))
base       = 0x01 ‖ circleId(16) ‖ epoch(4) ‖ senderDeviceId(16) ‖ id(16) ‖ salt(16)        // 69 bayt
key, nonce = HKDF(chatKey, salt, "bargu/v1/chat\0", base)
commit     = SHA-256("bargu/v1/chat-commit\0" ‖ key ‖ nonce)
header     = base ‖ commit                                                               // 101 bayt
ct         = ChaCha20-Poly1305(key, nonce, aad = header, pt = pad(JSON(öğe), 1024 | 8192))
sig        = Ed25519.sign(sender.identity, "bargu/v1/chat-sig\0" ‖ header ‖ ct)

// Bir kişiye giden öğe: alıcının cihazına, her öğede taze geçici anahtarla
base       = 0x01 ‖ senderDeviceId(16) ‖ recipientDeviceId(16) ‖ id(16) ‖ ephPub(32)       // 81 bayt
key, nonce = HKDF(X25519(eph, recipient.dhPub), salt = ephPub ‖ recipient.dhPub, "bargu/v1/dm\0", base)
commit     = SHA-256("bargu/v1/dm-commit\0" ‖ key ‖ nonce)
header     = base ‖ commit                                                               // 113 bayt
ct, sig    = yukarıdaki gibi, imza etiketi "bargu/v1/dm-sig\0"

// Fotoğraf dosyası: tek kullanımlık anahtarla
commit     = SHA-256("bargu/v1/blob-commit\0" ‖ blobKey ‖ nonce)
head       = 0x01 ‖ nonce(12) ‖ commit(32)                                                // 45 bayt
dosya      = head ‖ ChaCha20-Poly1305(blobKey, nonce, aad = "bargu/v1/blob\0" ‖ blobId(16) ‖ head, pt = jpeg)
```

- Öğe türleri (`chatPayloadSchema`): `text` (`id, text 1–1000 karakter, replyTo?, ts`), `photo`
  (`id, blobId, key, size, hash = SHA-256(dosya), w, h, caption? ≤ 200, story, ts`), `del`, `shot` ve
  `view` (`id, target, ts`; `view` hikayeyi açanın gönderene haberi, ADR 0035 Ek 1; gönderen onu
  yalnız o öğeyi gönderdiği kişilerden kabul eder) ve `react` (`id, target, emoji | null, ts`;
  altı tepkiden biri ya da geri alma, ADR 0035 Ek 2; mesaja verilen tepki yalnız mesajın sohbetinden,
  hikayeye verilen yalnız hikayenin gönderildiği kişiden sayılır) ve `near` (`id, ts`; "Yakındayım,
  gelir misin?", ADR 0037: içinde yer ya da mesafe yoktur; mesafeyi alan telefon, göndericinin o
  çemberde zaten paylaştığı son konumdan ve kendi konumundan hesaplar, 50 m'ye yuvarlar; konum kaba
  hücreden geldiyse yalnız "yakınlarda" der). İçerikteki `id` başlıktaki `id` olmalıdır. Bildirim
  gövdesi `near` (`circleId?, ts`) yalnız kimden geldiğini söyler; "Geliyorum" ve "Şimdi olmaz"
  düğmeleri sıradan `text` öğesi gönderir.
- **Anahtar bağlılığı (`commit`):** ChaCha20-Poly1305 bir şifreli metni tek bir anahtara bağlamaz;
  imzanın kapsadığı bu özet bağlar. Anahtar bağlılığı içermeyen temel başlıktan türetilir (yoksa
  döngü olurdu). Alıcı çözmeden önce denetler; uymayan öğe gösterilmez. Bildirimde (`revealChatItem`,
  `revealDirectItem`) telefon yalnız o öğenin `key` ve `nonce`'unu verir; sunucu imzayı, bağlılığı,
  çözmeyi ve şemayı denetler (`openReportedItem`). Uyan ikinci bir anahtar SHA-256 çarpışması olurdu.
- **Tekrar penceresi yok:** öğeyi rastgele `id`'si adlandırır; sunucu aynı `id`'yi iki kez yazmaz,
  telefon bir `id`'yi bir kez gösterir. `ts` son 24 saatin içinde ve en çok 5 dakika ileride olmalı;
  epoch tabanı (§5) sohbete uygulanmaz. Alıcı bir epoch'un sohbet anahtarını epoch bittikten sonra
  25 saat daha tutar.
- Boy ve etiketler zarfları ayırır: sohbet öğesi konum mesajının, belgenin ya da geçmişin yerine
  geçemez, tersi de olmaz; çember öğesi ile kişi öğesi de birbirinin yerine geçemez.
- Fotoğrafı açan önce dosyanın özetini içerikteki `hash` ile, sonra dosyanın bağlılığını denetler.
  Sunucuya en çok 600 KB'lık şifreli dosya yüklenir.

## 7. Hassasiyet (şifrelemeden önce, gönderende)

| Seviye  | Hücre  | Etki                                                                                    |
| ------- | ------ | --------------------------------------------------------------------------------------- |
| Tam     | —      | Değişmez                                                                                |
| Mahalle | ~1 km  | Hücre merkezine çekilir; `spd`/`hdg`/`since`/`eta` atılır; `acc` hücre yarıçapının katı |
| Şehir   | ~10 km | Aynısı, 10 km hücre                                                                     |

Rastgele gürültü değil, **sabit ızgara**: aynı yer hep aynı noktayı verir, ortalama almak gerçek konumu
ortaya çıkarmaz. Satır ve sütunlar 180°/360°'yi tam böler (tarih değiştirme hattında yarım hücre yok);
uygulama idempotenttir (property testiyle kanıtlı). Bilinen sınır: hücre sınırında dolaşan biri iki hücre
arasında gidip gelir (sınıra yakın olduğu anlaşılır).

## 8. Güvenlik numarası

Her kullanıcı için parmak izi:

```
h0 = SHA-256("bargu/v1/safety\0" ‖ userId(16) ‖ identityKey(32))
h(i+1) = SHA-256(h(i) ‖ identityKey)      // 5200 tur
fp = h(5200)[0..30]
```

Her 5 baytlık parça (büyük-endian) `mod 100000` → 5 rakam → kişi başı 30 rakam. İki parmak izi
**bayt sırasına göre** dizilip birleştirilir: 60 rakam (12 × 5). QR içeriği:
`bargu-sn:1:` ‖ base64url(fp₁ ‖ fp₂). Okutulan QR sabit zamanlı karşılaştırılır. Kimlik anahtarı
değişirse (yeni cihaz) numara değişir; uygulama ortak çemberlerde uyarı gösterir.

### Son ortak çember gidince kişiyi unutmak

Bu telefonun bir kişiyle **son** ortak çemberi gidince (kişi çıktı, çıkarıldı, telefon çıktı, çember
ya da etkinlik bitti) telefondaki o kişiye ait her şey silinir: "çemberden çıkmak iz bırakmaz" sözü
ve veri azaltma (KVKK) budur. Silinenler: fotoğraf ve görünüm, son konumlar, durum, "Neden eski?"
nedeni, "Güvendeyim" yerleri ve hangi mesajların gösterildiği hafızası, kişinin cihazlarının
gönderici ve geçmiş anahtarları, o cihazların tekrar (replay) penceresi, anahtar bekleyen mesajlar,
bellekteki doğrulanmış cihaz paketleri, dürtme / "geç kalıyorum" / "Geldim" kayıtları ve "yeni
izleyici" hafızası. Ortak çemberlerden biri gidip en az biri kalıyorsa **hiçbir şey silinmez**.

**İki istisna vardır; ikisi de bilerek tutulur ve çıkış yapınca ya da hesap silinince kasanın
tamamıyla birlikte gider** (testle korunur: `features/live/session-wipe.test.ts`):

1. **Güven kaydı** (`identity:<userId>`: kimlik anahtarı, yüz yüze karşılaştırıldı mı, değişti mi):
   kişi adı ve içerik yok, yalnız açık anahtar parmak izi. Aynı kişiyle yeniden karşılaşıldığında
   anahtar değişikliğini yakalamak için tutulur. Silinseydi, değiştirilmiş bir anahtar sessizce
   "ilk kullanım" sayılırdı (§3).
2. **Kullanıcının sessize alma ayarı** (`mutes:v1`, kişi başına `userId` ve iki bayrak: yer
   bildirimleri, dürtmeler): kişi adı ve içerik yok. Sessize almak kullanıcının kendi koruma
   seçimidir; kendisini rahatsız eden biri onu yeniden davet ederse önceki sessize alma yine
   geçerli olmalıdır, kaybolması bir güvenlik sorunu olurdu. Bildirim tercihleri ekranı böyle
   bir kaydı "Ortak çemberiniz olmayan bir kişi" olarak listeler; kullanıcı "Sesi aç" ile sesi
   geri verir ya da "Listeden kaldır" ile kaydı siler. iPhone'da bildirim eklentisinin kopyası da
   çıkışta silinir.

Nasıl çalışır: `circle-sync`, tam çember listesi bir kez yüklendikten sonra çember listesi her
değiştiğinde, ortak çemberi olan kişileri (ve cihazlarını) kasadaki `people:v1` kaydıyla karşılaştırır;
listeden düşenleri tek yerden siler (`features/location/forget-person.ts`). Uygulama kapalıyken
çıkanlar ilk tam listede bulunur; kısmi bir önbellek hiçbir zaman "çıktı" sayılmaz. Silme yarım
kalırsa kayıt durur ve bir sonraki değişiklikte yeniden denenir. Sınırlar: çemberin kendi belgeleri
(plan, oylardaki seçimler) çemberindir, kişinin değil; eski sürümden kalan "Güvendeyim" yeri kimlik
taşımaz ve en fazla bir gün sonra kendiliğinden silinir.

## 9. Bildirim (sealed box, ADR 0016)

Alıcı cihaz başına, gönderen bilgisi içermeyen kutu:

```
shared = X25519(ephSecret, recipient.dhPub)
key, nonce = HKDF(shared, salt = ephPub ‖ recipient.dhPub, "bargu/v1/push\0", ∅)
box = 0x01 ‖ ephPub(32) ‖ ChaCha20-Poly1305(key, nonce, aad = 0x01 ‖ ephPub, pt = pad(iç, 128))
```

Kutunun içi (`sealPush` / `openPush`):

```
üyeden:             0x01 ‖ senderDeviceId(16) ‖ sig(64) ‖ gövde
                    sig = Ed25519("bargu/v1/push-sig\0" ‖ recipientDeviceId(16) ‖ senderDeviceId(16) ‖ gövde)
sunucudan (imzalı): 0x02 ‖ len(kid)(1) ‖ kid ‖ issuedAt(8) ‖ id(16) ‖ sig(64) ‖ gövde
                    sig = Ed25519(NOTICE_SIGNING_KEY, "bargu/v1/server-notice\0" ‖ 0x01 ‖ len(kid) ‖ kid
                                  ‖ recipientDeviceId(16) ‖ issuedAt(8, BE, ms) ‖ id(16) ‖ gövde)
sunucudan (eski):   0x00 ‖ gövde      (haber anahtarı olmayan sunucu)
gövde (JSON) = { kind: "place", circleId, placeId, event: "enter" | "exit", name, emoji, ts }
             | { kind: "bump", circleId, ts }
             | { kind: "poke", circleId, style, say?, ts }   (ADR 0031: yalnız dürtülene)
             | { kind: "safe", circleId, id, bat, lat?, lng?, acc?, ts }   (ADR 0029: ad yok, metin yok)
             | { kind: "late", circleId, minutes, ts }
             | { kind: "meeting", circleId, name, emoji, meetAt, ts }
             | { kind: "meetingAnswer", circleId, answer: 0|1|2, going, maybe, ts }   (Ek 2: başlatana)
             | { kind: "meetingMoved", circleId, name, emoji, meetAt, ts }   (Ek 2: gelenlere)
             | { kind: "notice", notice, circleId, ts }
```

- Üyenin bildirimi, uygulamanın o cihaz için güvendiği kimlik anahtarıyla imzalı olmalı ve
  **alıcının** cihaz kimliğini kapsar (başka birine yeniden mühürlenemez); asla `notice` olamaz.
- Sunucunun kendi haberleri (`notice`) yalnızca tür + çember söyler (sunucu bu olayları zaten
  bilir); metni uygulama kendi dilinde yazar. Haberler **sunucunun haber anahtarıyla imzalıdır**
  ([ADR 0016 Ek](ADR/0016-sealed-push-notifications.md), QA-28 B-1): alıcı cihazın DH anahtarını
  her üye bildiği için imzasız bir haberi her üye uydurabilirdi. Anahtar süs anahtarından ayrıdır;
  `kid` en çok 16 karakter `[a-z0-9-]`; `issuedAt` gövdedeki `ts`'e eşit olmalıdır; `id` her habere
  16 rastgele bayttır. İmza kutunun içinde ham bayttır.
- Telefon bir haberi yalnızca derlemesinin güvendiği bir anahtarla (`EXPO_PUBLIC_NOTICE_KEYS`,
  `kid:base64url`; her derleme profili yalnızca kendi sunucusununkine), kendi cihazı için
  imzalanmış, taze (`watch` 2 dakika, öteki haberler 1 saat; en çok 5 dakika ileri tarihli) ve
  `id`'si görülmemişse kabul eder (`verifyServerNotice`); gerisini, imzasız haberler dahil, sessizce
  atar. TypeScript `openPush` imzayı yalnızca okur, denetlemez; Swift `openPush` güvenilen
  anahtarları alır ve imzasız haberi de reddeder. (1. adımın uygulaması imzalı ve imzasız haberi
  denetlemeden açar; daha eski uygulamalar imzalı haberi açamaz ve sessizce atar.)
- Tazelik (`ts`) ve tekrar (kutunun geçici anahtarı; sunucu haberinde ayrıca `id`) alıcıda
  denetlenir. `safe` bildirimi 24 saat geçerlidir (öbürleri 1 saat; mesaj göndericinin bağlantısını
  bekleyebilir) ve gövdesindeki `id` ile, aynı mesajın zarfı da gelmişse bir kez gösterilir.
- `safe` gövdesindeki `lat`, `lng`, `acc` birlikte gelir ya da hiç gelmez (önceki sürümden bir telefon
  yalnızca metin gönderir); zarftaki konumla aynı sayılar, yani o çemberin hassasiyetinde. En büyük
  gövde 219 bayt JSON, kutu 384 baytlık dolgu sınıfında (578 karakter): 128 baytlık blokların ve
  2048 bayt sınırının içinde, yeni boy yok. Alıcı yeri 24 saat şifreli kasada tutar (ADR 0029 §5).

Base64url olarak gönderilir (en çok 1.100 karakter). Android'de data-only FCM ile arka plan görevi,
iOS'ta bildirim eklentisi (yalnızca CryptoKit) açar; Google ve Apple yalnızca şifreli kutuyu, iOS'ta
ayrıca içeriksiz bir yer tutucu metni görür.

## 10. Değişmezler (testlerle korunur)

- Herhangi bir bitin değiştirilmesi reddedilir (property testi, 300 rastgele deneme); sohbet ve kişi
  öğelerinde de.
- Sohbet öğesi: yanlış bağlılık, bozuk dolgu, geçersiz UTF-8 / JSON / şema ve başlığından farklı
  `id` reddedilir; 24 saatten eski ya da ileri tarihli öğe düşer; bildirimde uydurma anahtar, başka
  imza ya da başka öğe reddedilir (`test/chat.spec.ts`).
- Tekrar, pencere dışı `seq` ve epoch tabanının altı reddedilir; doğrulanamayan mesaj pencereyi
  ilerletmez; iki çemberdeki aynı gönderici birbirini etkilemez; eski konum `STALE` olur.
- Her içerik türünün en büyük hâli dahil tüm zarfların `ct` boyutu aynıdır (528 bayt).
- Yanlış epoch / çember / gönderen anahtarı reddedilir; çıkarılan üye yeni epoch'u çözemez.
- Kötü niyetli ama geçerli anahtarlı gönderici (bozuk dolgu, geçersiz UTF-8/JSON/şema) reddedilir.
- RFC 7748, 8032, 8439 ve 5869 test vektörleri; `packages/crypto` %100 satır/dal/fonksiyon kapsamı.
- TypeScript çıktısı Swift/CryptoKit ile açılır (macOS CI). Swift tarafı da bilinmeyen alanı, yanlış
  boyutlu `ct`'yi ve kanonik olmayan UUID'yi reddeder. CryptoKit küçük mertebeli kimlik anahtarlarını
  kendisi reddetmez: eklenti yalnızca uygulamanın TypeScript ile doğrulayıp sakladığı anahtarları kullanır.
- Sunucu haberi: her türün gerçeği kabul edilir; imzasız, başka anahtarla, bilinmeyen `kid` ile,
  başka cihaz için imzalanmış (yeniden mühürlenmiş), bayat, tekrar eden ya da gövdesi değişmiş olanı
  reddedilir (TypeScript testleri ve ortak vektörler). `verifyServerNotice` ve `verifyCosmeticPass`
  hiç hata fırlatmaz. Güvenilen sunucu anahtarları listesine küçük mertebeli anahtar girmez.

## 11. Sürümleme

Her başlık `0x01` ile başlar ve JSON'da `v: 1` taşır. Uyumsuz değişiklik yeni sürüm + yeni etiketler
(`bargu/v2/…`) + yeni fixture dosyası demektir. Sabitler ve etiketler değişirse fixture testi kırılır;
bu bilinçli bir kapıdır.

Uygulamanın kendisi ayrıca bir istemci seviyesi taşır: `x-bargu-client` başlığı, canlı bağlantıda
`client` sorgu parametresi ([ADR 0024 §10](ADR/0024-entitlements-and-test-billing.md)). Bu, mesaj
formatının sürümü değildir; sunucu eski uygulamayı `426 UPGRADE_REQUIRED` ile güncellemeye yönlendirir.
İmzanın kapsamında değildir: seviyesini yanlış söyleyen uygulama yalnızca kendini bozar.

## 12. Hesap yardımcıları (Faz 2)

Mesaj formatının parçası değildir; aynı kütüphaneler ve etiket kuralıyla `packages/crypto/src/auth.ts`
ve `at-rest.ts`'te tanımlıdır. Kararlar: [ADR 0005](ADR/0005-auth-and-devices.md).

| Etiket                   | Kullanım                                                  |
| ------------------------ | --------------------------------------------------------- |
| `bargu/v1/req-sig`       | Cihaz imzalı API isteği                                   |
| `bargu/v1/otp`           | Giriş kodunun türetilmesi                                 |
| `bargu/v1/web-code`      | Hesap web sayfası kodunun türetilmesi                     |
| `bargu/v1/web-unlock`    | Hesap sayfası "tarayıcıyı tanıt" bağlantısının sırrı      |
| `bargu/v1/cosmetic-pass` | Sunucunun süs geçiş belgesi imzası (ADR 0025)             |
| `bargu/v1/server-notice` | Sunucu haberinin imzası, ayrı anahtarla (ADR 0016 Ek, §9) |
| `bargu/v1/email`         | E-posta adresinin anahtarlı özeti                         |
| `bargu/v1/token`         | Refresh token özeti                                       |
| `bargu/v1/at-rest`       | Sunucuda saklanan hassas verinin şifrelenmesi             |
| `bargu/v1/pseudonym`     | Hız sınırı anahtarları için anahtarlı takma ad            |

**İstek imzası** (başlıklar `x-bargu-sig`, `x-bargu-ts`, `x-bargu-nonce`):

```
m = len(method)(1) ‖ method(ASCII) ‖ len(path)(2, BE) ‖ path+query(UTF-8, ≤2048)
    ‖ ts(8, BE, ms) ‖ nonce(16) ‖ deviceId(16) ‖ SHA-256(gövde)
sig = Ed25519.sign(device.identity, "bargu/v1/req-sig\0" ‖ m)
```

Sunucu: saat farkı ≤ 60 sn, her `(cihaz, nonce)` bir kez (Redis, 130 sn), imza cihazın kayıtlı kimlik
anahtarıyla. Girişte henüz kayıtlı anahtar yoktur: istek, gönderilen anahtar paketindeki kimlik
anahtarıyla imzalanır (anahtara sahip olma kanıtı).

**Giriş kodu**: `kod = (ilk 48 bit HMAC-SHA256(OTP_KEY, "bargu/v1/otp\0" ‖ challengeId(16))) mod 10⁴`,
4 haneye sıfırla doldurulur (ADR 0012; önce 8 haneydi). Kod veya özeti hiçbir yerde saklanmaz. Meydan okuma, kodu isteyen cihazın
kimlik anahtarına bağlıdır; yalnızca o anahtarla imzalı giriş kodu kullanabilir.

**Hesap sayfası kodu** (ADR 0021): aynı biçim, kendi etiketiyle ve 8 hane:
`kod = (ilk 48 bit HMAC-SHA256(OTP_KEY, "bargu/v1/web-code\0" ‖ challengeId(16))) mod 10⁸`.
Biri ötekinin yerine geçmez. Meydan okuma, sayfanın ürettiği rastgele değerin (binding) SHA-256
özetine bağlıdır.

**"Tarayıcıyı tanıt" bağlantısı** (ADR 0021, dilim 6b): `sır = base64url(HMAC-SHA256(OTP_KEY,
"bargu/v1/web-unlock\0" ‖ unlockId(16)))`, 43 karakter. Sunucu sırrı saklamaz; yalnızca kimliği tutar.

**Takma ad** (ör. hız sınırı anahtarındaki istemci ağı): ilk 16 baytı hex olarak
`HMAC-SHA256(EMAIL_LOOKUP_KEY, "bargu/v1/pseudonym\0" ‖ amaç\0 ‖ değer)`.

**E-posta özeti**: `HMAC-SHA256(EMAIL_LOOKUP_KEY, "bargu/v1/email\0" ‖ UTF-8(normalize(adres)))`;
normalize = boşluk kırp, Unicode NFC, küçük harf.

**Refresh token**: `rt1.<userId>.<tokenId>.<base64url(32 rastgele bayt)>`; saklanan değer
`SHA-256("bargu/v1/token\0" ‖ token)`.

**Sunucuda saklanan veri** (ör. kuyruktaki e-posta adresi): `0x01 ‖ nonce(24) ‖
XChaCha20-Poly1305(JOB_PAYLOAD_KEY, nonce, aad = "bargu/v1/at-rest\0" ‖ amaç\0, veri)`, base64url.

**Platform doğrulaması**: App Attest ve Play Integrity, `SHA-256(meydan okuma(32) ‖ kimlik
anahtarı(32))` değerini onaylar; onay bu cihaz anahtarına bağlıdır.
