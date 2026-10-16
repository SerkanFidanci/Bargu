# 0024. Para modeli: hesap bazlı hak, çemberin ödeyeni, deneme, duraklama, sahte ödeme

- Durum: Kabul edildi
- Tarih: 2026-10-16

## Bağlam

- **"Kuran öder" (proje sahibi, 2026-10-15):** Bir çember (1:1 arkadaşlık dahil), üyelerinden en az
  biri Bargu+ abonesi ya da denemedeyse çalışır. Davetle katılmak hep bedava. Ödeyen kalmazsa çember
  silinmez, duraklar.
- **Paketler (PM, 2026-10-16):** BARGU_PLAN Faz 9B'deki tablo. Bedava davetli üye, 21 günlük deneme
  (kart istenmez, kendiliğinden ücretliye geçmez), Bargu+ ₺99,99/ay ya da ₺799,99/yıl. Tek seferlik
  süs paketleri ₺29,99 ve ₺49,99. Güvenlik ve gizlilik özellikleri hep bedava. 15–17 yaşta satın
  alma ebeveyn onayıyla.
- **Sahte ödeme (proje sahibi, 2026-10-16):** "launchu ertele paymenide daha paketlerimiz yok
  şimdlik fake payment yapabilirsin." Play geliştirici hesabı henüz yok. Ödeme akışı test satın
  almayla kurulur; gerçek mağaza sonra aynı arayüzün arkasına eklenir.
- Polling yasak (CLAUDE.md): hak ve duraklama değişiklikleri telefonlara WS olayıyla gider.

## Karar

### 1. Hak (entitlement) modeli

Hak hesaba bağlıdır, mağazaya değil. Böylece iOS gelince aynı hak orada da geçerli olur. Sunucuda
yeni tablo `app.entitlements`:

| Alan          | Anlamı                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `user_id`     | Hakkın sahibi                                                                                    |
| `product`     | `trial`, `plus_month`, `plus_year` ya da `cosmetic:<paket>`                                      |
| `source`      | `bargu` (denemeyi Bargu verir), `test`, `play`, `appstore`                                       |
| `state`       | `active`, `grace` (ödeme alınamadı, ek süre), `canceled` (yenilenmeyecek), `expired`, `refunded` |
| `starts_at`   | Başlangıç                                                                                        |
| `expires_at`  | Bitiş; süsler için boş (kalıcı)                                                                  |
| `grace_until` | Ek sürenin sonu                                                                                  |
| `auto_renew`  | Yenilenecek mi                                                                                   |
| `store_ref`   | Mağaza işlem kimliğinin anahtarlı özeti; test ve denemede boş                                    |

- **Bargu+ etkin sayılır:** ürün `trial`, `plus_month` ya da `plus_year`; ve durum `active` ya da
  `canceled` iken `expires_at` henüz gelmemişse, ya da durum `grace` iken `grace_until` henüz
  gelmemişse. `canceled` yalnızca yenilenmeyeceğini söyler; süre bitene kadar hak sürer.
- Hakkı yalnızca sunucu yazar. Kaynakları: test satın alma ucu (şimdi), mağaza sunucu bildirimleri
  (sonra) ve süre dolunca çalışan işçi.
- Telefon yalnızca kendi hakkını görür (`GET /v1/me/plan`: plan, bitiş, deneme bitişi, ek süre,
  yenilenecek mi, kaynak). Başkalarının hakkı hiçbir cevapta yoktur; yalnızca çemberin açık olup
  olmadığı gider.
- Ödeme kayıtlarında kart bilgisi, konum, çember içeriği, e-posta ya da token yoktur; log'lar da
  bunları yazmaz (otomatik test).

### 2. Çemberin açıklığı

- Bir çember, en az bir **aktif** üyesinde Bargu+ etkinse açıktır. Veritabanı fonksiyonu
  `app.circle_is_open(circle)` hesaplar; üyelerin haklarını okur ama yalnızca evet/hayır döner.
- Çember cevabına `paused: boolean` eklenir. Kimin ödediği gönderilmez.
- **Değişiklik anında görünür:** Bir hesabın hakkı değişince (satın alma, yenileme, iptalin
  gerçekleşmesi, süre dolması, iade, ek sürenin bitmesi) o hesabın aktif olduğu her çemberin
  üyelerine `circle.changed` gider. Telefonlar çemberi yeniden alır ve `paused` değerini görür.
  Zamanla biten haklar için işçi dakikada bir bakar (süpürme kilidiyle, ADR 0017). Bitenleri bulur
  ve aynı olayı yayar. Üyelik değişince (ödeyen ayrılınca) zaten `circle.changed` gidiyor.

### 3. Duraklama

- Duraklamış çemberde **canlı konum ve konum geçmişi** durur:
  - Telefon duraklamış çembere konum ve geçmiş göndermez.
  - Değiştirilmiş bir uygulamaya karşı sunucu da reddeder (`CIRCLE_PAUSED`).
  - Çember duraklayınca sunucudaki son konumlar silinir; kimse donmuş bir nokta görmez.
- Hiçbir şey silinmez: üyeler, anahtarlar, yerler, buluşma ve oylama belgeleri, geçmiş parçaları
  durur. Biri abone olunca çember yenileme gerektirmeden açılır.
- **Yerlere varış ve ayrılış bildirimleri** de durur, çünkü canlı konuma bağlıdırlar: telefon
  duraklamış çemberin yerlerine varışı göndermez, sunucu da reddeder (PM kararı, 2026-10-16).
- Duraklamış çemberde de çalışanlar: dürt, durum, yerlerin kendisi (tanımlar), buluşma ve oylama;
  güvenlik özellikleri (Güvendeyim ve elle "eve vardım" mesajı, hayalet, tümünü durdur, kilit).
  Ücretin karşılığı çemberin asıl değeri olan canlı konumdur. Çemberin geri kalanı canlı kalır ki
  biri abone olsun (PM kararı, 2026-10-16).
- Çember ekranında ve haritada kart: "Bu çember duraklatıldı. Açık tutmak için birinizin Bargu+'ya
  geçmesi yeter." Yanında "Bargu+'ya bak" düğmesi.
- **Ek süre:** Ödeme alınamayınca hak `grace` olur ve 7 gün sürer; mağaza başka bir süre bildirirse
  o geçerlidir. Bu sürede çember açık kalır, ödeyene uygulama içinde "ödeme alınamadı" uyarısı çıkar.

### 4. Deneme

- Her yeni hesap açılışta 21 günlük deneme alır (`trial`, kaynak `bargu`). Bu ADR'nin migration'ı,
  var olan hesaplara da denemeyi o andan başlatır (staging hesapları).
- Bir hesaba bir deneme. Hesabını silip aynı e-postayla yeniden açan yeni deneme alır. Bu kabul
  edilen bir risktir: e-postayı silmeden sonra tutmak, "hesabın ve bütün verilerin silinir" sözüyle
  çelişirdi (ADR 0022).
- **Kabul edilen risk; Faz 10'da mağaza denemesine taşınır (QA 19 P5, PM kararı):** Kapalı testte
  gerçek ödeme yok, bu yüzden şimdilik kabul. Gerçek ödemeye geçince deneme mağazanın kendi ücretsiz
  deneme teklifine taşınır; Google Play denemeyi Google hesabı başına kendisi sınırlar. Silinen
  hesabın e-postası yine saklanmaz, silme sözü bozulmaz.
- Deneme kart istemez ve bitince kendiliğinden ücretliye geçmez.
- **Hatırlatma:** Bitime 3 gün kala telefon kendi yerel bildirimini kurar (`trialEndsAt`'ten);
  uygulamada da kart çıkar. Bitince "Deneme bitti" kartı. Sunucu bildirimi gerekmez.

### 5. Satın alma ve 15–17 yaş

- 15–17 yaşta satın alma ebeveyn onayıyla (ADR 0023). Çocuk "satın al"a basınca ebeveyne bir istek
  gider (`guardian_requests`, yeni tür `purchase`, ürünüyle). Ebeveyn ortak görünümde onaylar.
  Onaydan sonra satın alma yapılır: testte hak verilir, gerçek mağazada çocuğun telefonu mağaza
  akışını açar. Bağlı ebeveyn yoksa: "Satın almak için ebeveyninle bağlantı kur."
- Deneme 15–17 için de geçerlidir; ücretsizdir.
- **Uygulama (dilim 2c, migration 0031):**
  - Çocuğun "Ebeveynime sor" düğmesi satın alma ucunu çağırır. Sunucu isteği saklar, ebeveynlere
    bir kez haber verir (yeni bildirim türü `guardianPurchase`: "Çocuğun Bargu+ almak istiyor") ve
    diğer onay akışları gibi `403 GUARDIAN_APPROVAL` döner.
  - Bağlı ebeveyn yoksa istek saklanmaz, `403 GUARDIAN_LINK_REQUIRED` döner.
  - İstek her zaman sorulur; "yeni kişiler için onay" ayarı kişilerle ilgilidir, satın almayı
    kapatmaz.
  - Çocuk başına bekleyen tek satın alma vardır. Öbür planı istemek isteği değiştirir ve ebeveyne
    yeniden haber verir; aynısını istemek kimseye yeniden haber vermez. İstekler diğerleri gibi
    7 günde düşer.
  - Çocuğun plan cevabında `pendingPurchase` bekleyen planı söyler. Ekran onu `plan.changed`
    olayıyla günceller (yoklama yok).
  - Ebeveyn ortak görünümde planı ve fiyatı görür. Evet: hak çocuk adına verilir (testte kaynak
    `test`), çemberleri açılırsa haber alır. Hayır: istek düşer, çocuğun ekranı bunu duyar.
  - Çocuğun zaten mağazadan bir planı varsa sorulmaz (`409 ALREADY_SUBSCRIBED`).
  - Test satın alma kapalıysa (üretim) satın alma ucu da yoktur (404). Gerçek mağaza gelince
    onaydan sonra çocuğun telefonu mağaza akışını açar (Faz 10).
  - Süs paketleri 15–17 için dilim 3'e kadar `GUARDIAN_APPROVAL` ile reddedilir, istek açılmaz.
  - **Eski uygulamalarla uyum:** Bu sürümden önceki uygulamalar ebeveyn görünümündeki istek
    listesini katı okur; yeni `purchase` türü, 2b ya da daha eski bir uygulamadaki ebeveyn
    ekranını açılmaz yapar. Bu sürümden itibaren liste esnek okunur: tanınmayan türdeki istek
    atlanır, görünümün geri kalanı bozulmaz. Kapalı testte herkes güncelleyerek çözülür.

### 6. Sahte ödeme (test satın alma)

- Ortam bayrağı `BILLING_TEST` (`on` / `off`). **Kapalı varsayılan (fail-closed, PM kararı
  2026-10-16):** bayrak verilmezse ortam ne olursa olsun test uçları kapalıdır; yalnızca açıkça `on`
  yazılınca açılır. Gerekçe: bedava Bargu+ veren bir uç, eksik ya da yanlış bir üretim ayarıyla
  (`NODE_ENV`, `APP_ENV`) kendiliğinden açılmamalı. Üretim yapılandırması `on`'u ayrıca reddeder
  (env.ts üretim kontrolü). Kapalıyken test uçları **404** döner. Testler: bayrak yokken 404
  (entegrasyon), üretimde `on` reddedilir ve bayraksız ortam kapalıdır (birim).
- Staging'de bayrak açıkça açıktır: Bargu'nun sunucudaki ortam dosyasında `BILLING_TEST=on`;
  `infra/staging/compose.yml` onu API'ye ve işçiye geçirir, yoksa `off`.
- Uçlar (oturumlu ve cihaz imzalı; hesap başına sıkı hız sınırı):
  - `POST /v1/billing/test/purchase` `{ product }`: kaynağı `test` olan hak verir. `plus_month`
    30 gün, `plus_year` 365 gün sürer; süs kalıcıdır. 15–17 için yalnızca onaylanmış bir istekle.
  - `POST /v1/billing/test/simulate` `{ action }`: yalnızca çağıranın kendi `test` hakkına
    uygulanır, `play` ve `appstore` haklarına asla.
    - `renew`: mağaza gibi dönem sonunda yeniler; taklitte "şimdi" dönemin sonu sayılır, yeni
      dönem şimdiden başlar (bitiş en çok bir dönem ileride, hiçbir zaman iki dönem).
    - `cancel`: yenilemeyi kapatır, süre bitene kadar sürer.
    - `expire`: şimdi bitirir.
    - `fail`: ek süreye geçirir.
    - `recover`: ek süreden çıkarır.
    - `refund`: iade eder, hemen biter.
    - `endTrial`: çağıranın denemesini şimdi bitirir ("deneme bitti" durumu böyle denenir; yalnızca
      test bayrağı açıkken, ADR'nin geri kalanı gibi).
- **Veritabanı da bilir (QA 20 P1b, migration 0030):** API'nin bayrağı uçları kapatır, ama
  uygulama rolüyle SQL erişimi olan biri (SQL enjeksiyonu varsayımı) test işlevini doğrudan
  çağırıp kendine uzun bir Bargu+ yazabiliyordu.
  - Migration adımı her dağıtımda bayrağı `app.settings` tablosuna yazar: yalnızca `APP_ENV`
    üretim değilse ve `BILLING_TEST=on` ise `on`. Satır yoksa kapalı sayılır. Uygulama rolü bu
    tabloyu ne okuyabilir ne yazabilir; bayrağı yalnızca migration adımı (sahip rolü) değiştirir.
    Bu yüzden bayrak, uygulama rolünün açabileceği bir oturum ayarı (GUC) olarak tutulmadı.
  - Bayrak kapalıyken (üretim) `plus_active` ve onu kullanan çember açıklığı `test` kaynaklı
    satırı saymaz; test işlevleri hiçbir şey yazmaz ve değiştirmez. API'nin plan cevabı da aynı
    kurala uyar.
  - Bir test planının bitişi en çok "şimdi + 1 yıl + 1 gün"dür; süsün bitişi yoktur. Bir günlük
    pay, API ile veritabanının saatleri arasındaki küçük fark için. Bu pay olmadan tam 365 günlük
    gerçek bir yıllık plan saat farkı yüzünden reddedildi. Erken yenileme bu yüzden dönem sonuna
    taşındı (yukarıda `renew`) ve bitişi iki yıla itmez.
- **Uygulama:**
  - Ödeme ekranı gerçek akışla aynıdır.
  - Preview derlemesinde "Satın al" test ucunu çağırır; ekranda "TEST — gerçek ödeme yok" bandı
    vardır.
  - Üretim derlemesinde düğme mağazayı açar. Mağaza bağlanana kadar "yakında" der.
  - Geliştirici menüsündeki taklit düğmeleri (yenileme, iptal, süre dolması, ödeme hatası) yalnızca
    preview ve geliştirme derlemelerinde vardır.

### 7. Süs hakları

- Süs, kalıcı bir hak satırıdır (`cosmetic:<paket>`).
- Arkadaşın telefonu bir süsü göstermeden önce, satın alındığını sunucunun imzasından doğrular:
  - Sunucu, hesabın süslerini Ed25519 ile imzalı kısa bir belge olarak verir (kimin, hangi paketler,
    ne zaman). Yeni sunucu sırrı `ENTITLEMENT_SIGNING_KEY` ile imzalanır.
  - Sahibinin telefonu bu belgeyi şifreli profiline koyar (ADR 0014).
  - Gören telefon, uygulamada gömülü sunucu açık anahtarıyla doğrular.
  - Değiştirilmiş uygulama bedava süs gösteremez.
  - İmza ve doğrulama `packages/crypto`'da. Ayrıntılar süs diliminde bu ADR'ye eklenecek.
- Süs yalnızca görünüştür. Hiçbir işlev ya da güvenlik özelliği süsün arkasında değildir.
  Rastgele kutu yoktur.

### 8. Gerçek mağaza (sonra)

- Google Play Billing:
  - Telefon satın alma belirtecini sunucuya verir. Sunucu onu Google Play Developer API ile
    doğrular, onaylar ve hakkı yazar (kaynak `play`, `store_ref` belirtecin anahtarlı özeti).
  - Yenileme, iptal, iade ve ek süre gerçek zamanlı geliştirici bildirimleriyle gelir.
  - Ödeme kütüphanesinin seçimi o zaman bu ADR'ye ek olarak yazılır (gerekçe ve bakım durumu).
- App Store abonelikleri iOS yayınıyla gelir; aynı hak tablosu kullanılır.

### 9. Ödeme ekranı

- Türkçe, fiyatlar TL, yıllık plan öne çıkar.
- İptal tek dokunuştur: mağazanın abonelik sayfası açılır; testte `cancel` taklidi.
- Bedava ve ücretli sınırlar ekranda yazılıdır.
- Sonradan bedava bir özellik ücretliye taşınmaz.

### 10. En eski desteklenen uygulama (QA 19 P4)

- Uygulama her istekte kendi seviyesini `x-bargu-client` başlığında gönderir
  (`@bargu/schemas` `CLIENT_LEVEL`, bu sürümde 1). Canlı bağlantıda aynı değer bağlantının sorgu
  parametresindedir (`client`), çünkü eski sunucular kimlik nesnesindeki yeni alanı reddeder.
  Seviye göndermeyen uygulama 0 sayılır.
- Sunucunun ortam değeri `MIN_CLIENT_LEVEL` (varsayılan 0: herkese hizmet). Değer uygulamanın
  seviyesinden büyükse her `/v1` isteği ve canlı bağlantı `426 UPGRADE_REQUIRED` alır, istek başka
  hiçbir şeye bakılmadan durur. Hesap web sayfası (`/v1/web`, `/hesap`), sağlık uçları ve gizlilik
  sayfası etkilenmez (tarayıcı seviye göndermez).
- Seviye, eski uygulamaların sunucunun gönderdiğini yanlış okuyacağı bir değişiklikte artırılır.
  Örnek: 32b0f2d öncesi APK'lar duraklamış çemberi okuyamaz; denemeler bitmeden önce staging'de
  `MIN_CLIENT_LEVEL=1` yapılabilir.
- Uygulama 426 alınca bütün ekranın yerine "Yeni sürüm gerekiyor" ekranını gösterir: güncelleyene
  kadar konumun paylaşılmadığını ve yeni konumları göremeyeceğini söyler. Düğme yoktur (yenileme
  yasak); güncelleme indirme bağlantısından ya da mağazadan gelir.
- Bu kapıdan önceki APK'lar 426'yı tanımaz; yalnızca genel hata metnini gösterebilirler. Kapalı
  testte herkes güncelleyebilir; kapı bundan sonraki sürümler için kurulur.

## Sonuçlar

- **Sunucunun yeni öğrendikleri:** Kimde Bargu+ ya da deneme var, hangi süsler alınmış, hangi
  çember açık. Kart bilgisini mağaza tutar, Bargu hiç görmez.
- **Kabul edilen sızıntı (PM kararı, THREAT_MODEL'de):** Çember üyeleri, çember açıksa en az
  birinin ödediğini bilir. İki kişilik bir çemberde, ödemeyen kişi ödeyenin öteki olduğunu anlar.
- **Migration 0028 (dilim 1):**
  - `app.entitlements` ve sıralı türleri, satır güvenliği (yalnızca kendi satırları);
  - `app.plus_active`, `app.circle_is_open`; işçi için `app.plans_ended_between` ve
    `app.circles_openness_of` (yalnızca evet/hayır, kimin ödediği değil);
  - yeni hesaba açılışta, var olan hesaplara migration anında 21 günlük deneme (tetikleyici).
  - `guardian_requests` için `purchase` türü dilim 2c'de geldi (migration 0031, §5).
- **Eski uygulamalarla uyum (dilim 1):**
  - Telefon çember cevaplarını artık esnek okur; yeni bir alan atlanır, okuma bozulmaz.
  - Sunucu `paused` alanını yalnızca çember duraklamışken gönderir. Herkes migration anında
    deneme aldığı için, eski APK'lar en az 21 gün bu alanı hiç görmez.
  - Kendi planı için yeni olay `plan.changed`; eski uygulamalar tanımadıkları olayı atlar.
  - Hak kayıtları veri kopyası için ayrı uçtan gelir (`GET /v1/me/plan/records`), böylece var olan
    dışa aktarma cevabı değişmez.
  - Konum aktarımının ret nedenlerine `PAUSED` eklendi.
- **Duraklamanın yan etkisi:** Duraklama sunucuda da uygulandığı için eski uygulama sürümleri
  duraklamış çembere konum gönderemez; hata kodunu tanımayan eski sürüm yalnızca konumunu iletemez.
- **QA 19 düzeltmeleri (dilim 2):**
  - P1: Uygulama rolü hak tablosuna doğrudan yazamaz. Test satın alma ve denemenin bitişi yalnızca
    migration 0029'un işlevleriyle yazılır: kaynak `test`, yalnızca çağıranın kendi satırları; bir
    hesabın kendine bedava `play` planı yazması böylece kapanır.
  - P2: İşçinin işlevleri (`plans_ended_between`, `circles_openness_of`) bir oturum içinden
    çağrılınca hiçbir şey döndürmez.
  - P3: Plan değişikliği diğer üyelere yalnızca çemberin açıklığı gerçekten değiştiğinde söylenir.
    İptal ya da yenileme çemberi açık bırakıyorsa kimse bir şey duymaz; iki kişilik çemberde kimin
    ne yaptığı böylece sızmaz. Kişinin kendisi her değişiklikte `plan.changed` alır.
- **Fiyatlar:** Tahmindir, doğrulanmadı. Gerçek ödeme için Play geliştirici hesabı gerekir (proje
  sahibi).
