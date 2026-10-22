# 0028. Konumun doğruluğu: filtre, kayma ve ölçüm katmanı

- Durum: Kabul edildi, 1. adım (PM, 2026-10-18). 3. adım (arka planda canlı mod): önizleme denemesi
  için onaylandı (PM, 2026-10-21); ölçümden sonra PM son onayı verirse kalıcı olur, o zamana kadar
  yalnızca önizleme paketinde. "Neden eski?" eki (2026-10-22): PM tasarımı onayladı.
- Tarih: 2026-10-18
- İlgili: [ADR 0002](0002-location-relay.md) (konum yolu), [ADR 0008](0008-design-system-and-map.md)
  (harita, hareket tokenları), [ADR 0027](0027-calm-mode-and-motion-budget.md) (sade mod)

## Bağlam

Proje sahibi: konum geç güncelleniyor, bazen sapıp sonra düzeliyor; arkadaşta daha belirgin,
"yol virajlı gidiyor, yoldan sapıp dümdüz devam ediyor, güncellenince düzeliyor". İnceleme dört
neden buldu:

1. **Sapma:** alıcı, hareket eden kişiyi son konumdan sonra 10 saniyeye kadar aynı yön ve hızla
   ileri taşıyordu (dead reckoning). Virajda pin yolun dışına çıkıyor, yeni konum gelince geri
   dönüyordu.
2. **Geri sıçrama:** telefonun iki konum kaynağı var (konum servisi ve 1 saniyelik canlı izleme).
   Motor ve alıcı konumun ölçüldüğü zamana bakmıyordu: eski bir konum yenisinin üstüne yazılabiliyordu.
3. **Kötü konumlar:** doğruluğu 1 km olan bir Wi-Fi tahmini de, önbellekten gelen eski bir konum da,
   bir anlık sıçrama da olduğu gibi gönderiliyordu.
4. **Gecikme:** arka planda 5 saniyede bir örnek; kendi pini de 5 saniyede bir. Canlı mod (1 sn)
   yalnızca arkadaşın uygulaması öndeyken açılıyor.

Araştırma (Mapbox ve Google'ın konum katmanları, platform rehberleri): pin, gösterildiği yerden yeni
konuma iki konum arasındaki süre kadar kayar; tahmin en fazla yaklaşık 1 saniye ve yalnızca düz,
sabit bir gidişte yapılır; eski, önbellekten gelen ve zayıf konumlar gönderilmeden ayıklanır.

## Karar

### 1. Gönderen: ham konuma filtre (`features/location/fix-filter.ts`)

Filtre çemberin hassasiyetinden **önce**, ham konuma uygulanır. Konum ya olduğu gibi kullanılır ya
hiç; hiçbir konum değiştirilmez. Mahalle ya da şehir çemberi aynı ham konumun hücresini alır (testli:
kaba çembere giden konum, ham konuma `applyPrecision` uygulanmış hâliyle birebir aynı).

Sırayla:

- **Eski:** son kullanılandan daha yeni ölçülmemiş konum atılır (öbür kaynak önce gelmiştir).
- **Bayat:** 2 dakikadan eski ölçülmüş konum atılır. Süre cömert: Android arka plan konumlarını iş
  zamanlayıcısıyla, bazen gecikmeli teslim ediyor.
- **Zayıf:** GPS açıkken (bir çember tam konum alıyorsa) doğruluğu 100 m'den kötü olan konum
  bekletilir. 45 saniye hiç konum kullanılmazsa (kapalı alan, AVM) bekleyenlerin en iyisi **doğruluk
  bilgisiyle** gönderilir; alıcı onu daire olarak çizer ve tahmin yapmaz (PM ek 1). Yalnızca kaba
  çember varsa GPS kapalıdır ve Wi-Fi tahmini normal konumdur.
- **Sıçrama:** iki doğruluğun toplamından uzak ve 50 m/sn'den (180 km/sa) hızlı ulaşılan konum
  bekletilir; kendisinden sonra gelen iki konum onunla uyuşursa kabul edilir (tünel çıkışı, tren).
  Tek bir sapkın konum hiç kullanılmaz.

Sayılar başlangıç değeridir; önizleme paketindeki ölçüm katmanıyla ayarlanır.

### 2. Alıcı: eski konum gösterilmez (`features/location/receive.ts`)

Bir kişinin gösterilen konumundan önce ölçülmüş konum gelirse (geç gelen) gösterilmez. Aynı zaman
yeniden gelirse yerine geçer: hassasiyet değişince motor aynı konumu daha kaba gönderir. 10 dakikadan
daha "eski" görünen konum gösterilir: o durumda göndericinin saati geri alınmıştır.

### 3. Kayma (`features/map/glide.ts`, tokenlar `theme/motion.ts` `glide`)

- Pin, gösterildiği yerden yeni konuma iki konumun ölçüm aralığı × 1,1 sürede kayar (en az 250 ms,
  en çok 2 sn). Saniyede bir gelen konumda pin hiç durmadan akar.
- **Tahmin en fazla 1 saniye** (PM onayı) ve yalnızca: hız 2 m/sn'den fazla, yön bir önceki konuma
  göre 20°'den az değişmiş, doğruluk 20 m'den iyi. Virajda, yavaşlarken, dururken ve zayıf konumda
  tahmin yok: pin konumun kendisine gider.
- Pin hedefini geçmez (doğrusal ya da yavaşlayan geçiş; tahmin ≤ hız × 1 sn) ve zamanda geri gitmez:
  gösterdiğinden önce ölçülmüş konum gelirse yerinde kalır.
- İlk konum, 30 saniyeden uzun aradan sonraki konum ve 500 m'den uzak konum kaymadan yerine konur.
  Mahalle ve şehir hücreleri (1 km ve üstü) bu yüzden hücreden hücreye atlar, sahte hareket çizilmez.
- Sade mod aynen geçerli: "az" kısa kayar, "kapalı" atlar (ADR 0027).

### 4. Belirsizlik dairesi (`features/map/uncertainty-layer.tsx`)

Doğruluğu 100 m'den kötü, 700 m'den iyi olan konumun çevresinde, gerçek yarıçapında soluk bir daire
çizilir (haritanın kendi katmanı). Mahalle ve şehir hücreleri daire almaz; kişinin kartı "yaklaşık
konum" der.

### 5. Kendi pini: harita açıkken saniyede bir (C1)

Harita ekranda ve uygulama öndeyken telefon 1 saniyelik GPS izlemesini açar; kendi pini onu izler.
Ekran kapanınca, uygulama arka plana geçince ya da harita kapanınca hemen normale döner (PM ek 5).
Gönderme kuralları değişmez (izleyen yoksa en sık 5 sn ve 10 m).

### 6. Ölçüm katmanı (yalnızca önizleme paketi)

- Yalnızca geliştirme ve önizleme paketinde yüklenir: `index.ts` onu `__DEV__ ||
EXPO_PUBLIC_DEV_TOOLS === '1'` koşuluyla içe aktarır. Expo bu değeri sürüm paketinde sabit olarak
  yazdığı için koşul derlemede düşer; **production paketinde katmanın kodu yoktur** (PM ek 3).
  Doğrulandı: bayraksız `expo export` paketinde katmanın metin anahtarları 0 kez geçiyor; bayraklı
  pakette var. Production'da kalan: boş bir dinleyici kancası (`probe.current = null`), boş bir yuva
  ve menü satırının metin anahtarı.
- Ölçümler yalnızca bellekte; sunucuya, log'a, diske gitmez. Katmana hiçbir koordinat verilmez:
  yalnızca zamanlar, doğruluklar, kaynaklar ve sayılar (testli). Tek istisna: arka planda canlı
  modun sayaçları önizlemede telefonun kasasında kalır (aşağıda, 3. adım Ek'i, Karar 7).
- Ben > geliştirici bölümünden "Geliştirici: ölçüm katmanı" ile açılır; kısa Türkçe etiketler.
- Gösterdikleri: bu telefonun örnek aralığı (servis / canlı), gecikme, doğruluk, gönderim aralığı ve
  modu, filtrenin attıkları (eski, bayat, zayıf, sıçrama), kapalı alanda gönderilenler; her arkadaş
  için gecikme, aralık, doğruluk ve geç gelen sayısı; ekranın kare hızı.
- Katman açıkken kare ölçer sürekli çalışır (ADR 0027'nin boştaki sıfır kare kuralı katman açıkken
  geçerli değil).

## Ek: arabadan hızlı gidiş (PM, 2026-10-21)

Sıçrama kuralı (50 m/sn, 180 km/sa) hızlı trenle ve uçakla çakışıyordu: 250 km/sa giden bir
telefonun her konumu sıçrama sayılıyor, üç konumdan ancak biri kullanılıyordu. Kural, telefonun
kendi bildirdiği hıza göre esner:

- Ulaşmak için gereken hız 50 m/sn'den fazlaysa konum, ancak **bildirilen hız × 1,5 + 10 m/sn**'den
  fazlasını gerektirmiyorsa sıçrama sayılmaz.
- Yön de bildirilmişse yer değiştirmenin yönü bildirilen yönle **45° içinde** olmalı. GPS'in
  uydurduğu yan sıçramalar böyle tutulur.
- Bildirilen hız yoksa ya da geçersizse (eksi, boş, sayı değil) eski katı kural geçerli.
- **350 m/sn**'den (yaklaşık ses hızı) hızlısı her zaman şüpheli.
- Android'in hız doğruluğu (speedAccuracy) kullanılamıyor: expo-location onu vermiyor. Bu yüzden
  yalnızca hızın varlığı ve geçerliliği denetlenir.
- Testler: 250 km/sa tren (saniyede bir de, beş saniyede bir de) her konumda kabul; tünel çıkışında
  düşük bildirilen hızla 2 km sıçrama tutulur, iki onayla kabul; hızsız konumda eski kural; yönü
  tutmayan sıçrama tutulur; ses hızının üstü tutulur.

## Ek (2026-10-21, 3. adım: arka planda canlı mod)

PM onayı: önizleme denemesi için onaylandı; son onay ölçümden sonra.

### Bugün

Biri haritayı açınca telefonu dakikada bir `watch` gönderir; sunucu çemberin öbür üyelerine yalnız
canlı bağlantıdan `watch` olayı yollar (izleyeni söylemez, yalnız çemberi). Uygulama arka plana
geçince canlı bağlantı pil için kapanır: sinyal arka plandaki telefona hiç ulaşmaz; saniyede bir
GPS de yalnız uygulama öndeyken açılır. Arka plandaki arkadaş bu yüzden 5 sn'de bir gelir.

### Karar

1. **Sinyal:** `watch` geldiğinde sunucu, canlı bağlantısı olmayan üyelere ayrıca mühürlü bir
   sunucu haberi (`notice`, tür `watch`; ADR 0016) gönderir. Haber yalnız çember kimliğini taşır:
   izleyenin adı, cihazı, imzası yoktur; bugünkü canlı olaydan fazlasını söylemez. Yalnızca o
   üyenin güncel cihazına gider, izleyene hiç gitmez, duraklı (kimsenin ödemediği) çember için ve
   yabancı için hiç üretilmez. Bildirim gösterilmez. Sunucuda `WATCH_PUSH` ayarının arkasında:
   staging'de açık, ayar yoksa kapalı. Şimdilik yalnız Android'e gider: iPhone'da bu haber
   "Yeni bir bildirimin var" yer tutucusuyla ekranı yakardı (iOS sonra).
2. **Sunucu hız sınırı (alıcı başına, kaç kişi izlerse izlesin):** en çok 90 sn'de 1 ve saatte 20
   haber. İkisi de ortam ayarıyla değişir: `WATCH_PUSH_MIN_SECONDS` (90) ve `WATCH_PUSH_PER_HOUR`
   (20). Saatlik sınır **kayan** bir penceredir (PM, 2026-10-21): her alıcı için son haberlerin
   zamanı Redis'te tutulur ve tek adımda bakılır; son haber 90 sn'den yakınsa ya da son bir saatte
   zaten 20 haber varsa yeni haber verilmez, reddedilen hiçbir şey kaydetmez. Sabit bir saat
   penceresi kenarında yaklaşık 40 habere izin verirdi; kayan pencerede hiçbir saat 20'yi geçmez
   (gerçek Redis'te zamanı oynatarak testli). İzleyen başına bugünkü sınır (30 sn'de 2) aynen sürer. FCM haberi en çok 2 dakika tutar ve yeniden denemez; 2 dakikadan eski haber
   telefonda atılır: geç gelen sinyal kimse için pencere açmasın.
3. **Telefon:** arka plan görevi haberi açar. Aşağıdaki durdurucuların hiçbiri yoksa telefon 2 dk
   (`LIVE_MS`) canlı moda geçer: saniyede bir konum, gönderim bugünkü canlı kurala göre (en sık
   0,9 sn, soket kapalı olduğundan HTTP ile). Süre bitince normal ritme (5 sn) döner. Pencere
   sürerken yeni haber gelirse (izleyen bakmaya devam ediyor) pencere uzar, aynı sınırlar içinde.
   Bildirim metni değişmez: izlendiğini göstermez.
   **Durdurucular (telefonda, hiçbiri sunucuya ya da başkasına söylenmez):**
   - kullanıcının ayarı kapalı;
   - hayalet modu (dondur ya da gizle);
   - bu çemberle yalnızca kaba (mahalle ya da şehir) paylaşım, ya da hiç paylaşım yok;
   - bu çemberle zamanlı paylaşımın süresi dolmuş;
   - çember duraklı (kimse ödemiyor, ADR 0024): **asla**;
   - pil tasarrufu açık (şarjda da durdurur);
   - pil %20'nin altında **ve telefon şarjda değil** (PM, 2026-10-21): şarj olan ya da dolu telefonda
     bu durdurucu geçerli değildir;
   - telefonun kendi sınırı: **kayan her saatte en çok 15 dakika** arka plan canlı modu (sabit;
     sunucu ne yollarsa yollasın). İki dakikalık pencereler bir saatte 7 kez açılabilir; sekizincisi
     beklemek zorunda;
   - işletim sistemi arka plana konum vermezse (aşağıda): pencere 15 sn sonra kapanır.
     Pencere açıkken bunlardan biri başlarsa (hayalet açıldı, paylaşım bitti, çember duraklandı) pencere
     hemen kapanır. Uygulama öne gelince de kapanır: açık uygulamanın kendi canlı modu devralır.
4. **Ayar:** Konum ayarlarında "Arka planda canlı konum" (pil notuyla). 18+ için varsayılan açık.
   Kullanıcıya bir kez açıklama kartı çıkar: "Biri haritada sana bakarken konumun birkaç dakika daha
   sık gider; pil biraz daha harcanır. Ayarlardan kapatabilirsin." (İngilizcesi de var.) Kart
   haritada, uygulama bu özellik açıkken ilk açıldığında görünür; "Tamam" ile kapanır; ayarı açan
   kullanıcı açıklamayı zaten görmüştür, kart sonra çıkmaz. Kart haritadaki öbür kartlarla aynı
   sırada bekler (PM, 2026-10-21): konum izni, yeniden kurulum seçimi, bildirim sorusu, haftalık
   "kim görüyor" hatırlatması; aynı anda yalnız biri görünür, en sonda bu gelir, öndeki kapanınca
   sıradaki çıkar (`features/location/map-cards.ts`, gerçek kartlarla testli). Ayar yalnız bu
   telefonda, şifreli kasada durur.
5. **15–17:** varsayılan **kapalı**; yalnız gencin kendisi açabilir. Ebeveyn uzaktan açamaz; ayar
   ebeveyn araçlarında (ADR 0023 §5) gösterilmez ve taşınmaz (ebeveyn ayarları: yeni insanlar için
   onay ve günlük süre; ikisi de değişmedi, testle kilitli). Gerekçe: çocuklar için varsayılan her
   zaman en gizli olandır (ADR 0023, Play aile kuralları). 18+'dan 15–17'ye geçen telefonda önceki
   seçim taşınmaz, kapalı başlar. Yaş grubu henüz bilinmeyen telefonda özellik kapalıdır.
6. **Eski uygulamalar:** `openPush` bilmediği haber türünü reddeder (şema `strict`, bilinmeyen tür
   `MALFORMED`); uygulama bunu sessizce atar: bildirim yok, çökme yok (testli, bilinmeyen tür ve
   bilinmeyen haber). Bu yüzden istemci seviyesi artırılmadı (`CLIENT_LEVEL` 3 kalır). Eski bir
   uygulama yalnızca haberle uyanıp hiçbir şey yapmadan döner.
7. **Ölçüm katmanı (yalnızca önizleme, §6):** alınan `watch` haberi sayısı, açılan arka plan canlı
   dakikası ve reddedilenler neden diye: ayar, hayalet, paylaşım yok, kaba, süre bitti, duraklı,
   pil tasarrufu, pil az, sınır, sistem. Konum ya da çember kimliği yoktur: yalnız sayılar.
   Sayaçlar önizlemede, telefon denemesi için (PM, 2026-10-21) bu telefonun şifreli kasasında kalıcıdır:
   uygulama kapansa da kaybolmazlar; sunucuya ya da başka yere gitmezler ve çıkışta kasayla silinirler.
   Ölçüm katmanının geri kalanı §6'daki gibi bellekte kalır. Ölçüm katmanını yalnız geliştirme ve
   önizleme paketleri yüklediği için production'da sayaç da yoktur.
8. **Bayrak:** telefon tarafı şimdilik yalnız önizleme (ve geliştirme) paketinde: `EXPO_PUBLIC_BG_LIVE=1`
   (`eas.json` development ve preview). Production paketinde özelliğin kodu yoktur, ayar satırı ve
   kart da yoktur; gelen `watch` haberi atılır. Doğrulandı: bayraksız `expo export` paketinde
   özelliğin metinleri (kasa anahtarları, test kimlikleri) 0 kez geçiyor, bayraklı pakette var.
   Production'a, sahibin telefon denemesinden ve PM'in son onayından sonra açılır.

### Platform bulguları (resmi dokümanla denetlendi, 2026-10-21)

Tasarımdaki "konum servisini haberden sonra saniyeye çek" varsayımı tutmadı; yerine geçen çözüm:

- Android 12+ arka plandan ön plan servisi başlatmaya yüksek öncelikli FCM mesajı için istisna
  tanır (Android geliştirici dokümanı, "restrictions on starting a foreground service from the
  background"). Ama (a) sistem, kullanıcıya görünür bildirim üretmeyen yüksek öncelikli mesajları
  zamanla normal önceliğe çekebilir; çekilirse istisna gider; (b) Android 14'te `location` türündeki
  servis arka plandan kurulursa, "yalnızca kullanırken" izniyle konuma erişemez ve `SecurityException`
  verir; FCM istisnası bu erişim istisnaları arasında yok. Uygulama arka plan konum izni
  (`ACCESS_BACKGROUND_LOCATION`) istemiyor (ADR 0011).
- expo-location 57.0.20 de bunu kendisi engeller: `foregroundService` seçeneğiyle
  `startLocationUpdatesAsync`, uygulama ön planda değilse `ForegroundServiceStartNotAllowedException`
  fırlatır; ayarı arka planda değiştirmek servisi yeniden başlatmaz. Yani çalışan konum servisinin
  hızı arka plandan değiştirilemez.
- Yerine: servis zaten çalışırken (ön planda başlatıldığı için işlemin konum erişimi sürer) 2 dakikalık
  bir konum izleyici (`watchPositionAsync`, saniyede bir, yüksek doğruluk) açılır; konumlar bugünkü
  süzgeçten ve gönderim kuralından geçer. expo-location'ın dokümanı bu izleyicinin "yalnızca ön planda"
  çalıştığını söyler ve yerel kod, uygulama arka plana geçerken var olan izleyicileri durdurur; arka
  planda yeni kurulanı durdurmaz. Bu **telefonda doğrulanacak**. Çalışmazsa 15 sn içinde konum
  gelmez, pencere kapanır, "sistem" sayacı artar ve telefon 5 sn'lik normal ritminde kalır.
- Servis hiç çalışmıyorsa (paylaşım yok, uygulama hiç açılmadı) pencere açılmaz ("sistem").
- Android, uygulamayı zorla kapatan üreticilerde data mesajının uygulamayı uyandırmasına izin
  vermez (ADR 0016'daki gibi); orada özellik çalışmaz, arkadaş 5 sn ritminde kalır.

### Deneme ve ölçüm (onaydan önce, PM ek 6)

Önizleme APK'sı, iki telefon: A telefonu arka planda (uygulama kapalı, konum servisi açık), B
telefonunda harita 30 dk açık / kapalı. Ölçülecek: pil yüzdesi farkı, A'nın gönderim aralığı ve
B'deki gecikme (ölçüm katmanı), `watch` haberi sayısı, açılan dakika, red nedenleri (özellikle
"sistem": Android arka plana konum verdi mi, FCM öncelik düşürdü mü). Sonuç ve pil etkisi PM'e; son
onaydan sonra production'a açılır.

### PM'in cevapları (2026-10-21)

Uygulama sonrası açık sorulara PM'in cevabı; hangisi yapıldı, hangisi sonraya kaldı:

1. **Saatlik sunucu sınırı:** kayan pencere (ya da jeton kovası) olsun, pencere kenarında ~40'lık
   patlama olmasın. 90 sn en az aralık ve iki ortam ayarı aynen kalır. **Yapıldı** (Karar 2).
2. **Şarjdaki telefon:** şarj olurken "pil %20'nin altı" durdurucusu geçerli değil; pil tasarrufu
   yine durdurur. **Yapıldı** (Karar 3).
3. **Sayaçlar:** yalnız önizleme paketlerinde telefonda kalıcı (kasada, sunucuya hiç gitmez);
   production'da bellekte kalır, yani orada ölçüm katmanı olmadığı için sayaç da yoktur.
   **Yapıldı** (Karar 7).
4. **Açıklama kartı** (18+, ilk açılış, haritada, kapatılabilir) başka bir ilk açılış kartıyla üst
   üste binmez; haritadaki kartlar sıraya girer, aynı anda biri görünür. **Yapıldı** (Karar 4).
5. **Telefon denemesinde "sistem" reddi çıkarsa** sıradaki adım: küçük bir yerel Expo modülü
   (Kotlin), çalışan servisin konum isteğini yeni servis başlatmadan günceller. Yeni izin, Play
   beyanı ve yeni bağımlılık gerekmez. O da olmazsa arka planda 5 sn'lik ritimde kalınır.
   **Şimdi yapılmadı**; yalnız deneme sonucu gösterirse yazılır.
6. **`ACCESS_BACKGROUND_LOCATION`** ayrı bir ürün kararıdır, sahibine aittir; bu işin parçası değil
   (uygulama hâlâ yalnızca "kullanırken" izni ister, ADR 0011).
7. **Hep açık 1 sn'lik konum servisi** reddedildi (pil).
8. **iOS sessiz bildirimi** (`content-available`) iOS dilimine ait; bu işte yapılmaz. Sunucu o güne
   kadar `watch` haberini iPhone'a göndermez.

### Sonuçlar

- Arka plandaki arkadaş, birisi bakarken yaklaşık saniyede bir gelir; kimse bakmıyorsa 5 sn'de bir.
  Sunucu "biri bakıyor" bilgisini zaten biliyordu; yeni bilgi yalnızca Google'ın gördüğü haber zamanı
  (THREAT_MODEL).
- Pil: telefon başına en çok saatte 15 dakika ek canlı mod; ayardan kapatılabilir.
- Testler: sunucu (haber yalnız çevrimdışı üyenin güncel cihazına gider; izleyene, duraklı çembere,
  yabancıya gitmez; açılan kutuda yalnız tür ve çember var; alıcı başına 90 sn ve kayan saatlik
  sınır, iki izleyenle ve üç saatlik sürekli bakışta; `WATCH_PUSH` kapalıyken hiç), şema, FCM
  süresi, iOS'a gitmeme; telefon (her durdurucu, şarjdaki düşük pil, süre bitince normal ritim,
  sayaçlar ve önizlemede kalıcılıkları, saatlik sınır, 15–17 varsayılanı ve ebeveyn araçlarında
  olmaması, tek seferlik kart ve kartların sırası, bilinmeyen haber türünün sessizce atılması,
  `watch` haberinin hiç gösterilmemesi).

## Sonraki adımlar

- **2. adım:** proje sahibi ve test oturumu ölçer.
- **3. adım (C2):** arkadaş haritayı açınca göndericinin telefonu arka planda da canlı moda geçsin.
  Tasarım ve kararlar aşağıdaki "Ek (2026-10-21, 3. adım)" bölümünde; önizleme paketinde yazıldı,
  tek telefonda denenecek, sonuç ve pil etkisi PM'e gider. Koşullar (PM ek 6) karşılandı: sinyal
  kimin izlediğini yeni bir yolla açığa çıkarmaz, hız sınırları var, 15–17 kuralı yazıldı.

## Sonuçlar

- Virajda pin yoldan çıkmaz: tahmin en fazla 1 saniye ve yalnızca düz yolda.
- Pin zamanda geri gitmez; kötü ve eski konumlar arkadaşlara gitmez; kapalı alanda konum en geç
  45 saniyede bir, doğruluğuyla gider.
- Arkadaşın konumu 5 saniyede bir geliyorsa pin 2 saniyede yeni yere kayar ve bekler (tahmin yerine
  doğruluk). Akıcılık için canlı mod gerekir; arka planda canlı mod 3. adımda.
- Testler: filtre (eski, bayat, zayıf, kapalı alan, sıçrama ve iki onay, tek sapkın, otoyol), motor
  (iki kaynak, kapalı alan, kaba çember aynı, ölçüme koordinat gitmez), alıcı (geç gelen, aynı zaman,
  saat geri), kayma (hedefi geçmez, 1 sn sınırı, viraj, duruş, zayıf konum, geç gelen, atlama).

## Ek (2026-10-21): açılışta ve her bağlantıda yapılan iş, takılma ölçümü

Sahibin telefonu (Galaxy S25 Ultra) "kasıyor", açılırken de. JS thread'in tutulduğu yerleri bulmak
için ölçüm katmanına bir **takılma sayacı** eklendi (yalnızca geliştirme ve önizleme sürümleri,
yukarıdaki katmanla aynı kapı; üretim paketinde yok) ve açılış işi okunup sayıldı.

- **Takılma sayacı** (`features/dev/measure/stalls.ts`): uygulama açıldıktan sonraki ilk 10 saniyede
  her ~16 ms'de bir kendini çağırtır; 50 ms ya da daha geç çalışırsa thread o kadar tutulmuştur.
  Neyin tuttuğunu bilmez; bu yüzden bilinen işler `timed(ad, iş)` ile adını ve süresini bildirir
  (anahtar eşitleme, yerler, belgeler, anlık görüntü dilimi, `engine.fix`, açılış geri yükleme) ve
  takılma, içinde biten en uzun adlı işin adını alır. Yalnızca sabit iş adları ve milisaniye tutulur:
  konum, ileti, kişi yok; konsola ya da sunucuya hiçbir şey gitmez (`no-console` kuralı yüzünden de
  günlük yerine ölçüm paneli kullanıldı). Panelde "İlk 10 sn'deki takılmalar" ve yerel şifre öz
  testinin süresi görünür. "10 sn yeniden izle" düğmesi aynı sayacı sonradan bir daha başlatır
  (bot koşarken, bir sayfa açılırken kasmayı yakalamak için); `render.map` adı haritanın ve
  üstündeki herkesin son çiziminin süresidir (React Profiler; üretimde React bunu bildirmez).
- **Anlık görüntü (relay'in "locations", "statuses", "profiles" cevapları)** her bağlantıda gelir:
  sunucu her gönderici cihaz ve çember için yalnızca **en yenisini** tutar, yani 5 saniyede bir konum
  gönderen bot birikmiş yüzlerce ileti bırakmaz; boyut, çember sayısı × üye sayısıdır. Maliyet,
  bunların her birinin telefonda açılmasıdır (anahtar paketi kontrolü, imza, çözme).
  - **Daha önce açılmış olanlara hiç dokunulmaz.** Yeniden bağlanma ya da yeniden başlatma aynı
    iletileri geri verir; `decryptMessage` bunları en sonunda "tekrar" diye reddederdi, ama önce
    anahtar paketini (saf JS eğri aritmetiği, Hermes'te yavaş, ADR 0007) ve imzayı denetlerdi. Artık
    tekrar penceresine önce bakılır ve cevap aynı olduğu için hiçbir şey harcanmaz. Reddedilen iletide
    tekrar durumu kasaya yeniden yazılmaz.
  - **Anahtar paketi bir kez denetlenir** (`features/keys/bundle-cache.ts`): aynı paket için sonuç
    aynıdır; anahtar paketin bütün alanlarıdır, bu yüzden değişmiş bir paket asla eskisiyle
    karışmaz; geçersiz paket hatırlanmaz. En çok 256 paket tutulur.
  - **Yeni gelenler dilimler halinde açılır** (5'er ileti, aralarda bir zamanlayıcı turu): onlarca
    ileti haritayı bir anda tutmaz. Dilimler arasında canlı gelen bir konum, anlık görüntü onu
    bilmiyor diye haritadan silinmez; çıkış yapılırsa yarım kalan iş bırakılır.
- **Harita ekranı konumun her saniyelik değişimiyle çizilmez** (`features/location/my-position.ts`):
  harita açıkken kendi konumum saniyede bir gelir; ana ekran (harita, sayfalar, hava çizimi, kısayollar)
  konumun kendisini dinliyordu. Artık yalnızca ilk konumu (bir kez), bulunduğu 1 km'lik kareyi, haritanın
  benden uzaklaşıp uzaklaşmadığını ve hava ızgarasındaki hücreyi izler; hepsi nadiren değişen değerler.
  Kendi pinim ve kartım konumu kendileri dinlemeye devam eder.
- **Bakıldı, sorun bulunmadı:** güvenlik numarası açılışta hesaplanmaz (yalnızca doğrulama ekranında,
  dilimli); geçmiş parçaları açılışta çözülmez (yalnızca geçmiş ekranında); sahibin kendi geçmişi
  çeyrek saat başına bir anahtarda ve sınırlı; tekrar penceresi gönderici başına 64 numara; `useNow`
  ve `timerAt` zamanlayıcıları ekran açıp kapatmayla birikmez; 30 dakikalık, 5 saniyede bir gelen
  konum akışında kasanın anahtar sayısı ve boyutu sabit kalır (testler).

## Ek (2026-10-22, Neden eski?)

PM tasarımı onayladı. Gri pin "23 sa" yaşını söylüyor, nedenini söylemiyor: telefon pil tasarrufunda
mı, konum izni mi kapandı, konum mu alınamıyor, yoksa telefon mu kapalı? Arkadaş bunu bilmeyince
"neden güncellenmiyor" diye soruyor. Bu ek, nedeni telefonun kendisinin (sadece nedeni, konumsuz)
söylemesini ve alıcının "çevrim dışı"yı sessizlikten çıkarmasını getirir.

### Karar

1. **Yeni mesaj türü `state`:** `{ kind: 'state', why: 'saver' | 'permission' | 'nofix' | 'none',
since, ts }`.
   - `saver`: telefon pil tasarrufunda, konum seyrek gelir. `permission`: konum izni kapalı ya da geri
     alınmış. `nofix`: hiçbir konum alınamıyor (konum servisi kapalı, ya da 3 dakikadır hiçbir konum
     gelmedi). `none`: neden bitti (alıcı etiketi bırakır).
   - `since`: nedenin başladığı an (`none` için bittiği an); `ts`: mesajın anı.
   - **Konum yok:** koordinat, doğruluk, hız, pil seviyesi yok; her mesaj gibi 512 bayta dolgulanır
     (en büyük hâli testli). Zarf başka mesajlardan boyutla ayrılamaz.
   - **Neden ayrı tür:** `loc` katı okunur (`strict`); ona alan eklemek, eski uygulamaların her konumu
     reddetmesi demekti. `state` yeni bir tür olarak eklendi ve `look` ile `arrived` gibi **gevşek**
     okunur: ileride bir telefon alan eklerse bu sürüm onu atar, mesajı reddetmez.
   - **"Çevrim dışı" asla gönderilmez.** Gönderemeyen telefon kendi hakkında bir şey söyleyemez; alıcı
     bunu sessizlikten çıkarır (aşağıda).
2. **Telefonda neden nasıl bulunur** (`features/location/state-report.ts`, `state-signals.ts`): önce
   izin, sonra konum servisi, sonra pil tasarrufu, en sonda sessizlik:
   - `permission`: konum izni verilmemiş ya da geri alınmış **ve** bir arkadaşta bu telefonun eski bir
     konumu var (hiç konum göndermemiş telefon için bir şey söylenmez).
   - `nofix`: telefonun konum servisi kapalı (`hasServicesEnabledAsync`, uygulama öne gelince okunur),
     ya da hiçbir ham konum gelmeden 3 dakika geçti (`NOFIX_AFTER_MS`; arkadaşın pini 10. dakikada
     griye döner, neden o zamana kadar orada olsun). Sessizlikte `since` son konumun anıdır.
   - `saver`: `Battery.isLowPowerModeEnabledAsync` ve sistemin olayı (`addLowPowerModeListener`);
     sorgulama yok.
   - Hepsi telefonda kalır; sunucuya ya da başkasına ayrıca söylenmez.
3. **Ne zaman gider:**
   - Neden başlayınca ya da değişince, çemberlerin her birine bir mesaj.
   - Sürdükçe **5 dakikalık kalp atışıyla** (`SEND_RULES.heartbeatMs`) tekrar. Sunucu yalnız en
     sonuncuyu tutar; tekrar, alıcının "yenilenmeyen neden düşer" kuralını (aşağıda) mümkün kılar.
   - Bitince bir `none` ("temizle"); alıcı etiketi bırakır. Sonra sessiz.
   - Bir çembere en çok 45 saniyede bir (`STATE_GAP_MS`); sunucunun sınırı çember ve cihaz başına
     dakikada 3'tür (aşağıda). Açılıp kapanan bir ayar buna yaklaşamaz, son hâli söylenir.
   - **Ulaşmayan mesaj üstel geri çekilmeyle yeniden denenir** (QA-33 N-1): bir çember için 2 saniye,
     sonra 4, 8, 16… en çok 5 dakika; art arda her başarısızlıkta bir basamak uzar, ulaşan bir
     mesajdan sonra yine 2 saniyeden başlar (`retryDelay`). Beklenen süre bağlantı "döndü" olayında
     da atlanmaz: gelip giden bir bağlantı her dönüşte istek yapmazdı, dakikada otuza yakın boş istek
     yapardı (pil ve telsiz). Röleye hiç ulaşılamıyorsa bir turda yalnızca ilk çembere istek gider,
     kalanı aynı bekleyişe girer. Zamanlayıcı bekleyişin sonunda yeniden dener; bağlantı döndü olayı
     da aynı denetimle (bekleyiş bitmişse) yeniden dener.
   - **Sorgulama yoktur:** gönderme döngüsü ayar, izin, servis, pil tasarrufu, çember ve gelen konum
     olaylarıyla başlar; kalp atışı ve sessizlik için yalnızca bir sonraki iş anına kurulan tek bir
     zamanlayıcı vardır (CLAUDE.md "sorgulama yasak").
4. **Hayalet, kaba, paylaşım (gönderenin kuralları):**
   - **Hayalette hiçbir şey gitmez** (dondur ya da gizle): konumun gittiği çemberlerin listesi
     (`engine.audience()`) boşsa neden de gitmez; hayalet başlarken "temizle" de gitmez. Dondurulmuş
     konumun yanındaki etiket 10 dakika sonra kendiliğinden "Çevrim dışı"ya düşer. Bu, dondurulmuş
     hayaletin **kapalı bir telefondan ayırt edilemez** olması demektir: istenen budur.
   - **Kaba hassasiyette (mahalle, şehir) yalnızca neden gider:** mesaj zaten konumsuzdur, her çembere
     aynıdır; kaba çemberin aldığı mesaj tam çemberinkiyle aynı baytları taşır (testli).
   - Paylaşılmayan, süresi dolan, duraklı çembere (kimsenin ödemediği çember, ADR 0024) mesaj gitmez;
     süre dolunca o çemberin **kalp atışı** da durur.
   - **Bunlar sunucunun bilmediği ayarlardır** (uçtan uca şifreleme: hayalet modu ve her çemberin
     paylaşımı yalnız telefonda durur), bu yüzden kural gönderenindedir ve sunucuya taşınmaz. Sunucunun
     kuralları yalnız kendi görebildiğidir: üye olmayan, başka cihazın imzası, geçmiş epoch, duraklı
     çember ve hız sınırı (aşağıda).
5. **Taşıma: kendi yolu** (`POST /v1/states`, canlı bağlantıda `state` mesajı), `look` gibi:
   - Sunucu üye ve çember başına **yalnızca en yeni** `state` zarfını tutar (Redis `state:{çember}`,
     üye başına bir alan); eski numaralı bir zarf yerini almaz. Diğer üyelere canlı `state` olayı
     gider, sonradan bağlanan telefon `GET /v1/states` (ya da `states` mesajı) ile en yenisini alır.
     Üye çemberden çıkınca ya da çıkarılınca `state.gone` olayı gider ve alanı silinir; çember
     bitince hepsi silinir. Konum bir çemberden geri çekilince (hayalet "gizle", paylaşım kapandı,
     süre doldu) o çemberdeki nedeni de silinir: paylaşmayı bıraktığın çember nedenini sonradan
     öğrenmez.
   - Saklama süresi **24 saat** (konumunki kadar, `STATE_TTL_SECONDS`): neden bir konumu açıklar,
     konum sunucuda ondan uzun durmaz. (`look` 30 gün tutulur; neden için gerek yok.)
   - Sunucu reddeder: üye olmayan (`NOT_MEMBER`), başka cihazın imzaladığı zarf (`INVALID`), epoch'u
     geçmiş (`EPOCH`), **duraklı çember** (`PAUSED`: canlı konumuyla aynı yol kuralı) ve hız sınırı
     (`RATE_LIMITED`): cihaz ve çember başına dakikada 3 (telefonun kendi 45 sn kuralından bir fazla:
     bağlantı dönünce giden mesaja yer kalır). zod doğrulama, imzalı istek, "başka kullanıcı
     erişemez" testleri `apps/api/test/integration/state.int-spec.ts`'te.
   - Sunucu şifreli zarfın içini göremez; yalnızca **bir üyenin nedeninin ne zaman değiştiğini** (belirli
     bir anda dolgulu boyutta bir zarf) bilir. Bu, `look` ve `status` için de böyledir ve kabul edilir
     (THREAT_MODEL).
   - Varış, ayrılış ve "Geldim"in yolu (`/v1/place-events`) artık `state` taşımaz.
6. **Alıcı** (`features/location/why.ts`, `receive.ts`): her kişi ve çember için son `state` tutulur
   (kasada, konum gibi; yeniden başlatmada geri gelir, kişi konumunu geri çekince silinir). Eski
   `ts`'li mesaj yer değiştirmez; telefonun saatinin ilerisindeki `ts` "şimdi" sayılır (bir neden
   sonsuza dek yaşamasın).
   - **Tür yola bağlıdır** (Güvendeyim'in QA-32 F-1 kuralı, `Route` ve `kindFitsRoute`; ikinci bir
     düzenek yok): `state` olayından gelen zarf yalnız `state` türü olarak sayılır, `state` türü yalnız
     bu yoldan sayılır. Başka bir yoldan (konum, dürtme, varış, Güvendeyim…) gelen `state` atılır:
     o yolların duraklı çember denetimi ve hız sınırı yoktur, `state` onlardan geçerek bu kuralları
     dolaşamaz. Anahtarı bekleyen `state` yolunu korur ve aynı göndericinin bekleyen konumunu
     itmez (ayrı yerde bekler).
   - **Etiket yalnızca eski konumun yanında** (konum 10 dakikadan eski, `STALE_AFTER_MS`): pin etiketi
     ("23 dk · Pil tasarrufu") ve kişi kartı ("Pil tasarrufu · 14:20'den beri", her neden için) ve
     birlikte duranların penceresi. Birlikte duranların ortak pininde yer yoktur: orada rozet yalnızca
     yaşı yazar, neden pencerede ve sesli okunan etikettedir. Taze konum gelince etiket kendiliğinden
     gider (`none` gecikse de).
   - Metinler: "Pil tasarrufu", "Konum izni kapalı", "Konum alınamıyor" (tr + en).
   - **Çevrim dışı çıkarımı:** konum eski ve **10 dakikadır** (iki kalp atışı kaçtı) o telefondan
     hiçbir mesaj (konum ya da `state`) gelmedi, ve geçerli bir neden yoksa: "Çevrim dışı · 14:20'den
     beri" (son mesajın yerel saati). Türkçede ek, sayının okunuşuna uyar (14:30'dan, 14:40'tan,
     15:03'ten).
   - **Bilinen neden çevrim dışını yener** ama yalnızca yenilendiği sürece: son `state` 10 dakikadan
     eskiyse neden düşer ve çıkarım devreye girer (pil tasarrufunda ölen telefon "pil tasarrufunda"
     kalmasın; PM onayladı). `none` sonrası, konum henüz eskiyse etiket yok: telefon az önce konuştu.
   - Ekran, durum değişikliğini mevcut yoldan alır: `state` olayı → alıcı → `useStates` → harita.
     Zamanla geçen değişiklikler (neden 10 dakikada düşer, çevrim dışı başlar) yaşın yenilendiği
     aynı yarım dakikalık saatten (`useNow`) çizilir; yeni zamanlayıcı yok.
7. **Kendi kartında şeffaflık:** neden bir çembere gönderilirken kullanıcının kendi kartında
   "Arkadaşların seni şöyle görüyor: Pil tasarrufu · 14:20'den beri" satırı görünür (kimler görüyor
   ekranı gibi: arkadaşların senden gördüğü sana saklı değildir). Yalnızca neden gerçekten bir çembere
   söylenmişken (gönderim sürerken) görünür; hayalette, ulaşmayan mesajda ya da neden bitince yoktur.
   Bellekte tutulur (`useMyWhy`).

   **Sessizce gizlenmenin yolu hayalet modudur** (QA-33 N-2): izni ya da telefonun konum servisini
   kapatan biri arkadaşlarına "Konum izni kapalı" ya da "Konum alınamıyor" gittiğini beklemeyebilir.
   Bu yüzden: (a) kendi kartında, neden `permission` ya da `nofix` iken, "Sessizce gizlenmek için
   hayalet modu kullan." satırı kartın altındaki hayalet denetiminin üstünde durur; (b) konum izni
   kartı (izin kapalı ya da geri alınmış) ve yeni konum servisi kartı ("Telefonunun konumu kapalı")
   arkadaşların ne gördüğünü söyler ("Arkadaşların “Konum izni kapalı” görür. Sessizce gizlenmek için
   hayalet modu kullan."; servis kartında “Konum alınamıyor”) ve "Hayalet modunu aç" düğmesi verir.
   Düğme haritadaki hayalet düğmesiyle aynı yoldur (`turnGhostOn`: gizle + aynı bilgi satırı);
   hayaleti kapatmanın onayı (kaç çemberin konum alacağı) olduğu gibi o düğmede kalır. İkisi de
   yalnızca neden gerçekten bir çembere söylenirken çıkar (hiç konum paylaşmamış bir telefon için ya
   da hayaletteyken yoktur); servis kartı izin kartıyla aynı sırayı paylaşır, ikisi aynı anda görünmez.

8. **Eski uygulamalar:** `state` bilinmeyen bir tür. Eski `decryptMessage` onu `MALFORMED` diye reddeder
   (`payloadSchema` bilmiyor); eski uygulama `state` olayını ve `states` istemini zaten bilmez, hiç
   dinlemez. Alıcı her `BarguCryptoError`'ı sessizce `ignored` yapar: etiket yok, çökme yok, günlük
   yok, tekrar penceresi ilerlemez. `loc` değişmedi, yani eski bir uygulama hiçbir konumu kaçırmaz.
   Bu yüzden istemci seviyesi artırılmadı (`CLIENT_LEVEL` 3 kalır). Doğrulama: `82e9bf5` anındaki açma
   kodunun birebir kopyası (`packages/crypto/test/legacy/message-82e9bf5.ts`) `legacy-app.spec.ts`'te
   yeni `state` mesajlarını açmaya çalışır.
9. **Ayarlanacak sayılar** (telefonda ölçülecek, şimdilik tahmin): sessizlikten `nofix` için 3 dakika
   (`NOFIX_AFTER_MS`), bir çembere en az 45 saniye (`STATE_GAP_MS`), ulaşmayan mesaj için 2 saniyeden
   5 dakikaya üstel bekleyiş (`RETRY_BASE_MS`, `RETRY_MAX_MS`), sunucunun dakikada 3'ü, alıcının 10 dakikası (`STALE_AFTER_MS`; zaten gri pin
   eşiği) ve 5 dakikalık kalp atışı. Hepsi tek yerde bir sabittir.
10. **Bilinen sınır:** Android, izni geri alınan uygulamanın sürecini kapatır; "Konum izni kapalı"
    ancak kullanıcı uygulamayı yeniden açınca (izin o zaman okunur) gider. Ondan önce arkadaş "Çevrim
    dışı" görür; bu yanlış değildir, sadece daha az bilgi verir.

11. **Kabul edilen risk (QA-33 N-3):** gerçek bir mesaj yanlış yoldan gelirse (ör. bir `state`, `bump`
    yolundan) çözülür, tekrar penceresindeki yerini harcar ve rota kuralı yüzünden gösterilmez; aynı
    zarf sonradan doğru yoldan gelirse "tekrar" diye reddedilir. Bunu yalnızca kötü niyetli bir sunucu
    yapabilir (iyi niyetli sunucu mesajı hep kendi yolundan iletir) ve sunucu zaten herhangi bir mesajı
    hiç iletmeyebilir; yani bu ona yeni bir güç vermez. Bir `state` için bedeli, bir sonraki kalp
    atışına (en çok 5 dakika) kadar eski bir etikettir. Aynı risk Güvendeyim için ADR 0029'da yazılıdır.

### Sonuçlar

- Gri pin artık "neden"i de söyler; sessizlik "Çevrim dışı · 14:20'den beri" diye adlandırılır.
- Yeni bilgi (THREAT_MODEL): çember üyeleri nedeni (pil tasarrufu, izin kapalı, konum yok) ve başlangıç
  saatini görür; sunucu bir üyenin nedeninin ne zaman değiştiğini görür (belirli bir anda dolgulu
  boyutta şifreli zarf), `look` gibi.
- Testler: şema (her neden, "offline" reddi, konum asla sağ kalmaz), kripto (gidiş-dönüş, aynı
  boyut, eski uygulama atar), sunucu entegrasyonu (canlı olay ve özet, yalnız en yeni, kendi yeri,
  yabancı, sahte imza, eski epoch, hız sınırı, kötü girdi, 401, duraklı çember, çıkınca ve geri
  çekilince silinir, yalnız şifreli metin ve ömür), gönderen (her neden başlar, kalp atışıyla tekrar
  eder, biter; hayalette hiçbir şey; kabada yalnızca neden; paylaşılmayan ve süresi dolan çembere
  hiçbir şey; sessizlik; ulaşmayan mesaj; kendi kartına ne söylendiği), alıcı (her etiket, 10
  dakikada çevrim dışı ve doğru saat metni, neden çevrim dışını yener ve yenilenmezse düşer, taze
  konumla etiket gider, geç gelen eski mesaj, yeniden başlatma, tür yola bağlı), gizlilik (hiçbir
  `state`'te koordinat yok), ekranlar (pin etiketi, kişi kartı, kendi kartı, grup penceresi).

## Ek (2026-10-22): geliştirici araçları ve test ödemesi üretim paketine girmez

Bu ek, 6. maddedeki "yalnızca önizleme paketi" sözünü kodda gerçekten tutan yapıyı yazar (Faz 10,
mağaza hazırlığı). Bir araştırma bunun tam tutulmadığını gösterdi: ölçüm katmanı üretim paketinde
yoktu, ama 50 sahte kişi (sürü), geliştirici satırları, kripto hız testi, bileşen galerisi ve ödeme
taklidi ekranı ile hepsinin metinleri vardı. Sebep: bu parçalar `DEV_TOOLS_ENABLED` diye başka bir
modülden verilen sabitin arkasındaydı ve `import` satırları duruyordu; küçültücü modüller arası sabiti
çözemez, bu yüzden kod pakete girdi. Üretim paketinde ayrıca test satın alma çağrısı ve sunucudaki
yolu vardı (Bargu+ ekranı ve pin süsleri onu sunucunun "test ödemesi açık" demesine bırakıyordu).

### Karar

1. **Derleme anında sabit koşul + dinamik `import`.** `index.ts` araçları tek tek şu biçimde yükler:
   `if (__DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1') { void import(...) }` (test ödemesi için
   `EXPO_PUBLIC_TEST_BILLING`). Expo üretim paketinde `EXPO_PUBLIC_*` değerini koşulun içine yazar,
   Metro ölü dalı atar ve `import()` satırı da gider. Başka hiçbir üretim modülü `features/dev/` altından
   `slots` ve `route` dışında bir şeyi `import` etmez.
2. **Yuvalar.** Ekranlar araçları doğrudan çağırmaz; boş yuvalara bakar (`features/dev/slots.ts`,
   test ödemesi için `features/billing/test-slot.ts`). Araç yüklenince kendini yuvaya koyar:
   "Uygulama" ekranındaki geliştirici satırları, haritadaki sürü ve paneli, `app/_dev/*` ekranları.
   Üretimde yuva boş kalır, hiçbir şey çizilmez. `app/_dev/` altındaki üç dosya expo-router dosya
   yolu istediği için kalır; üç satırdır, yuva boşsa ana sayfaya yönlendirir.
3. **Metinler ortak sözlükte değil.** Geliştirici metinleri `i18n/locales/dev.tr.json` ve
   `dev.en.json` içindedir, araç yüklenince i18next'e eklenir. Bir test `dev` anahtarının `tr.json` ve
   `en.json` içine girmemesini bekler.
4. **Test ödemesi.** `/v1/billing/test/purchase` ve `/simulate` çağrıları
   `features/billing/test-billing.ts` içindedir; yalnız `development` ve `preview` profili
   (`EXPO_PUBLIC_TEST_BILLING=1`) yükler. Üretimde Bargu+ ekranı ve pin süsleri "Yakında Google Play
   üzerinden" der; ne satın alma ne iptal çağrısı yapabilir, sunucu ne derse desin (eski bir test
   sürümünden kalan planın iptal düğmesi de çıkmaz).
5. **Kanıt: `pnpm check:bundle`.** Bayraksız bir `expo export` paketi üretir ve işaretlerin hiçbirinin
   olmadığını; bayraklı (önizleme gibi) paketin hepsini içerdiğini doğrular. İşaretler `dev.*.json`
   metinlerinden otomatik çıkar; ayrıca koddan birkaç dize ve iki test ödemesi yolu vardır. Yerel AAB
   denemesi (`FORMAT=aab scripts/build-android-local.sh`) aynı denetimi paketin içindeki JavaScript
   üzerinde de yapar. Denetim, bu değişikliklerden önceki üretim paketinde 97 işaretten 96'sını buldu
   (iki test ödemesi yolu dahil); sonra 0.

### Sonuçlar

- Yeni bir geliştirici aracı eklerken kural: koda `features/dev/tools.ts` ya da `measure/` altına,
  metni `dev.*.json` içine koy; ekran yuvadan okusun. Üretim koduna `features/dev/` altından statik
  `import` eklenirse `pnpm check:bundle` kırılır.
- Üretimde bilerek kalanlar (kod ya da metin değil): `app/_dev` yol dosyaları, `probe` kancaları,
  `passkeyDiagnostic` yardımcısı.
- Önizleme paketinde davranış aynıdır; araçlar uygulama açılırken bir an sonra yuvaya yerleşir.

## Ek (2026-10-22): yeniden başlatmadan sonra bildirim

**Sorun.** Konum servisi (ön plan servisi, yalnız "kullanırken" izni, arka plan konum izni yok)
telefon yeniden başlayınca ya da uygulama güncellenince kendiliğinden geri gelmez: Android, bu izni
olmayan uygulamanın konum servisini açılış yayınından başlatmasına izin vermez. Arkadaşlar,
kullanıcı Bargu'yu açana kadar "Çevrim dışı" görür.

**Karar.** Paylaşım açıkken telefon başlarsa (`BOOT_COMPLETED`) ya da uygulama güncellenirse
(`MY_PACKAGE_REPLACED`) tek bir yerel bildirim gösterilir: "Paylaşım durdu" / "Telefon yeniden
başladı ya da Bargu güncellendi. Konumunun gitmesi için Bargu'yu aç." (güncelleme de aynı yolu
kapsadığı için gövde ikisini söyler). Dokununca Bargu açılır, paylaşım kendiliğinden sürer.

**Neden yerel (native) bir alıcı.**

- Açılışta JavaScript çalışamaz: uygulama süreci ve JS motoru yoktur. Bu iki yayını yalnız yerel
  kod yakalar. Bu yüzden `apps/mobile/modules/bargu-restart-notice` kuruldu (yalnız Android; iOS'ta
  ve Jest'te `null`, hiçbir şey yapmaz); alıcı modülün kendi manifestosunda tanımlı.
- Alternatif, her konum gidişinde ileri atılan zamanlı bir bildirimdi ("X dakikadır konum gitmedi").
  Kullanıcı yerinde dururken yeni konum seyrek gider (filtre ve 5 dakikalık kalp atışı, bu ADR'nin
  üst bölümleri); servis sağlamken de bildirim yanlışlıkla patlardı. Gerçek olay yeniden başlatma ya
  da güncelleme; onu doğrudan yakalayan alıcı yanlış alarm vermez.

**Ne tutulur.** Yerel tarafta `bargu_restart_notice` adlı SharedPreferences: bir bayrak ("konum
servisi çalışıyor olmalı") ve iki metin (başlık, gövde). Metinler kullanıcının o anki dilinde JS'ten
gelir (`location.service.stoppedTitle` ve `stoppedBody`, tr ve en); yerel kodda sabit kullanıcı
metni yoktur. Konum, kimlik, token tutulmaz; hiçbir şey log'lanmaz.

**Bayrak ne zaman değişir.** `features/location/tracker.ts`, servisi başlatıp durduran tek yer:
`startTracking` servis başlayınca bayrağı ve metinleri yazar (dil değişirse yeniden yazılır) ve
görünen bildirimi geri alır; `stopTracking` en başta bayrağı siler. Hayalet modu, "Tümünü durdur",
çemberin kalmaması, paylaşımın bitmesi, çıkış ve hesap silme bu ikisinden geçer, ayrı kod yok. Alıcı
bayrak açıksa ve bildirim izni varsa (`POST_NOTIFICATIONS`, Android 13+) bildirimi gösterir: mevcut
"privacy" kanalı (yoksa başlıkla oluşturulur), sabit bildirim kimliği, `FLAG_IMMUTABLE` ile başlatıcı
etkinliği açan `PendingIntent`.

**Yalnız Android 11 ve üstü (kodlama oturumu, inceleme).** Android 10 ve öncesinde
`expo-task-manager`'ın açılış alıcısı konum servisini kendiliğinden geri getirebilir; o zaman
"Paylaşım durdu" yanlış olurdu. Android 11'den beri arka planda başlayan konum servisi, arka plan
izni olmadan konum alamaz; bildirim orada doğrudur. Android 7–10'da bildirim çıkmaz: paylaşım ya
kendiliğinden sürer ya da kullanıcı uygulamayı açana kadar durur (telefonda denenmedi). Sürüm sınırı
Jest testinde Kotlin kaynağından denetlenir.

**Kanal.** Bildirim, haftalık "kim görüyor" hatırlatmasıyla aynı "privacy" kanalını kullanır. O
kanalı kapatan kullanıcı bu bildirimi de görmez. Ayrı bir kanal gerekirse sonra eklenir.

**Dokununca paylaşım nasıl sürer.** Kod değişmedi. Bargu açılınca `useLocationSession`
(`use-location.ts`) izin verilmiş, uygulama önde, çember listesi gelmiş ve `locationEngine.active()`
doğruysa `startTracking` çağırır; bu soğuk açılışla aynı yol. Dokunma uygulamayı öne getirdiği için
Android'in "servis yalnız önde başlar" kuralı sağlanır. Çevrimdışı açılışta çember listesi gelene
kadar (ağ dönene kadar) bekler.

**Doğrulama ve sınır.** JS tarafı Jest ile sınandı (bayrak başlatma, durdurma, hayalet ve çıkışta;
metinler o anki dilde; yalnız iki metin gidiyor). Kotlin birim sınanamadı; yerel Docker derlemesi
derliyor. **Telefonda denenmedi:** gerçek yeniden başlatma, güncelleme sonrası bildirim, bildirim izni
kapalıyken davranış ve bazı üreticilerin (Xiaomi, Huawei, OPPO) "otomatik başlat" kısıtı; o
telefonlarda `BOOT_COMPLETED` hiç gelmeyebilir ve bildirim görünmez.
