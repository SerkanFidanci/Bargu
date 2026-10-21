# 0029. Güvendeyim: tek dokunuşla "iyiyim", konum ve pil

- Durum: Kabul edildi (PM, 2026-10-21)
- Tarih: 2026-10-21
- İlgili: [ADR 0016](0016-sealed-push-notifications.md) (üyenin mühürlü, imzalı bildirimi),
  [ADR 0024](0024-entitlements-and-test-billing.md) (duraklamış çember, hep bedava),
  [ADR 0011](0011-location-engine-and-relay.md) (hassasiyet), [ADR 0023](0023-age-15-plus.md)
  (15–17), [PROTOCOL §6 ve §9](../PROTOCOL.md), BARGU_PLAN Faz 9B.

## Bağlam

Plan (Faz 9B): "tek dokunuşla seçilen çemberlere 'iyiyim' + konum + pil. Mevcut şifreli bildirim
yolundan gider; zayıf ağda kuyruğa alınır, bir kez gider." Hedef kullanım: eve ya da otele varınca,
gece yolda, deprem ya da kalabalıkta "ben iyiyim" demek; sevdiklerin bir şey sormadan bilsin.

Kurallar (plan, ADR 0021, ADR 0024): Güvendeyim duraklamış çemberde de çalışır, hep bedavadır, 15–17
yaşta da vardır. İçeriği Google ve Apple görmez (bildirimin kutusu mühürlü, metni alan telefon yazar).
Sunucu düz koordinat görmez, kimin neyi gönderdiğini saklamaz.

## Karar

### 1. Yeni şifreli mesaj türü `safe`

`{ kind: 'safe', id, lat, lng, acc, bat, ts }` (PROTOCOL §6). Her mesaj gibi 512 bayta dolgulanır,
gönderenin sender key'iyle şifrelenir ve cihaz kimliğiyle imzalanır. `id` 16 rastgele bayttır
(base64url, 22 karakter); mesajı adlandırır, gizli değildir. `ts` kullanıcının dokunduğu andır (mesaj
çevrimdışı bekledi ise gönderim anından eskidir; alıcı bunu gösterir).

Canlı konumdan (`loc`) farkı: **tek seferliktir**. Arkasından bir şey gelmez, sunucuda tutulmaz,
haritadaki canlı noktayı değiştirmez, hayalet modu açıksa kapatmaz.

### 2. Konum, çemberin kendi hassasiyetinde

Her seçilen çember için ayrı bir mesaj yapılır ve konum **o çemberin** hassasiyetiyle kısaltılır
(`applyPrecision`, ADR 0011): yaklaşık (mahalle ya da şehir) paylaşılan çember yalnızca hücre
merkezini ve ona uygun doğruluk yarıçapını alır. Neden: Güvendeyim, kullanıcının "bu çember beni şu
kadar kesin görsün" kararını delmemeli. Ailesine tam, iş arkadaşlarına şehir düzeyinde göstermek
isteyen biri tek dokunuşla ikisine birden haber verebilmeli, ince konum kaba çembere hiç gitmemeli.
İnce konum kaba bir çember için **diske de yazılmaz**: kuyruktaki iş (bkz. 6) hassasiyet uygulanmış hâliyle
saklanır.

Seçim ekranında kaba konum alacak çember "yaklaşık konum" diye işaretlidir; kullanıcı ne gideceğini
gönderirken bilir.

### 3. Gönderme akışı

- Haritada sol kenarda yuvarlak bir düğme (sağ kenar ADR 0026 §8'in "en çok 3 düğmesi"nde kalır) ve Ben
  sayfasında "Güvendeyim" satırı. İkisi de tek dokunuşla aynı sayfayı açar.
- Sayfa: çemberlerin listesi, her biri bir anahtar. **Son seçim telefonda hatırlanır** (şifreli kasa);
  sonradan gelen çember kullanıcı seçmedikçe işaretli gelmez. Hiç seçim yapılmamışsa konumunu zaten
  gören çemberler işaretlidir.
- Listeye giren çemberler: telefonun aktif üyesi olduğu, içinde başka aktif biri olan, süresi dolmamış
  olanlar. **Duraklamış çember de listededir.**
- "İyiyim, gönder": her seçilen çember için bir zarf ve her alıcı cihaz için ayrı mühürlenmiş, imzalı
  bir bildirim (aynen dürtme gibi, ADR 0016).

### 4. Hayalet modu ve kapalı paylaşım: bir kez onay

Hayalet modu açıksa, ya da seçilen bir çember konumu şu an almıyorsa (paylaşım kapalı, süresi bitmiş,
15–17'de yeni çember), gönderirken sorulur: "Konumun bu kez paylaşılacak" (hayalet modun ve paylaşım
ayarların olduğu gibi kalır). Konum yalnızca bu mesajda gider. Onay yoksa hiçbir şey gitmez ve
kuyruğa da girmez. Çember listesinde bu çemberlerin altında "konum şu an paylaşılmıyor" yazar.

### 5. Bildirim: mühürlü, imzalı, metni alan yazar

Çevrimdışı üyeye giden bildirimin gövdesi `{ kind: 'safe', circleId, id, bat, lat, lng, acc, ts }`
(PROTOCOL §9): **ad yok, metin yok**; konum (`lat`, `lng`, `acc`) var, çünkü uygulaması kapalı üye de
nerede olduğunu görsün ve sunucu şifreli zarfı saklamaz. Konum zarftakiyle aynı sayılardır: o çemberin
hassasiyetinde (yaklaşık çembere hücre merkezi, ince konum değil). Kutu alıcı cihazın anahtarına mühürlü
ve gönderenin cihazıyla imzalıdır; Google ve Apple yalnızca zamanı ve boyutu görür. Alıcı telefon
gönderenin adını kendi kişi listesinden yazar:
"Ayşe: İyiyim ✓ · %45"; mesaj geç kaldıysa saatiyle ("… · 14:05"). Yalnızca güvenilen cihazın imzası
kabul edilir. Sessize alma bunu **susturmaz** (kişinin dürtmelerini sessize almak onun "iyiyim"ini
kaçırmak demek olmamalı). Bildirim 24 saat geçerlidir (öbür bildirimlerin 1 saati değil): mesaj
göndericinin bağlantısını bekledi ise yine haberdir.

**Boyut.** En büyük gövde (en uzun sayılar, en büyük zaman) 219 bayt JSON; kutu 384 baytlık dolgu
sınıfına düşer (578 karakter; istekte kutu başına sınır 1100). Bu, PROTOCOL §9'daki 128 baytlık blokların
içinde kalır; yeni bir boy ya da protokol değişikliği değildir. Kısa adlı bir varış bildirimiyle aynı
sınıftır, 256'lık dürtmeden ayrılır. Sıradan konum (13–17 basamak) aynı sınıftadır: basamak sayısı bir şey
söylemez. Test: `packages/crypto/test/push.spec.ts`.

**Telefonda (24 saat).** Arka plan görevi bildirimi açıp imzayı doğruladıktan sonra yeri şifreli kasada
saklar (`safe:spots:v1`: `id`, çember, ad, konum, doğruluk, pil, zaman) ve **mesajın yapıldığı andan 24
saat** sonra siler. Silme her bildirimde, uygulama açılırken ve okunurken olur; yani süre dolunca kasada
kalmaz, yalnızca gösterilmemez. En çok 20 yer tutulur. Uygulama açıkken gelen canlı mesajın yeri de aynı
yolla saklanır; `id` ortak olduğu için biri ötekini tekrarlamaz. Sistemin bildirim deposuna yer değil,
yalnızca mesajın `id`'si yazılır (`data: { circleId, safe }`).

**Dokununca harita.** Bildirime (uygulama açıkken satıra) dokunmak yeri Bargu'nun kendi haritasında açar:
ince konum için bir **nokta**, yaklaşık konum (doğruluk 100 m'den büyük: mahalle ya da şehir hücresi, ya da
kaba bir ölçüm) için **doğruluk yarıçaplı bir daire** ve gönderenin adı; kamera daireyi bütün gösterir.
Haritaya dokunmak ya da bir gün geçmesi onu kaldırır. Yer bir günü geçip silinmişse bildirim her zamanki
gibi çemberi açar. Sessize alma kuralı değişmedi: Güvendeyim hiç susturulmaz. `id` her iki yolda
ortaktır: aynı mesaj hem zarftan hem bildirimden gelirse bir kez gösterilir.

### 6. Çevrimdışı ve uçak modu

Mesaj şifreli kasada bekler (`safe:out:{id}`): `id`, çember, **çemberin hassasiyetinde** konum,
doğruluk, pil, dokunma zamanı. Hazır zarf ya da bildirim saklanmaz; gönderirken yapılır, çünkü çemberin
epoch'u ve alıcı cihazlar o arada değişebilir, her denemede yeni sıra numarası alınır.

- Bağlantı gelince (canlı bağlantı kurulunca) bekleyenler eskiden yeniye, **bir kez** gider.
- Bir istek cevapsız kalırsa (çevrimdışı, sunucu hatası) kalanlar sırayla bekler.
- Başarılı cevap geldiği an kuyruktan silinir. Telefon cevaptan sonra silmeden kapanırsa aynı `id` ile
  tekrar sorar; sunucunun koruması (bkz. 7) "yapıldı" der, ikinci kez gitmez.
- Sunucu "çok sık" ya da "üye değil" derse düşer; "epoch eski" derse çember yenilenir, bir kez daha
  denenir, yine olmazsa bir sonraki bağlantıda yeniden denenir.
- 24 saati geçen mesaj gönderilmez (sunucu `id`'yi 24 saat sonra unutur).
- Sayfada "Bağlantı gelince gidecek mesaj: N" yazar.

### 7. Sunucu: `POST /v1/safe`

Dürtmenin aynası (`POST /v1/bumps`): zod doğrulama; imzalı istek; gönderen zarfı kendi cihazıyla
imzalamış ve çemberin aktif üyesi olmalı; güncel epoch; üye olmayana, yabancıya, başkasının cihazıyla
imzalanmışa `NOT_MEMBER` / `INVALID`. Gövde: `{ id, envelope, pushes? }`.

- **Duraklamış çemberde çalışır** (`circle_is_open` bakılmaz) ve **hak denetimi yoktur**: Bargu+'sız
  hesap, denemesi bitmiş hesap, 15–17 hep gönderebilir.
- **Hız sınırı:** gönderen ve çember başına saatte 6. Tekrar (aşağıda) sayılmaz.
- **Teslim:** çevrimiçi üyelere canlı `safe` olayı; çevrimdışı üyelerin yalnızca güncel cihazına, cihaz
  başına bir kez mühürlü bildirim (QA 21 B-2 kuralı, öbür üyelerin bildirimleriyle aynı yol).
- **24 saatlik tekrar koruması:** sunucunun saklayabildiği tek şey Redis'te `safe:{özet}` = `1`, 24 saat
  ömürlü. Özet, sunucunun anahtarlı takma adıdır (`pseudonym`, `EMAIL_LOOKUP_KEY`) ve
  `gönderen:çember:id` değerinden çıkar. İçerik, alıcı listesi, zaman, çember ya da kullanıcı kimliği
  yok; özetten bunlara geri gidilmez. Aynı `id` aynı gönderenden aynı çembere 24 saat içinde gelirse
  cevap `{ ok: true }` döner ve **hiçbir şey yeniden gönderilmez**. İki istek aynı anda gelirse
  `SET NX` ikisinden yalnızca birine izin verir. Teslim hata verirse özet silinir, tekrar sormak
  işe yarar. Reddedilen (hız sınırı, üye değil, eski epoch) mesaj hiçbir iz bırakmaz.

### 8. Eski uygulamalar: seviye değişmedi

Eski uygulama hem bilinmeyen mesaj türünü (`safe`) hem bilinmeyen bildirim gövdesini sessizce atar:
şema katıdır, alıcı `MALFORMED`'u yok sayar, arka plan görevi `openPush` hatasını yakalar, bildirim ve
satır yoktur, çökme yoktur (testler: `packages/crypto/test/legacy-app.spec.ts`, eski açma koduyla;
`background-push.test.ts`). Bu yüzden **`CLIENT_LEVEL` 4'te kalır** ve sunucu cihazların seviyesini
zaten tutmadığı için "yalnızca yeni seviyeye gönder" kapısı da gerekmez. Eski uygulamalı üye
Güvendeyim'i görmez; gönderen bunu bilmez (kabul edilen sınır, aşağıda).

### 9. iOS

iOS bildirim eklentisi (Swift) `safe` türünü bilmez; bilinmeyen tür "geçersiz" sayılır ve eklenti
içeriksiz yer tutucuyu bırakır. APNs Apple hesabı gelene kadar zaten kapalı; iOS yayınından önce
eklentiye tür ve ortak test vektörleri eklenir (PM'e raporda takip işi olarak yazıldı).

## Tehditler

| Tehdit                                                  | Önlem                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu konumu, adı ya da "iyiyim" metnini görür         | Zarf E2EE; bildirimde konum yok, ad ve metin telefonda yazılır; Redis'te yalnızca özet; entegrasyon testi Redis, veritabanı, kuyruk ve log'u tarar            |
| Sunucu "Ayşe iyiyim dedi" uydurur                       | Bildirim gönderen cihazın kimliğiyle imzalı, alıcıya bağlı; telefon yalnızca güvendiği cihazı kabul eder (ADR 0016)                                           |
| Sunucu ya da ağ aynı mesajı tekrar tekrar teslim eder   | Zarfta tekrar penceresi; mesajda `id` ve alıcıda "bir kez göster"; bildirim kutusu ve `id` ayrı ayrı                                                          |
| Kaba hassasiyetli çemberin ince konum alması            | Hassasiyet çember başına gönderende uygulanır; kuyrukta da ince konum yok; testle kanıtlı                                                                     |
| Hayalet modda yanlışlıkla konum gitmesi                 | Gönderirken açık onay; onay yoksa kuyruğa girmez; hayalet olduğu gibi kalır                                                                                   |
| Üyenin Güvendeyim ile sunucuyu ya da öbürlerini boğması | Gönderen ve çember başına saatte 6; yeni `id` ile de aşılamaz; bildirim cihaz başına bir; boyut sınırı                                                        |
| Üyenin `/v1/safe` ile başka türde mesaj yollaması       | Sunucu türü göremez (dürtmedeki gibi). Alıcı türü çözülen içerikten alır; duraklamış çemberde canlı konum alıcıda gösterilmez; sınır dürtmeden dar (saatte 6) |
| `id` tahmini ya da başkasının tekrar korumasını bozma   | Özet gönderen ve çemberi de kapsar; yabancı bir `id` başkasının mesajını engelleyemez                                                                         |

## Sonuçlar

- Sunucu şunu öğrenir: üye X, çember Y'ye, şu dakikada bir `safe` gönderdi (ve hangi cihazlara bildirim
  gittiği). Konumu, pili, metni, `id`'yi (özet dışında) saklamaz.
- Google ve Apple yalnızca bildirimin zamanını ve dolgulu boyutunu görür.
- **Kabul edilen sınırlar:**
  - Uygulaması kapalı üye metni ve yeri bildirimin kutusundan alır; sunucuda kopya yoktur. Bildirim
    FCM'in 1 saatlik ömründe teslim edilmezse (telefon kapalı) ikisi de gelmez ve açılınca uygulama
    içinden görünmez (dürtme gibi). Önceki sürümden bir telefonun bildirimi yer taşımaz: yalnızca metin
    gelir.
  - Eski uygulamalı üye hiçbir şey görmez; gönderen bilmez.
  - Sunucu `safe` uyduramaz ve bir üye başkası adına gönderemez: zarf ve bildirim gönderen cihazın
    kimliğiyle imzalıdır.
  - SMS yedeği bu ADR'de yok (BARGU_PLAN Bölüm 7, ayrı karar).
- iOS eklentisi için ayrı bir iş kalır (bkz. 9).
