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

Zod ayrık birleşimi (`kind`), bilinmeyen alan reddedilir ([`packages/schemas`](../packages/schemas)):

| `kind`        | Alanlar                                           |
| ------------- | ------------------------------------------------- |
| `loc`         | `lat, lng, acc, spd?, hdg?, bat (0–100), chg, ts` |
| `bump`        | `ts`                                              |
| `place_enter` | `placeId, ts`                                     |
| `place_exit`  | `placeId, ts`                                     |
| `share_stop`  | `ts`                                              |
| `status`      | `emoji? (≤16), text? (≤80), expiresAt, ts`        |

## 7. Hassasiyet (şifrelemeden önce, gönderende)

| Seviye  | Hücre  | Etki                                                                      |
| ------- | ------ | ------------------------------------------------------------------------- |
| Tam     | —      | Değişmez                                                                  |
| Mahalle | ~1 km  | Hücre merkezine çekilir; `spd`/`hdg` atılır; `acc` hücre yarıçapının katı |
| Şehir   | ~10 km | Aynısı, 10 km hücre                                                       |

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

## 9. Bildirim (sealed box)

Alıcı cihaz başına, gönderen bilgisi içermeyen kutu:

```
shared = X25519(ephSecret, recipient.dhPub)
key, nonce = HKDF(shared, salt = ephPub ‖ recipient.dhPub, "bargu/v1/push\0", ∅)
box = 0x01 ‖ ephPub(32) ‖ ChaCha20-Poly1305(key, nonce, aad = 0x01 ‖ ephPub, pt = pad(içerik))
```

Base64url olarak gönderilir. iOS'ta bildirim eklentisi yalnızca CryptoKit ile açar; Android'de
data-only FCM ile headless JS açar. Kutu içeriği gizler; **özgünlük**, içine konan imzalı mesaj
zarfından gelir.

## 10. Değişmezler (testlerle korunur)

- Herhangi bir bitin değiştirilmesi reddedilir (property testi, 300 rastgele deneme).
- Tekrar, pencere dışı `seq` ve epoch tabanının altı reddedilir; doğrulanamayan mesaj pencereyi
  ilerletmez; iki çemberdeki aynı gönderici birbirini etkilemez; eski konum `STALE` olur.
- Her içerik türünün en büyük hâli dahil tüm zarfların `ct` boyutu aynıdır (528 bayt).
- Yanlış epoch / çember / gönderen anahtarı reddedilir; çıkarılan üye yeni epoch'u çözemez.
- Kötü niyetli ama geçerli anahtarlı gönderici (bozuk dolgu, geçersiz UTF-8/JSON/şema) reddedilir.
- RFC 7748, 8032, 8439 ve 5869 test vektörleri; `packages/crypto` %100 satır/dal/fonksiyon kapsamı.
- TypeScript çıktısı Swift/CryptoKit ile açılır (macOS CI). Swift tarafı da bilinmeyen alanı, yanlış
  boyutlu `ct`'yi ve kanonik olmayan UUID'yi reddeder. CryptoKit küçük mertebeli kimlik anahtarlarını
  kendisi reddetmez: eklenti yalnızca uygulamanın TypeScript ile doğrulayıp sakladığı anahtarları kullanır.

## 11. Sürümleme

Her başlık `0x01` ile başlar ve JSON'da `v: 1` taşır. Uyumsuz değişiklik yeni sürüm + yeni etiketler
(`bargu/v2/…`) + yeni fixture dosyası demektir. Sabitler ve etiketler değişirse fixture testi kırılır;
bu bilinçli bir kapıdır.
