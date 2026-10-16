# 0011. Konum motoru ve şifreli konum aktarıcısı (relay)

- Durum: Kabul edildi
- Tarih: 2026-10-14

## Bağlam

Faz 5 konumun kendisini getiriyor: telefon konumunu alır, her çember için ayrı bulanıklaştırır,
şifreler ve gönderir; sunucu yalnızca şifreli zarfı saklar ve diğer üyelere iletir; alan telefon
doğrular, çözer ve haritada gösterir. Plan (§1) arka plan konumu için Transistorsoft
`react-native-background-geolocation` diyor. O kütüphane Android'de yayın için ücretli lisans
istiyor ve henüz pil ölçümümüz yok. Ayrıca Android 14+, konum servisinin nasıl başlatılabileceğine
sıkı kurallar koyuyor.

## Karar

- **Konum kaynağı: `expo-location` + `expo-task-manager` (ücretsiz)**, ince bir katmanın arkasında
  (`features/location/tracker.ts`). Motorun geri kalanı (gönderme kuralları, şifreleme, gönderim)
  konum kaynağından bağımsız. 8 saatlik saha testinde pil kötü çıkarsa Transistorsoft yalnızca bu
  katmanın yerine geçer (ücretli seçenek olarak sahibine sorulur).
- **Yalnızca "uygulamayı kullanırken" izni.** Android'de konum, görünür bildirimli bir ön plan
  servisi olarak çalışır ("Konumun paylaşılıyor"); bu servis ekran kilitliyken ve uygulama
  arka plandayken de sürer, arka plan konum izni (`ACCESS_BACKGROUND_LOCATION`) hiç istenmez.
  Bildirim aynı zamanda şeffaflık: paylaşım açıkken telefonda her an görünür. Android bu servisin
  yalnızca uygulama öndeyken başlatılmasına izin verir; bu yüzden servis uygulama açılınca
  başlar/ayarlanır, arka planda ancak durdurulabilir. iOS'ta uygulamada başlayan güncellemeler
  arka planda sürer (mavi gösterge açık); iOS testleri Apple hesabıyla gelecek.
- **Tek görev, tek giriş noktası.** Görev (`bargu.location`) uygulamanın kendi giriş dosyasında
  (`apps/mobile/index.ts`) ekran yüklenmeden tanımlanır; Android uygulamayı ekransız başlatıp konum
  teslim ettiğinde de çalışır. Görev oturumu ve şifreli kasayı kendisi açar; gönderim için gereken
  çember listesi (kimlik, epoch, durum) kasada da tutulur.
- **Sıklık (plan §3.3)**: GPS, en az bir çember tam konum alıyorsa açık (5 sn'de bir ölçüm); yalnızca
  mahalle/şehir paylaşılıyorsa GPS kapalı, Wi-Fi/baz istasyonu (30 sn). Ölçümler mesafe filtresiz
  gelir; gönderme kararı motorda: hareket varsa 5 sn ve 10 m, duruyorsa 5 dk'da bir "buradayım",
  biri haritada izliyorsa ~1 sn. Pil seviyesi ve şarj durumu zarfın içinde (şifreli).
- **Canlı mod**: harita açıkken telefon çevresindeki çemberlere dakikada bir `watch` gönderir;
  alan telefon 2 dakika boyunca her ölçümü yollar, uygulama açıksa ayrıca saniyede bir GPS ölçümü
  alır. İzlenen telefon arka plandaysa `watch` ona ulaşmaz (canlı bağlantı yalnızca uygulama
  açıkken); hareket halinde zaten 5 sn'de bir gönderdiği, dururken de konumu değişmediği için
  sessiz push ile uyandırma şimdilik yapılmadı.
- **Gönderim**: canlı bağlantı açıksa WebSocket (`publish`), değilse HTTP (`POST /v1/locations`).
  Bir istekte en çok 10 zarf (çember). Çevrimdışıyken yalnızca en yeni ölçüm bekler.
- **Paylaşım ayarları yalnızca telefonda** (şifreli kasa): çember başına aç/kapa, hassasiyet
  (tam / mahalle ~1 km / şehir ~10 km, bulanıklaştırma şifrelemeden önce telefonda), süre
  (süresiz / 1 saat / bu akşama kadar) ve hayalet modu (dondur: son konum kalır; gizle: herkesin
  haritasından kalkar). Sunucu bu seçimleri hiç öğrenmez. Bir çember konum almayı bırakınca
  (kapatıldı, süre doldu, "gizle") son konum sunucudan geri çekilir (`withdraw`); ayar değişince
  son ölçüm hemen yeniden gönderilir (daha kaba hassasiyet eski ince konumun yerine geçer).
- **Aktarıcı (sunucu)**: zarfın imzasını, gönderenin üyeliğini ve epoch'u denetler; her üyenin
  yalnızca en yeni zarfını Redis'te 24 saat tutar (alan bazlı süre), diğer üyelere anında iletir.
  Açılışta ve her yeniden bağlanmada telefon son zarfları ister. Düz koordinat sunucuya hiç gelmez;
  log/DB/Redis'te koordinat olmadığını otomatik test doğrular.
- **Alan telefon**: imza, gönderen anahtarı, tekrar penceresi denetlenir; anahtarı gelmemiş zarf
  bir sonraki eşitlemeye kadar bekler; kimlik anahtarı değişmiş üyenin konumu kullanıcı onaylayana
  kadar gösterilmez. Her kişinin son konumu şifreli kasada tutulur: yeniden açılışta tekrar
  koruması aynı zarfı haklı olarak reddeder, harita bu kopyadan başlar. Sunucuda artık olmayan
  konum (süresi dolan, geri çekilen, çıkan üye) telefondan da silinir. 10 dakikadan eski konum gri
  ve yaşıyla gösterilir.
- **`expo-location` 57.0.20'ye sabit**: 57.0.21 güven düzeyi düşük yayınlandı (pnpm
  `trustPolicy: no-downgrade` reddetti); aynı yayıncının 7 günden eski sürümü kullanılıyor.

## Sonuçlar

- Android'de kilitli ekranda gönderim ücretsiz ve arka plan izni olmadan çalışır; bedeli, paylaşım
  açıkken hep görünen bir bildirim. Kullanıcı uygulamayı kaydırıp kapatsa da servis sürer;
  durdurmanın yolu hayalet modu ya da paylaşımı kapatmak.
- GPS'in ne zaman açık kalacağını arka planda değiştiremiyoruz (servis yeniden başlatılamaz); pil
  davranışı 8 saatlik saha testinde ölçülecek. Hareketsizken GPS'i kapatan hareket algılama
  gerekirse Transistorsoft ya da kendi native modülümüz değerlendirilir.
- Avatarların iki ölçüm arasında akıcı kayması (interpolasyon) JS iş parçacığında animasyon
  yasağı nedeniyle Faz 6'ya (harita deneyimi, native/worklet tabanlı) bırakıldı; şimdilik işaretler
  her yeni ölçümde yerine geçer.
- Arka plandaki telefona canlı mod isteği (sessiz push) Faz 7 bildirim işiyle birlikte
  değerlendirilecek.

## Ek (2026-10-16, Faz 9B dilim 2b): hız ve durma süresi etiketi, "Hızımı gösterme"

Proje sahibi haritada kişinin altında hızını ya da ne kadar süredir durduğunu görmek istedi
("kaç km hızla gittiğini, duruyorsa kaç saattir durduğunu"). PM onayladı. Protokol ve sunucu
değişmez; bilgi zaten şifreli konum içeriğindedir.

- **Alan telefon:** Avatarın adasının altında tek bir satır çıkar.
  - Hareket ediyorsa hız yazar: "40 km/sa". Eşik 1 m/s; değer 5'er km/sa yuvarlanır, bir hız
    göstergesi gibi okunmasın diye.
  - Duruyorsa göndericinin "ne zamandır burada" bilgisinden süre yazar: "12 dk", "2 sa", "1 gün".
    Bu bilgi (`since`) 100 m içinde kalındıkça sürer, en az 1 dakika olmalıdır.
  - Konum eskiyse bunların yerine yaşı yazar ("12 dk önce"), çünkü eski hız ya da süre artık doğru
    değildir.
  - Yan yana duranların ortak çerçevesinde satır çıkmaz (yer yok, üst üste binerdi). Grubun
    penceresi aynı bilgiyi her kişi için yazar.
  - Ekran okuyucu satırı açık okur: "saatte 40 km", "2 saattir aynı yerde".
- **Yalnızca tam konumda:** Kaba konumda hız ve süre şifrelemeden önce zaten atılır
  (`applyPrecision`), o çemberde satır çıkmaz.
- **"Hızımı göster" ayarı (Gizlilik ekranı, cihazda, sunucu bilmez):**
  - Kapalıyken telefon hızı şifrelemeden önce içerikten çıkarır; hız telefondan hiç çıkmaz.
  - Çemberler bu durumda ne hızı ne de neyle gidildiğini (yürüyüş, araba) görür; hareket simgesi
    de hızdan çıkarıldığı için kaybolur.
  - Yön (`hdg`) ve durma süresi gönderilmeye devam eder; yön hız söylemez, durma süresi zaten
    "bir süredir aynı yerde" simgesi olarak görünüyordu.
  - Varsayılan: 18+ için açık; 15–17 için kapalı (ADR 0023 kuralları uygulanırken bir kez yazılır,
    kullanıcı sonra açabilir).
- **Gizlilik farkı:** Hız önceden yalnızca simge olarak (yürüyor, araçta) görünüyordu; sayı daha
  açık bir bilgidir. Bu yüzden ayar aynı dilimde geldi (PM kararı) ve yuvarlama yapılır.
