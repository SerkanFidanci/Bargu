# 0028. Konumun doğruluğu: filtre, kayma ve ölçüm katmanı

- Durum: Kabul edildi, 1. adım (PM, 2026-10-18). 3. adım (arka planda canlı mod): önizleme denemesi
  için onaylandı (PM, 2026-10-21); ölçümden sonra PM son onayı verirse kalıcı olur, o zamana kadar
  yalnızca önizleme paketinde.
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
