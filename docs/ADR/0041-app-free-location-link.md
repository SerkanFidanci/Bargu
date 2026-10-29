# 0041. Uygulamasız şifreli konum linki

- Durum: Kabul edildi (PM, 2026-10-30), PM şartlarıyla; önerildi (kodlama oturumu, 2026-10-30)
- Tarih: 2026-10-30
- İlgili: BARGU_PLAN Faz 9C paket E (Ö9), [sektör analizi](../arastirma/sektor-analizi-2026-10-29.md),
  [ADR 0034](0034-domain-and-closed-test-server.md) (bargu.app), [ADR 0009](0009-circles-keys-and-events.md)
  Ek 2 (anahtarı parçada tutan davet bağlantısı), [ADR 0028](0028-location-accuracy-and-glide.md)
  (canlı mod), [ADR 0036](0036-battery-background-location.md) (sıklık), [ADR 0021](0021-safety-features.md)
  (Seni görenler, tümünü durdur), [ADR 0023](0023-age-15-plus.md) (15–17)

## Bağlam

Life360 ve Google'da, uygulaması olmayan birine süreli bir konum linki gönderilebiliyor. Örnek:
taksiye binen kişi linki annesine atar, annenin Bargu'su yoktur. Bu artık beklenen bir özellik.
Bargu'nun farkı: sunucu linkin gösterdiği konumu göremez.

Yol: konum telefonda, linkin kendi anahtarıyla şifrelenir. Anahtar linkin `#` kısmında durur; bu
kısım tarayıcıdan sunucuya hiç gitmez. Sayfa şifreyi tarayıcıda çözer.

## Karar

### 1. Link

- Biçim: `https://bargu.app/l#<kimlik>.<anahtar>`.
  - `kimlik`: 16 rastgele bayt (UUIDv7 değil; zaman söylemesin), base64url.
  - `anahtar`: 32 rastgele bayt, işletim sisteminin CSPRNG'sinden, base64url.
- Kimlik de anahtar da `#` kısmında: istek yalnız `/l` olur. Sunucu, nginx, paylaşımlı sunucunun
  kayıtları ve mesajlaşma uygulamalarının önizleme sunucuları anahtarı da kimliği de görmez (davet
  bağlantısıyla aynı yol, ADR 0009 Ek 2).
- **Sayfa anahtarı okuyunca adresten siler:** `history.replaceState(null, '', '/l')`. Anahtar ve
  kimlik yalnız bellekte kalır; çerez, `localStorage` ya da `sessionStorage` yok. Sayfa yenilenirse
  anahtar gider ve sayfa "Linki yeniden aç" der (link mesajda duruyor).

### 2. Şifreleme

- Yeni primitive yok. `packages/crypto`'daki var olan XChaCha20-Poly1305 (`sealAtRest`'in kullandığı
  `xaeadSeal`) ve dolgu (`pad`) ile yeni, küçük bir sarmalayıcı: `sealLinkLocation` /
  `openLinkLocation`.
  - Ek veri (AAD): `"bargu/v1/link" ‖ kimlik`. Bir linkin kutusu başka linkte açılmaz.
  - Dolgu: konum zarflarıyla aynı 512 bayt; boy bir şey söylemez.
- İçi (şifreli, `packages/schemas`'ta katı şema): `name` (kişinin görünen adı), `emoji`, `lat`, `lng`,
  `acc`, `bat`, `ts`, `until` (linkin bitişi).
- Sunucu anahtarı bilmediği için kutu uyduramaz ve değiştiremez. Eski bir kutuyu yeniden
  gösterebilir; sayfa gördüğü en yeni `ts`'ten eskisini kabul etmez ve her zaman tazeliği yazar
  ("2 dk önce").

### 3. Süre, iptal, silme

- Süreler: **1 saat, 4 saat, 8 saat ya da gün sonu** (telefonun yerel saatiyle 23:59; sunucuya
  mutlak saat gider).
- **Tek dokunuşla iptal:** "Linki durdur". Ayrıca "Seni görenler" ekranındaki "Tümünü durdur" (ADR 0021) açık linkleri de durdurur.
- Süre dolunca ya da iptal edilince sunucu şifreli metni ve satırı **hemen kalıcı olarak** siler.
  Süre için pg-boss işi `link.expire`, `startAfter = expiresAt`, yükü yalnız linkin kimliği.
- Açık sayfalara canlı olay `link.ended` gider; sayfa haritayı ve anahtarı bellekten temizler ve
  "Bu link bitti" der. Sayfa ayrıca şifreli `until`'e kendisi de bakar.
- Hesap silinince **ve çıkış yapılınca** açık linkler silinir (PM şartı).

### 4. Konumun gitmesi

- Link açıkken telefon, konum servisinin bugünkü sıklığıyla (ADR 0036; uygulama kapalıyken dakikada
  en çok bir) kutuyu yeniler: sunucuda link başına **tek kutu** durur, yenisi eskisinin yerine geçer.
- **Biri bakınca canlı:** sayfa açıkken sunucu telefona, var olan `watch` haberiyle (ADR 0028) "link
  izleniyor" der; telefon canlı moda geçer. ADR 0028'in sınırları aynen geçerli (saatte en çok 15
  dakika, düşük pilde ve pil tasarrufunda yok).
- **Hayalet:** Dondur ya da Gizle açıkken linke yeni konum gitmez; sayfa "Ali konumunu şu an
  paylaşmıyor" der (son kutu silinir). (PM sorusu 1.)
- **Hassasiyet:** kişi linki kurarken seçer: tam (varsayılan) ya da yaklaşık. Yaklaşık seçilirse
  `applyPrecision` uygulanır.
- Link, çemberlerden bağımsızdır: çember paylaşım ayarları linki değiştirmez.

### 5. Etkinlik çemberinde

Link **etkinlik çemberinin ekranından da** kurulabilir (PM kararı): örneğin organizatör, Bargu'su
olmayan birine "biz buradayız" linki atar. Link yine **yalnız kuranın kendi konumunu** gösterir;
çemberdeki başkalarını göstermez. Etkinlik ekranından kurulan link en geç etkinlik bitince biter.
(PM sorusu 2: bu yorum doğru mu?)

### 6. Web sayfası

- `bargu.app/l`'de açılır; bu yüzden kod alan adını bekler (`INVITE_HOST`, ADR 0034). Alan adı
  alınana kadar staging'in kendi adıyla denenir.
- Küçük, kendi derlediğimiz bir sayfa: `packages/crypto` (noble) ve `packages/schemas`; harita
  **bizim haritamız** (MapLibre GL JS, karo ve yazı tipleri `api.bargu.app/map`'ten; stilde başka adres
  olmadığı uygulamadaki testle aynı şekilde denetlenir).
- **Üçüncü taraf betik, yazı tipi, analitik ve izleyici yok.** Bütün dosyalar kendi sunucumuzdan ve
  kendi derlememizden, karma adlı.
- Başlıklar:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'
blob: data: https://api.bargu.app; connect-src https://api.bargu.app wss://api.bargu.app;
worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  - `Referrer-Policy: no-referrer`;
  - `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`;
  - `Permissions-Policy: geolocation=(), camera=(), microphone=()` (sayfa bakanın konumunu sormaz);
  - `X-Robots-Tag: noindex`; HTML için `Cache-Control: no-store`.
- Sayfa canlı güncellemeyi WebSocket'ten alır (`link.loc`, `link.ended`); yoklama (polling) yok.
- Ekran: harita ve pin, "Ali'nin konumu · 2 dk önce · 17:30'a kadar", pil. Altında "Bargu'yu indir"
  (izleme parametresi olmayan düz mağaza bağlantısı).

### 7. Sunucu

Tablo: `app.location_links(id, owner_id, expires_at, created_at, updated_at, opened_count,
last_opened_at, box)`. RLS: yalnız sahibi yazar; okuma yalnız kimlikle, aşağıdaki açık uçtan.

| Uç nokta                | Kim    | Ne yapar                                                                                       |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `POST /v1/links`        | Sahip  | `{ id, expiresAt, box }`; süre seçeneklerinden biri; 15–17 reddedilir; aynı anda en çok 3 link |
| `PUT /v1/links/:id`     | Sahip  | Kutuyu yeniler; dakikada en çok 2 (canlıda saniyede 1)                                         |
| `DELETE /v1/links/:id`  | Sahip  | İptal; hemen kalıcı silme; açık sayfalara `link.ended`                                         |
| `GET /v1/links`         | Sahip  | Kendi açık linkleri: bitiş, kaç kez ve en son ne zaman açıldı                                  |
| `GET /v1/links/:id/box` | Herkes | Kutuyu verir ve açılma sayacını artırır; yoksa ya da bittiyse her durumda aynı 404             |
| `WS /v1/links/:id`      | Herkes | `link.loc`, `link.ended`                                                                       |

- Sahibin uçları zod doğrulamalı, cihaz imzalı, yetki kontrollü ve "başka kullanıcı erişemez" testli
  (başkasının linkini yenileyemez, silemez, listeleyemez).
- Açık uçlar kimlikten başka bir şey almaz; geçersiz, bitmiş ve hiç olmamış kimlik aynı cevabı ve
  aynı süreyi alır.
- **IP adresi yalnız hız sınırı için** kısa süre tutulur: Redis'te anahtarlı takma ad (`pseudonym`),
  10 dakika ömürlü sayaç. Log'lanmaz; nginx erişim kaydı bu yolda kapalı.
- Kurana açılma bilgisi gösterilir: "Link 3 kez açıldı · son 17:05". Kimin açtığı bilinmez.

### 8. Uyarı ekranı

Link kurulurken, paylaşmadan önce:

- "**Linki kime iletirsen o da konumunu görür.** Linki alan herkes, süre bitene ya da sen
  durdurana kadar görür."
- "Linki paylaştığın uygulama (WhatsApp gibi) linkin tamamını görür."
- Seçili süre ve hassasiyet.

Link açıkken Android'in kalıcı bildiriminde yazar: "Konum linkin açık · 17:30'a kadar". "Seni
görenler" ekranı açık linkleri, bitişlerini ve açılma sayılarını listeler.

### 9. 15–17

- 15–17 yaştakiler **link oluşturamaz** (PM kararı). Sunucu da reddeder.
- Düğme genç için soluk ve nedenini söyler: "Konum linki 18 yaşından büyükler içindir." Bu metni
  yalnız gencin kendisi görür; kimseye yaş bilgisi gitmez.
- Link açan kişinin yaşı bilinmez ve sorulmaz (hesabı yok).

## Tehditler

| Tehdit                                            | Ne olur                                  | Önlem                                                                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link ele geçer ya da iletilir                     | Alan herkes görür                        | Kısa süreler, tek dokunuşla iptal, açılma sayısı kurana gösterilir, kurulurken uyarı                                                                                                                                                |
| Sunucu eski kutuyu gösterir ya da hiç güncellemez | Bakan eski konumu görür                  | Sayfa tazeliği yazar; daha eski `ts`'i kabul etmez                                                                                                                                                                                  |
| Sunucu kendi betiğini sayfaya koyar               | Anahtar okunabilir                       | **Kabul edilen risk:** sayfayı sunan sunucuya güvenmek web'in doğası. Azaltma: sayfa küçük, betik yalnız kendi derlememiz, uygulama içi görünüm bu riski taşımaz (PM şartı: depo açık değil, SRI da kendi sunucumuza karşı korumaz) |
| Karo istekleri                                    | Haritanın baktığı bölge sunucumuza gider | Uygulamadaki ile aynı: karolar kendi sunucumuzda, istekler log'lanmaz (THREAT_MODEL "Harita" satırı)                                                                                                                                |
| Zorlama (biri kişiye link kurdurur)               | Zorlayan konumu görür                    | Kalıcı bildirim; "Seni görenler"de liste; "Tümünü durdur"                                                                                                                                                                           |
| Kimlik tahmini                                    | —                                        | 128 bit rastgele kimlik; anahtar olmadan kutu işe yaramaz; IP başına hız sınırı                                                                                                                                                     |
| Tarayıcı geçmişi                                  | Linkin tamamı geçmişe yazılabilir        | `replaceState` adresten siler; ilk açılışta geçmişe yazılmış olabilir, link zaten süreli                                                                                                                                            |

## Sonuçlar

**Sunucunun gördükleri:** linkin var olduğu, sahibi, ne zaman biteceği, ne zaman ve kaç kez açıldığı,
kutunun ne zaman yenilendiği (hareket ediyor mu, sıradan konumdaki gibi), kutu boyu (sabit). IP
yalnız hız sınırı için kısa süre, log'lanmadan. Konum, ad ve anahtar gitmez.

**Belgeler (PM kararı):** THREAT_MODEL ve N2'yi kodlama oturumu, **kodla aynı commit'te** günceller
(N2 testi THREAT_MODEL'i okur). Gizlilik politikası ve Play belgelerini PM, paketin APK'sı çıkmadan
önce günceller. Değişecek satırlar:

- THREAT_MODEL, "Saldırganlar ve önlemler": yeni satır "Konum linkinin ele geçmesi ya da kötüye
  kullanılması"; "Kontrolcü partner" satırına: açık linkler "Seni görenler"de ve "Tümünü durdur"la
  biter.
- THREAT_MODEL, "Kabul edilen sızıntılar": yeni satır **"Konum linkleri"**: yukarıdaki liste; ayrıca
  "Sayfayı sunan sunucuya güven" kabul edilen risk olarak.
- N2 "Sunucu ne biliyor?" ekranı: yeni satır (eşleme testi THREAT_MODEL'i okur).
- Gizlilik politikası: yeni bölüm "Konum linki": linki açan kişinin verisi (yalnız IP, hız sınırı
  için, log'lanmadan), saklama (bitince ya da iptalde hemen), 15–17 oluşturamaz.
- Play veri güvenliği formu: konum yine uçtan uca şifreli; "üçüncü taraflarla paylaşım" yok (link
  kullanıcının kendi paylaşımı). PM kontrol eder.

**Testler (kod aşamasında):**

- `packages/crypto`: kutu yalnız kendi kimliğiyle açılır; bozuk kutu reddedilir; dolgu sabit.
- Sayfa: anahtar okununca adres `/l` olur; anahtar depolamaya yazılmaz; eski `ts` reddedilir; CSP ve
  başlıklar (yanıt testi); stilde başka adres yok.
- API: zod, yetki, "başka kullanıcı erişemez"; 15–17 reddedilir; 3 link sınırı; iptal ve süre kalıcı
  siler; açık uç her geçersiz durumda aynı cevabı verir; IP log'lanmaz.

**Riskler:** alan adı alınmadan canlıya çıkamaz. İlk yayından önce **test oturumu** sayfaya ayrı bir
güvenlik incelemesi yapar (CSP, başlıklar, betik). Bağımsız denetim N5'te, sahibin kararı (PM şartı).

## PM soruları (karara bağlandı, PM 2026-10-30: hepsinde öneri geçerli; etkinlik yorumu doğru)

1. Hayalet modda link de dursun mu (öneri: evet; "şu an paylaşmıyor" yazar)?
2. "Link etkinlik çemberinde de olur" kararını, "etkinlik ekranından kurulabilir ve yalnız kuranın
   konumunu gösterir, etkinlik bitince biter" diye yorumladım. Doğru mu?
3. Kişi başına aynı anda en çok 3 link (öneri) uygun mu?
4. Linki açma sayısını kurana göstermek (öneri: evet) uygun mu?
