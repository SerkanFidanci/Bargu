# 0030. Kendi konum geçmişi: yalnız telefonda, kapalı başlar, ek GPS yok

- Durum: Önerildi. Tasarım PM onaylı (2026-10-22); kodlama sahibin seviye 5 APK'sını telefonda
  denemesinden sonra
- Tarih: 2026-10-22
- İlgili: [ADR 0019](0019-location-history.md) (çember geçmişi), [ADR 0013](0013-weather-without-location.md)
  (yer adı haritanın kendi etiketlerinden), [ADR 0021](0021-safety-features.md) (uygulama kilidi),
  [ADR 0022](0022-account-deletion-export-consent.md) (dışa aktarma, silme),
  [ADR 0024](0024-entitlements-and-test-billing.md) (Bargu+ ve deneme), BARGU_PLAN Faz 11
  ("Kendi geçmişin"in temel görünümü öne alındı).

## Bağlam

Proje sahibi (2026-10-22): "Kendi konum geçmişimi de görebilmek istiyorum." PM, Faz 11'deki "Kendi
geçmişin"in temel görünümünü öne aldı. Keşif haritası, rotalar ve yıl sonu kartı Faz 11'de kalır.

Kurallar (PM):

- Kapalı başlar. Bargu+ ve deneme özelliği.
- İz yalnız telefonda durur. Sunucuya, log'a ve bildirime koordinat gitmez.
- Kayıt yalnız paylaşım açıkken zaten alınan konumlardan yapılır. Ek GPS ya da arka plan konum izni
  yok.
- 30 gün ya da 1 yıl; tek dokunuşla silme; dışa aktarma (KVKK md. 11).
- Abonelik bitince kayıt durur, eski geçmiş kalır.

Bugünkü durum (kod taraması, 2026-10-22):

- Telefon kendi izini zaten tutuyor: kasada `history:mine:<çeyrek saat>`, ama yalnız en az bir
  çemberde geçmiş kaydı açıkken (ADR 0019). Çemberdeki "Geçmişimi gör" ve dışa aktarma bu izi okur.
- Bu iz rıza geri çekilince ve son çemberde geçmiş kapanınca silinmiyordu; 14 günlük budama da
  yalnız kayıt sürerken çalışıyordu. Düzeltmesi seviye 5 APK'sının diliminde (ADR 0019 eki).
- Kasa tek şifreli MMKV dosyası; her açılışta tümüyle çözülür.
- Konum kaynakları:
  - Tam paylaşımda GPS 5 sn'de bir.
  - Yalnız yaklaşık paylaşımda Wi-Fi/baz 30 sn'de bir; GPS yok.
  - Hayalette ve kimseyle paylaşmayanda konum servisi çalışmaz; yalnız harita açıkken gelen
    konumlar olur.

## Karar

### 1. Kayıt yalnız paylaşım sürerken, ek konum istemeden

Konum motorunun zaten aldığı ve süzgeçten geçen konumlar (`onFix`) kaydedilir. Kayıt için ayrı
GPS, ayrı izleyici ya da arka plan izni yoktur.

| Durum                                      | Kayıt                                                        |
| ------------------------------------------ | ------------------------------------------------------------ |
| En az bir çemberle tam paylaşım            | Tam iz, seyreltilmiş                                         |
| Yalnız yaklaşık paylaşım                   | Kaba iz (GPS yok): doğruluğuyla, ekranda daire ve "yaklaşık" |
| Hayalet açık                               | Yok (harita açıkken gelen konumlar da yazılmaz)              |
| Kimseyle paylaşmıyor, çemberler duraklamış | Yok (konum servisi çalışmıyor)                               |
| Telefon kapalı, uygulama durmuş            | Yok                                                          |
| Bargu+ ya da deneme yok                    | Yeni kayıt yok; eski geçmiş görülür, aktarılır, silinir      |

Kimseyle paylaşmayan biri için hiç kayıt olmaz. Bunu hem açarken hem ekranın altında hem de o an
paylaşım yoksa üstteki bir kartta açıkça söyleriz:

- "Konum geçmişin yalnızca konumunu en az bir çemberle paylaşırken kaydedilir…"
- "Şu an kimseyle konum paylaşmıyorsun; geçmişine bir şey yazılmıyor."

### 2. Model ve kod ortak, depo ayrı

Ortak kullanılanlar (ADR 0019): nokta modeli (`TrailPoint`), seyreltme (25 m ya da 5 dk; 100 m'den
kötü doğruluk boş olmayan çeyrek saatte atılır; çeyrek saatte en çok 250 nokta), gün akışı (durak:
150 m içinde en az 5 dk; boşluk: 45 dk; hız türleri) ve haritadaki iz katmanı.

Depo ayrıdır:

- Süre farklı: çember geçmişi 14 gün, kendi geçmişin 30 gün ya da 1 yıl.
- Kural farklı: kendi geçmişin yaklaşık paylaşımı da kaydeder.
- Silme tek dokunuşla ve yalnız bunu siler.
- Çemberdeki "Geçmişimi gör", çemberlerin gördüğünü birebir göstermeye devam eder.

### 3. Saklama: ay başına ayrı şifreli dosya

1 yıllık iz tahminen 5–20 MB tutar. Kasaya girerse her açılışta çözülür ve açılış yavaşlar. Bu
yüzden:

- Ay başına bir MMKV örneği (`bargu-trail-YYYY-MM`) kullanılır, AES-256 ile, kasanın yöntemiyle.
  Anahtarı SecureStore'da durur, kasa anahtarından ayrıdır. Erişim "yalnız bu cihaz, kilit
  açıkken"dir (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`; PM). Yeni bir kripto primitifi yoktur.
- Kilitli telefonda bu anahtar okunamaz; konum ise çoğunlukla telefon cepteyken, kilitliyken gelir.
  Bu yüzden:
  - Kaydedilmemiş günlerin noktaları her zaman açık olan kasada durur, çeyrek saat anahtarlarında
    (kendi önekiyle, çember geçmişinden ayrı). Kasanın anahtarı ilk kilit açılışından sonra
    okunur.
  - Ay dosyalarına yazmak, yani günü sıkıştırmak ve geçmiş günleri okumak, yalnız telefonun kilidi
    açıkken ve uygulama çalışırken olur.
  - Günler birikirse (uygulama günlerce kilit açıkken çalışmadıysa) hepsi ilk fırsatta sıkıştırılır.
    Kasada bekleyen kısım bu yüzden birkaç günle sınırlıdır.
- Geçmiş bir gün seçilince o ayın dosyası açılır, ekrandan çıkınca kapanır.
- Sıkıştırmada gün tek kayda iner: durakta tek nokta (giriş ve çıkış saatiyle), yolda seyreltilmiş
  iz.
- Saklama süresi dolan günler açılışta ve gün dönümünde silinir.
- Silme: anahtar ve bütün dosyalar gider; geri getirilemez.
- Günler telefonun yerel saatine göre bölünür.
- Kasadaki her konumda bütün anahtarları tarayan sıcak yol (ADR 0019 kodu) dizinle değiştirilir.

### 4. Görünüm

- **Giriş:** Ben > Konum ve gizlilik > "Konum geçmişim". Bugünkü "geçmişimi kimler görüyor" ekranı
  bu ekranın içinde bir satır olur ("Çemberlerin gördüğü geçmiş: N çember"). Kendi kartındaki
  "Geçmiş" düğmesi de buraya gelir.
- **Ekranın yapısı:**
  - Aç/kapa. Bargu+ ya da deneme yoksa Bargu+ ekranına gider.
  - Gün şeridi; kaydı olmayan günler soluk.
  - O günün izi ve durakları haritada.
  - Durak listesi: "Ev · 08:10–17:45 · 9 sa 35 dk", aralarında "12 dk yürüyüş".
  - Kaydı olmayan saatler "Kayıt yok".
- **Yer adı ağa sorulmaz.** Sırasıyla:
  1. Kendi kayıtlı yerin.
  2. Kamera günü çerçeveleyince haritanın mahalle ve semt etiketleri (ADR 0013).
  3. Durağa dokununca yaklaşılıp daha ince ad.
  4. Hiçbiri yoksa "Durak N".
- **Ekranın altında:** saklama süresi (varsayılan 30 gün), "Geçmişimi sil" (onaylı), "Dışa aktar"
  (Hesap ve veri) ve şu not: "Geçmişin yalnız bu telefonda durur. Telefon değişince ya da Bargu'yu
  silince gider; istersen önce dışa aktar." Android yedeği kapalıdır.

### 5. Hak, rıza, yaş, kilit

- **Hak kapısı:** yalnız telefonda, çünkü veri sunucuya gelmez. Değiştirilmiş bir uygulama ücretsiz
  kaydedebilir. **Kabul edilen risk (PM, 2026-10-22):** sunucuya maliyeti ve başka kimseye etkisi
  yok; yalnız gelir kaybı.
- **15–17:** açabilir, varsayılan kapalı. Ebeveyn görmez; ebeveyn araçlarında da görünmez (PM).
  Çember geçmişinden farkı: veri kimseye gitmez.
- **Rıza:** veri telefondan çıkmaz, bu yüzden sunucuda rıza kaydı yoktur. Açık bir aç düğmesi ve
  açıklama yeterlidir. Avukata sorulacaklara not edilir.
- **Kilit:** açarken uygulama kilidi önerilir: "Telefonun kilidi açıkken geçmişini başkası da
  görebilir."
- **Tehdit modeli:** THREAT_MODEL'e bir satır eklenir: kilidi açık telefona erişen kişi geçmişi
  görür; önlem kilit önerisi ve kısa saklama süresi.

### 6. Dışa aktarma, çıkış, testler

- **Dışa aktarma:** aynı JSON dosyasına saklanan bütün günler (noktalar ve duraklar) girer.
  Dosyanın şifresiz olduğu ekranda yazar.
- **Çıkış ve hesap silme:** kasa ile birlikte bu dosyalar ve anahtarları da silinir.
- **Otomatik testler:**
  - Modül ağ, push ve log modüllerini import etmez (statik test).
  - Ağ, bildirim ve log yollarında bu verinin görünmediği casuslarla denetlenir.
  - Kayıt kuralları (yukarıdaki tablo), budama, silme, dışa aktarma ve çıkış test edilir.

## PM kararları (2026-10-22)

1. Hayalette hiç kayıt yok.
2. 15–17 açabilir, varsayılan kapalı; ebeveyn görmez, ebeveyn araçlarında görünmez.
3. Varsayılan süre 30 gün; 1 yıl seçilebilir.
4. Boşluklarda neden ("Hayalet · 14:00–16:30") sonraki dilimde; koordinatsız küçük bir olay
   listesi gerekir. İlk sürümde "Kayıt yok".
5. Hak kapısı telefonda; kabul edilen risk (5. bölüm).
6. Kasadaki sıcak yolun düzeltmesi kayıt dilimine girer.
7. Ekran metinleri bu ADR'deki önerilerle, tr ve en.

## Sonuçlar

- Sunucu, protokol ve bildirim değişmez. Yeni bir şifreli tür yoktur.
- Pil: ek konum alınmaz; yalnız gelen konumlar ayrıca yazılır.
- Telefon değişince geçmiş kaybolur (bilerek; ekranda yazar).
- Yaklaşık paylaşanın geçmişi kabadır; tam iz isteyen tam paylaşmalıdır. Bu bir ürün sınırıdır.
- Kilitli telefonda geçmiş gün okunamaz ve sıkıştırılamaz; bu bilerek böyle (anahtar kilit
  açıkken).
- İki dilim:
  1. Kayıt, saklama, sıkıştırma, silme, dışa aktarma, kasadaki sıcak yol, testler.
  2. Ekran, harita, durak adları.
- Her dilim QA turu ve telefon denemesi ister. Sahip seviye 5 APK'sını telefonda denemeden
  kodlanmaz (sahip, 2026-10-22).

## Ek 1 (2026-10-30): Kapatınca silinir, açılış G APK'sında

PM kararları:

- **Kapatırken sorulur:** "Konum geçmişin kapatılsın mı? Kapatınca bu telefondaki geçmişin hemen
  silinir. İstersen önce dışa aktar." Seçenekler: Dışa aktar (kayıt açık kalır), Sil ve kapat (hemen
  silinir, kayıt durur), Vazgeç. Kayıtlı gün yoksa sormadan kapanır.
- **Bargu+ biterse** kayıt durur; eski günler seçilen süre (30 gün ya da 1 yıl) dolunca silinir;
  kullanıcı istediği an silebilir. Günlük temizlik Bargu+'ya bağlı değildir.
- **Açılış:** bayrak G APK'sında (hikaye düzenleyiciyle) açıldı. Bayrak kapalı bir derlemede kayıt,
  anahtar ve dosya yok, ekranda giriş yok, derin bağlantı haritaya döner (testli).
- **Yedek:** Android yedeği tamamen kapalı (`allowBackup` false; Android 11 ve öncesi ile 12+ kuralları
  bütün depolama alanlarını dışarıda bırakır); geçmişin MMKV dosyaları da içinde. QA-42/43
  doğrular.
- Gizlilik politikası ve /gizlilik bu metinle güncellendi; aydınlatma sürümü aynı (veri yalnız
  telefonda, Bargu işlemiyor).

## Ek 2 (2026-11-02): Keşif haritası

**Durum:** Kabul edildi (PM, 2026-11-02). Dört soruda da öneri geçerli; PM şartı aşağıda.

**Bağlam.** Bu ADR keşif haritasını Faz 11'e bırakmıştı. PM'in sektör kararları (2026-10-29) onu
paket D'ye aldı ("Ö7 kendi konum geçmişin ve kazıma haritası"); mağaza metninde "yarışsız kazıma
haritası" var. D'nin geri kalanı (Ö7'nin temel görünümü, Ö12, N2, N3) yayında; açık kalan bu.

**Öneri:**

1. **Yeni veri yok, yeni saklama yok.** Harita, Ö7'nin zaten sakladığı günlerden (30 gün ya da 1
   yıl) telefonda, ekran açılınca hesaplanır ve yalnız bellekte durur; diske yazılmaz. Gün silinince
   (süre dolunca, "Sil ve kapat"ta, çıkışta) haritadan da düşer. Bu yüzden gizlilik politikası, Play
   veri güvenliği formu, THREAT_MODEL, sunucu ve protokol değişmez. Politikadaki "gezdiğin yerler"
   bunu zaten anlatıyor.
   - Reddedilen: "gittiğin her yer, ömür boyu" ayrı kaydı. Seçilen süreyi aşan yeni bir saklama
     olur, politika değişir; kilidi açık telefonda yıllarca gidilen yerler görünür.
2. **Izgara.** Harita karelerine bölünür: Web Mercator zoom 17 karosu, Türkiye'de kenarı yaklaşık
   230 m. Bir kare, içine düşen bir noktayla açılır.
   - Hassasiyeti 250 m'den kötü olan nokta kare açmaz (yaklaşık paylaşanın kaba izi yanlış yer
     açmasın).
   - Yolculukta art arda iki nokta arası, en çok 1,5 km'yse düz çizgiyle doldurulur. "Kayıt yok"
     boşlukları doldurulmaz.
3. **Görünüm.** "Konum geçmişim" ekranında "Gün / Keşif" seçimi. Keşifte harita yumuşak bir sisle
   örtülür, gidilen kareler açıktır; kamera açılan yerlerin hepsini çerçeveler. Altında tek satır:
   "Son 30 günde gittiğin yerler" (ya da "son 1 yılda").
   - **Yarışsız:** sıralama, arkadaşla karşılaştırma, paylaş düğmesi, yüzde, seri ve "yeni yer
     açtın" bildirimi yok.
   - Sis haritanın kendi katmanı (MapLibre), JS'de animasyon yok; sade modda geçişsiz.
   - Ekran okuyucu: "Keşif haritası, son 30 günde gittiğin yerler açık."
4. **Karo istekleri.** Keşif görünümü, gün görünümü gibi geçmiş bölgelerin karolarını kendi
   sunucumuzdan ister. Bu, THREAT_MODEL'deki "görüntülenen bölge = konum" satırının kabul edilen
   riski; yeni bir şey değil.
5. **15–17, hak, kilit:** Ö7 ile aynı. Bargu+ biterse harita kalan günlerden çizilmeye devam eder.
6. **Testler:** kare hesabı, hassasiyet eşiği, doldurma sınırı, boşlukta doldurmama, karelerin
   birleşmesi (ortak kenarlar kalkar, delikler doğru), süre dolunca düşme, modülün ağ ve log
   modüllerini import etmemesi (statik test), ekran ve sade mod.

**PM kararları (2026-11-02):**

1. Süre Ö7 ile aynı; ayrı, ömür boyu bir kayıt yok.
2. Ekranda sayı yok.
3. Kare yaklaşık 230 m (zoom 17).
4. PM kararı 4'teki boşluk nedeni ("Hayalet · 14:00–16:30") D'ye girmez.

**PM şartı: hesap ekranı dondurmaz.** Bir yıllık Ö7 on binlerce nokta olabilir.

- Hesap gün gün, parça parça yapılır ve parçalar arasında JS iş parçacığına yer verilir. Bir parça
  en çok **8 ms** sürer (60 fps'te bir karenin yarısı). Hesap sürerken ekranda "Hazırlanıyor"
  yazar; harita bu sırada dokunmaya cevap verir. Ekrandan çıkılınca hesap durur.
- **Bütçe**, 365 günlük yapay ve dağınık bir yılla (günde 300 nokta, yaklaşık 110 bin nokta)
  ölçülür ve testlidir:
  - test makinesinde iki ara arasında en çok 50 ms (CI'daki yavaş makine payıyla; telefonda hedef
    8 ms);
  - toplamda en çok 3 sn.
- **Sisin çokgeni** birleştirilmiş tek bir çokgendir: ortak kenarlar kalkar, düz kenarlar tek
  kenar olur. Köşe sayısı en çok **20 000**. Çok dağınık bir yılda bu aşılırsa kareler bir kat
  kabalaştırılır (dört kare bir, yaklaşık 460 m), sınırın altına inene kadar. Açılan alan biraz
  büyür, hiçbir gidilen yer kapanmaz.
