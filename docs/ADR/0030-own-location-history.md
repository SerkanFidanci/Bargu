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
