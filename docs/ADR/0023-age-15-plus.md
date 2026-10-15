# 0023. Yaş sınırı 15+: beyan, e-Devlet yaş belirteci, 15–17 kuralları, ebeveyn araçları

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

Proje sahibinin kararı: Bargu 15 yaşından küçüklere kapalı; 15–17 yaş için ayrı kurallar uygulanır.

Hukuki dayanak 5651 sayılı Kanun ek md. 4/7 ve "Sosyal Ağ Sağlayıcı Tarafından Çocuklara Özgü
Ayrıştırılmış Hizmet Sunulmasına ve Yaş Doğrulamaya İlişkin Yönetmelik"tir (RG 10.10.2026, sayı
33396, yürürlük 1.11.2026). Ön araştırma `docs/arastirma/yas-siniri-ve-kvkk.md`'de. Varsayım
olarak Bargu kapsamdadır: tanımda "konum" geçiyor, kullanıcı sayısı eşiği yok.

Yönetmeliğin resmî metni taranmış PDF olduğu için okunamadı. Aşağıdaki madde numaraları, metni
aktaran hukuk yayınlarından alındı (avukat görüşü değildir):
[Mehmet Bedii Kaya](https://mbkaya.com/sosyal-medya-cocuk-yas-dogrulama-yonetmeligi-sgb/),
[Pekin & Pekin](https://pekin.com.tr/2026/10/13/sosyal-ag-saglayicilari-icin-yeni-duzenleme-cocuklara-ozgu-hizmet-ve-yas-dogrulama-yonetmeligi/),
[Euronews](https://tr.euronews.com/2026/10/10/sosyal-medyada-15-yas-siniri-duzenlemede-neler-var-yas-dogrulamasi-nasil-yapilacak),
[Küt Avukatlık](https://kultavukatlik.com.tr/sosyal-medya-15-yas-siniri-yas-dogrulama/).

Yönetmelikten çıkanlar:

- **Kapsam:** Türkiye'den erişilen yerli ya da yabancı her sosyal ağ sağlayıcı. Kullanıcı sayısı
  ya da ciro eşiği yok; küçük sağlayıcıya istisna yok.
- **Belirteç (md. 6, 7):**
  - Kullanıcı e-Devlet'te kimliğini doğrular; Siber Güvenlik Başkanlığı'nın hizmeti bir "yaş
    doğrulama belirteci" üretir.
  - Belirteçte yalnızca "15'i doldurdu mu, doldurduysa 18'i doldurdu mu" bilgisi vardır. Ad, TC
    kimlik no ya da kullanıcı adı yoktur.
  - Sağlayıcı belirtecin Başkanlıkça üretildiğini doğrular, yaş grubunu ondan öğrenir ve belirteci
    başka amaçla kullanamaz.
  - Hesap açılırken doğrulama zorunludur. Sonrasında sağlayıcı kendi yöntemleriyle izler; yaş
    şüphesinde hesap askıya alınır ve yeniden belirteç ister.
  - Geçici yabancı ziyaretçiler muaftır (pasaportla istisnai belirteç alabilirler).
- **Teknik kılavuz (md. 12):** Belirtecin yapısı, biçimi ve doğrulama süreci bir kılavuzla
  sağlayıcılara bildirilecek. 15 Ekim 2026 itibarıyla kılavuz yayımlanmamış. Yönetmelikte
  sağlayıcıların başvuracağı bir usul, sözleşme ya da şirket olma şartı geçmiyor. Bireysel
  geliştiricinin erişip erişemeyeceği belli değil **[doğrulanamadı]**.
- **15 yaş altı:** Hizmet verilmez, hesap isteği reddedilir.
- **Mevcut hesaplar (geçici md. 1):** 31.3.2027'ye kadar en az bir kez belirteçle doğrulanır. 15 altı
  çıkanın hesabı bildirimle kapanır; itiraz yoksa ya da itiraz bitince verisi silinir.
- **15–17 (md. 8/5):**
  - (a) bağımlılık yapan hizmet yok;
  - (b) hesap varsayılan gizli, herkese açık seçenek yok;
  - (c) takipçi ve takip listeleri başkalarına gizli;
  - (ç) yalnızca takip edilenden mesaj, okundu bilgisi yok;
  - (d) rehber eşleştirme yok;
  - (e) hesap önerisi yok;
  - (f) profil fotoğrafı ve görsellerin ekran görüntüsünü engelleyen önlem;
  - (g) canlı yayın yok;
  - (ğ) sonsuz akış yok;
  - (h) davranışa dayalı kişiselleştirme, profilleme ve kişiye özel reklam yok.
  - Ayrıca yüksek gizlilik varsayılanları ve en az veri (md. 8/2).
- **Ebeveyn araçları (md. 9):** hesap ve özellik ayarlarını yönetme, satın alma onayı ve harcama
  sınırı, kullanım süresi izleme ve sınırı, **konum paylaşımı denetimi**. Çocuğa açıldığı bildirilir;
  ebeveyn bilmeden kapatılamaz.
- **İtiraz (md. 10):** ücretsiz, Türkçe; otomatik değil, insan incelemesiyle. İtiraz sürerken veri
  silinmez. Yıllık istatistik Başkanlığa bildirilir ve sitede yayımlanır.
- **Yaptırım (md. 11):** önce bildirim ve düzeltme için makul süre. İyi niyetli uyum çabası dikkate
  alınır.

Proje sahibinin kararları (PM üzerinden, 2026-10-15):

1. 15–17 yaş ilk yayında açık. Ebeveyn araçları bu dilimde yapılır.
2. Belirteç entegrasyonu çalışana kadar herkese açık yayın yok; kapalı testte kalınır.
3. Yaş beyanı tek soru ve üç seçenek. Doğum tarihi sorulmaz; yalnızca yaş grubu tutulur.
4. Başkanlığa kılavuz için yazı: taslak `docs/yazismalar/0001-sgb-yas-dogrulama-kilavuzu.md`;
   proje sahibi kendi adına gönderir.
5. PM varsayılanı: 15–17 yaş etkinliğe yabancının QR'ıyla katılamaz, yalnızca arkadaş davetiyle.
6. Play hedef kitlesi 16–17 + 18+ (15 yaş uygulama içinde ele alınır).

## Karar

### 1. Yaş beyanı ve yaş grubu

- **Ne zaman:** Uygulamanın ilk açılışında, aydınlatma ekranından sonra ve e-posta adımından
  önce. Tek soru: "Kaç yaşındasın?"; seçenekler "18 veya üstü", "15–17", "15'ten küçük". Önceden
  seçili seçenek yoktur.
- **15'ten küçük:** Hesap açılmaz, sunucuya hiçbir şey gitmez. Ekranda "Bargu'yu 15 yaşından önce
  kullanamazsın" yazar. Yanlış seçen geri dönüp düzeltebilir; beyan kontrol edilemez. Geri dönüp
  başka bir cevap vermek ya da hesabı silip yeniden açmak beyanı atlatır; bu bilinen bir sınırdır
  ve belirteçle kapanır (bkz. 2).
- **Sunucuya giden:** Giriş kodu doğrulanırken yaş grubu (`15-17` ya da `18+`). Hesap yeni açılıyorsa
  yaş grubu zorunludur; yoksa `400 AGE_REQUIRED` döner. Bu cevap kod doğrulandıktan sonra verilir
  (kod harcanır); önce verilseydi adresin hesabı olup olmadığını belli ederdi. Hesap varsa giriş
  sırasında gönderilen değer yok sayılır.
- **Saklanan:** `users.age_band` (`15-17` / `18+`), `age_method` (`declared`, sonra `token`) ve
  `age_set_at`. Doğum tarihi ya da yaşın kendisi saklanmaz (KVKK md. 4 veri azaltma). Yaş grubu
  dışa aktarılan dosyaya girer ve hesapla silinir.
- **Mevcut hesaplar:** Yaş grubu olmayan hesapta uygulama girişten sonra, giriş öncesi verilen
  cevabı bir kez yazar (`PUT /v1/me/age`); cevap yoksa (uygulama güncellenmiş, giriş yapılmamış)
  aynı soruyu sorar. "15'ten küçük" seçen için hesap silme akışı (ADR 0022) açıklama ve son onayla
  çalışır. Cevapsız kapatılırsa bir sonraki açılışta yeniden sorulur.
- **Grup değişikliği:**
  - 18+ → 15–17: kişi kendisi değiştirebilir (daha korumalı).
  - 15–17 → 18+: belirteç gelene kadar uygulamadan yapılamaz. Destek e-postasıyla, insan
    incelemesiyle değişir. Belirteç gelince belirteçle değişir.
- **Başkasına görünmez:** Yaş grubu çember üyelerine, arkadaşlara ya da etkinliktekilere
  gösterilmez. Yalnızca kişinin kendisi ve bağlı ebeveyni görür. Bir etkinlikte kimin 15–17 olduğunu
  belli etmek çocuğu hedef yapar.
- **"Kullanıcı adımla bulunabilirim" (QA 5a Y2, PM kararı):** Kullanıcı adı müsaitlik kontrolü
  alınmış bir adı "alınmış" der. 15–17 kişi profil aramasında bulunmayınca "alınmış ama bulunamadı"
  sonucu kişinin 15–17 olduğunu ele veriyordu. Bu yüzden bulunabilirlik herkese açık bir gizlilik
  ayarıdır (`users.findable`, migration 0022): 18+ için varsayılan açık ve kapatılabilir; 15–17
  için her zaman kapalı ve açılamaz (veritabanı tetikleyicisi ve kısıtı korur). Profil kartı,
  arkadaş isteği ve gruba davet yalnızca bu ayara bakar. Böylece "alınmış ama bulunamadı" yalnızca
  "bu kişi bulunmak istemiyor" demektir. Ayar "Ben → Gizlilik ve hesap → Bulunabilirlik"tedir
  (`GET/PUT /v1/me/findable`).

### 2. Belirteç ve geçiş dönemi

- **Kılavuz başvurusu:** Proje sahibi Siber Güvenlik Başkanlığı'na yazıyla md. 12 kılavuzunu ister
  (taslak docs/yazismalar altında).
- **Tasarım:** Sunucuda tek bir doğrulama modülü olur ve kılavuzdaki biçime göre doldurulur.
  - Uygulama "Yaşını doğrula" der ve e-Devlet'teki hizmeti açar.
  - Kullanıcı belirteci Bargu'ya verir: kılavuzun yoluna göre geri dönüş bağlantısı, yapıştırma ya
    da QR.
  - Sunucu belirteci doğrular, yaş grubunu ve `age_method = token` değerini yazar. Belirtecin
    kendisi saklanmaz (md. 7 amaç sınırı).
- **Geçiş dönemi (1.11.2026'dan belirteç çalışana kadar):**
  - Play'de yalnızca kapalı test; testçiler kişisel olarak bilinen insanlar.
  - Yaş grubu beyanla alınır. Beyan, yönetmeliğin "belirteçle doğrulama" şartını karşılamaz;
    kapalı test bu yüzden.
- **Belirteç çalışınca:**
  - Yeni hesaplarda belirteç zorunlu olur.
  - Mevcut hesaplar 31.3.2027'ye kadar uygulamada uyarılır. O tarihte doğrulamamış hesap askıya
    alınır, doğrulayınca açılır.
  - 15 altı çıkan hesap bildirimle kapanır; itiraz süresi bitince hesap silme akışıyla silinir.

### 3. 15–17 yaş için kurallar

| Yönetmelik                        | Bargu'da bugün                                          | 15–17 için                                                                                                                         |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hesap gizli (b)                   | Herkese açık profil yok; kullanıcı adıyla bulunabiliyor | Kullanıcı adıyla bulunmaz (arkadaş isteği, gruba davet ve profil kartı "bulunamadı" der); yalnızca QR ya da davet linkiyle eklenir |
| Listeler gizli (c)                | Üyeleri yalnızca aynı çemberdekiler görür               | Değişiklik yok                                                                                                                     |
| Mesaj, okundu (ç)                 | Mesaj yok; dürtme yalnızca çember üyesinden             | Değişiklik yok                                                                                                                     |
| Rehber, öneri (d, e)              | Rehbere bakılmaz, öneri yok                             | Değişiklik yok                                                                                                                     |
| Ekran görüntüsü (f)               | QR ekranında engel var                                  | Değişiklik yok; harita ve kişi kartı serbest (aşağıda)                                                                             |
| Canlı yayın, sonsuz akış (g, ğ)   | Yok ("canlı mod" yayın değil, konum sıklığı)            | Değişiklik yok                                                                                                                     |
| Kişiselleştirme, reklam (h)       | Kimse için yok                                          | Değişiklik yok                                                                                                                     |
| Bağımlılık (a)                    | Seri, sıralama ya da ödül yok                           | Değişiklik yok; ebeveyn günlük süre sınırı koyabilir                                                                               |
| Yüksek gizlilik varsayılanı (8/2) | Katılınan çembere varsayılan olarak tam konum           | Yeni katıldığı çemberde paylaşım kapalı başlar, kişi kendisi açar                                                                  |
| Konum geçmişi                     | Açık rızayla                                            | 15–17 için açılamaz; sunucu rızayı da geçmiş parçasını da kabul etmez. Önceden açıksa kapanır ve silinir                           |
| Yabancılarla etkinlik             | QR ile 50 kişilik etkinlik                              | Etkinliğe yalnızca bir arkadaşının (karşılıklı arkadaşlık) QR'ı ya da linkiyle girer                                               |
| Ücretli işlemler (md. 9 b)        | Henüz yok                                               | Bargu+ ve süs paketleri geldiğinde her satın alma ebeveyn onayı ister; ebeveyn bağlı değilse satın alma kapalı                     |
| Çocuğa uygun metin (8/3)          | /gizlilik                                               | /gizlilik'e "15–17 yaş için kısaca" bölümü                                                                                         |

**Ekran görüntüsü (proje sahibinin kararı, 2026-10-15):** Harita, kişi kartı ve üye listelerinde
ekran görüntüsü serbest kalır; engel yalnızca bugünkü hassas ekranda, arkadaş ekleme QR'ında
sürer. Güvenlik numarası gizli değildir (karşılaştırılmak için vardır), engel gerekmez.

- **Gerekçe:** Haritanın paylaşılması büyümenin bir parçası.
- **Yalnızca 15–17 için engel neden yok:** Engeli yalnızca 15–17 kişi görünürken koymak,
  uygulamanın kimin 15–17 olduğunu her üyenin telefonuna söylemesini gerektirirdi. Bu, bir
  etkinlikte çocukları belli eder.
- **Hafifletenler:** 15–17 kişi yalnızca karşılıklı onayla eklenen kişilere görünür (kullanıcı
  adıyla bulunmaz, etkinliğe yalnızca arkadaş QR'ıyla girer). Herkese açık profil ya da gönderi
  yoktur.
- **Not:** Yönetmeliğin md. 8/5(f) bendi bir önlem istiyor. Teknik kılavuz ya da Başkanlık bunu
  harita gibi ekranlar için şart koşarsa bu karar yeniden ele alınır; avukata sorulacaklar
  listesindedir.

### 4. Ebeveyn bağlantısı

İlke: **gizli izleme yok.** Çocuk, ebeveyninin ne gördüğünü ve neyi yönettiğini her an aynı
ekranda görür. Ebeveyn bağlantısı konum vermez; ebeveyn çocuğun konumunu yalnızca çocuk onunla bir
çemberde paylaşıyorsa, herkes gibi görür.

- **Kimler:** Çocuk 15–17, ebeveyn 18+ ve kendi Bargu hesabı var. Bir çocuğun en çok 2 ebeveyni
  olur. Ebeveyn bağlantısı isteğe bağlıdır; yönetmelik araçların sunulmasını istiyor, bağlanmayı
  zorunlu tutmuyor.
- **Kurulum (karşılıklı onay):**
  1. Çocuk "Ben → Ebeveyn bağlantısı → Ebeveyn ekle"ye basar. 10 dakikalık, tek kullanımlık bir QR
     ve link (`bargu://g/<token>`) oluşur; ekran görüntüsü engellidir. Yeni kod eskisini geçersiz
     yapar.
  2. Ebeveyn QR'ı kendi Bargu'suyla tarar. "@çocuk seni ebeveyni olarak eklemek istiyor" ekranında
     neleri göreceği ve yönetebileceği yazar. "Ebeveyni olarak onayla"ya basar.
  3. Çocuğun telefonunda son onay çıkar: "@ebeveyn ebeveynin olacak; şunları görecek ve
     yönetebilecek". Çocuk onaylayınca bağlantı kurulur, ikisine de bildirim gider.

  Yüz yüze QR ve iki taraflı onay, bir yabancının kendini "ebeveyn" diye bağlamasını zorlaştırır.
  Gerçek ebeveynlik ilişkisi doğrulanamaz; bu bilinen bir sınırdır.

  Uygulama (5b, migration 0021):
  - Tablo `app.guardian_links`: çocuk, ebeveyn, durum (`open` kod bekliyor, `confirming` ebeveyn
    onayladı, `active`), kodun özeti ve süresi, tarihler, bitirme isteği. Her taraf yalnızca kendi
    bağlantılarını okur; her değişiklik veritabanı fonksiyonlarından geçer (yaş, en çok 2 ebeveyn,
    aynı ebeveynin ikinci kez bağlanamaması orada denetlenir).
  - Uçlar: `GET /v1/guardians`, `POST /v1/guardians/code` (çocuk), `POST
/v1/guardians/preview` ve `accept` (ebeveyn), `GET /v1/guardians/:id` (görünüm, iki taraf),
    `POST /v1/guardians/:id/confirm` (çocuk), `POST /v1/guardians/:id/end` (iki taraf).
  - Her değişiklikte iki tarafa `guardians.changed` olayı, karşı tarafa bildirim gider
    (`guardianRequest`, `guardianLinked`, `guardianEndRequested`, `guardianEnded`; bildirim
    ebeveyn ekranını açar). Kodu alınmayan ya da onaylanmayan bağlantı bir gün sonra, çocuğun
    bitirme isteği 7 gün sonra işçi tarafından kapatılır.
  - Yaş grubu değişince (çocuk 18+, ebeveyn 15–17) ya da hesap silinince bağlantı veritabanı
    tetikleyicisiyle hemen biter.

- **Ebeveynin gördüğü:**
  - çocuğun kullanıcı adı, adı, yaş grubu, bağlantı tarihi;
  - son 7 günün günlük kullanım süresi (dakika);
  - çocuğun çemberleri ve içindeki kişiler (ad ve kullanıcı adı), yani çocuğun konumunu
    görebilecek herkes;
  - bekleyen onay istekleri;
  - koyduğu ayarlar.
- **Ebeveynin görmediği:** konum, konum geçmişi, durum mesajı, yerler, etkinlik belgeleri. Bunlar
  uçtan uca şifreli ve ebeveyn bağlantısı anahtar vermez.
- **Çocuğun ekranı ("Ebeveynim"):** Ebeveynin gördüğünün aynısı, "Ebeveynin bunları görüyor"
  başlığıyla. Her ayar değişikliğinde çocuğa bildirim gider ve ekranda kimin ne zaman değiştirdiği
  yazar.
- **Bağlantının bitmesi:**
  - Ebeveyn bitirirse hemen biter, çocuğa bildirim gider.
  - Çocuk bitirmek isterse ebeveyne bildirim gider. Ebeveyn onaylarsa hemen, onaylamazsa 7 gün
    sonra biter (md. 9/4: ebeveyn bilmeden kapatılamaz). 7 gün, kötüye kullanılan bir bağlantıdan
    çıkış yoludur.
  - Çocuk 18+ olunca, hesaplardan biri silinince ya da çocuk 15'ten küçük çıkınca hemen biter.
  - Bitince ebeveynin gördüğü her şey ve ayarlar silinir; ayarlar çocuktan kalkar.

### 5. Ebeveyn araçları

| Yönetmelik (md. 9/3)         | Bargu'da                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Ayarları yönetme         | Aşağıdaki ayarları ebeveyn koyar; çocuk değiştiremez, görür                                                                                                                                                                   |
| (ç) Konum paylaşımı denetimi | **Yeni kişi onayı** (varsayılan açık): çocuk bir arkadaşlık, grup ya da etkinliğe katılmak istediğinde istek ebeveyne gider. Ebeveyn onaylayınca katılım olur. Ebeveyn, çocuğun konumunu kimlerin görebileceğini her an görür |
| (c) Kullanım süresi          | Günlük süre görünür. Ebeveyn günlük sınır koyabilir (kapalı, 30 dk–6 sa). Sınır dolunca harita kapanır, "Bugünlük süren doldu" yazar. Konum paylaşımı arka planda sürer; çocuk paylaşımı durdurabilir                         |
| (b) Satın alma               | Bugün ücretli özellik yok. Bargu+ geldiğinde her satın alma ebeveyn onayı ister ve ebeveyn aylık harcama sınırı koyar; o dilimde yapılır                                                                                      |

- **Onay istekleri:** Çocuk QR ya da kullanıcı adıyla birini eklemek ya da bir çembere katılmak
  istediğinde sunucu isteği saklar ve çocuğa `403 GUARDIAN_APPROVAL` döner. Uygulama "Ebeveyninin
  onayı bekleniyor" der. Ebeveyne bildirim gider. Onaylanınca sunucu katılımı çocuğun adına yapar;
  reddedilirse ya da 7 günde cevap gelmezse istek düşer. Çocuk her iki durumda bildirim alır.
  Davet linkinin süresi dolmuşsa onay da işe yaramaz; uygulama bunu söyler.
- **Kullanım süresi:** Çocuğun telefonu uygulamanın ön planda kaldığı dakikaları gün gün sayar ve
  uygulama arka plana geçince sunucuya yazar. Sunucu yalnızca son 7 günü tutar.
- **Neden sunucuda düz:** Ayarlar ve onay istekleri sunucu tarafından uygulanmalı (çocuğun telefonu
  atlatabilir). Kullanım dakikaları konum değildir ve kaba bir sayıdır. Hepsi bağlantı bitince ya da
  hesap silinince silinir, log'lanmaz.

### 6. İtiraz (md. 10)

- **Kapsam:** Yaş yüzünden askıya alma ya da kapatma (belirteçle) ve 15–17 → 18+ değişikliği.
- **Yol:** Ücretsiz, Türkçe, insan incelemeli. Bildirimde destek e-postası ve "İtiraz et" yazar.
  İnceleyen proje sahibidir.
- **Kurallar:** İtiraz sürerken hesap silinmez. Cevapta Başkanlığa ve yargıya başvuru hakkı yazar.
  Başvuru sayısı, kabul oranı ve ortalama süre tutulur, yılda bir yayımlanır.
- **Ne zaman:** Bu dilimde metinler ve destek adresi gelir. Sayaçlar ve askıya alma belirteçle gelir;
  geçiş döneminde beyanla kimse askıya alınmaz.

### 7. Play hedef kitle

16–17 + 18+ (IZINLER.md). 13–15 işaretlenmez; 15 yaştakiler uygulama içinde 15–17 kurallarıyla
kullanır.

### 8. Uygulama parçaları

- **5a:** Yaş beyanı ve yaş grubu, 15'ten küçük reddi, mevcut hesaplara bir kez soru, 15–17 için
  kullanıcı adıyla bulunmama, geçmişin kapalı olması, etkinliğe yalnızca arkadaş QR'ıyla girme,
  yeni çemberde paylaşımın kapalı başlaması, /gizlilik bölümü.
- **5b:** Ebeveyn bağlantısı: kurulum, iki taraflı ekranlar, bitirme, bildirimler; "Kullanıcı
  adımla bulunabilirim" ayarı (QA 5a Y2).
- **5c:** Ebeveyn araçları: yeni kişi onayı, kullanım süresi ve günlük sınır.

## Sonuçlar

- Sunucu yeni olarak yaş grubunu, ebeveyn bağlantılarını, ebeveyn ayarlarını, onay isteklerini ve
  son 7 günün kullanım dakikalarını tutar. Konum, doğum tarihi ya da belirteç tutmaz.
- Yaş grubu başkasına gösterilmez.
- Harita ekran görüntüsü serbesttir; md. 8/5(f) için yalnızca hassas ekranlarda engel vardır. Bu,
  kılavuza göre yeniden değerlendirilecek bir risktir.
- 15–17 kişiyi kullanıcı adıyla eklemek mümkün değildir; arkadaşları QR ya da link kullanır.
- Beyan doğrulama değildir. Belirteç gelene kadar kapalı test sürer; takvim kılavuza bağlıdır.
- Gerçek ebeveynlik doğrulanamaz; iki taraflı yüz yüze onay ve çocuğun her şeyi görmesi bunu
  hafifletir.
- Eski uygulama sürümleri yeni hesap açamaz (yaş grubu gönderemez). Staging test botu var olan
  hesabıyla girer, etkilenmez.
- Etkinliğin QR'ını yalnızca yöneticileri açar (ADR 0020); bu yüzden 15–17 bir etkinliğe, yöneticisi
  arkadaşıysa girer.

## Ürün soruları (PM ve proje sahibi, 2026-10-15)

1. **Ekran görüntüsü:** Önerilen "herkes için engel" seçilmedi; harita serbest, yalnızca hassas
   ekranlarda engel (bölüm 3).
2. **Çocuğun bağlantıyı bitirmesi:** Ebeveyn onaylarsa hemen, onaylamazsa 7 gün sonra.
3. **Ebeveynin çocuğun bir çemberindeki paylaşımı kapatması:** İlk sürümde yok. Ebeveyn kişileri
   görür ve yeni kişileri onaylar.
4. **Yeni kişi onayı:** Bağlantı kurulunca varsayılan olarak açık; ebeveyn kapatabilir.
5. **Ebeveyn bağlantısı:** 15–17 için isteğe bağlı, zorunlu değil.
6. **15–17 → 18+:** Belirteç gelene kadar destek e-postasıyla, insan incelemesiyle.

2–6 PM önerildiği gibi onayladı; 5 proje sahibine soruldu ve onaylandı.
