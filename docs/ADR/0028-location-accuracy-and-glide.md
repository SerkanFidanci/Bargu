# 0028. Konumun doğruluğu: filtre, kayma ve ölçüm katmanı

- Durum: Kabul edildi, 1. adım (PM, 2026-10-18). 3. adım (arka planda canlı mod) ayrıca onaylanacak.
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
  yalnızca zamanlar, doğruluklar, kaynaklar ve sayılar (testli).
- Ben > geliştirici bölümünden "Geliştirici: ölçüm katmanı" ile açılır; kısa Türkçe etiketler.
- Gösterdikleri: bu telefonun örnek aralığı (servis / canlı), gecikme, doğruluk, gönderim aralığı ve
  modu, filtrenin attıkları (eski, bayat, zayıf, sıçrama), kapalı alanda gönderilenler; her arkadaş
  için gecikme, aralık, doğruluk ve geç gelen sayısı; ekranın kare hızı.
- Katman açıkken kare ölçer sürekli çalışır (ADR 0027'nin boştaki sıfır kare kuralı katman açıkken
  geçerli değil).

## Sonraki adımlar

- **2. adım:** proje sahibi ve test oturumu ölçer.
- **3. adım (C2), ayrıca onaylanacak:** arkadaş haritayı açınca göndericinin telefonu arka planda da
  canlı moda geçsin. Önce tek telefonda önizleme denemesi, sonuç ve pil etkisi PM'e. Koşullar (PM
  ek 6): sinyal kimin izlediğini yeni bir yolla açığa çıkarmamalı, hız sınırı olmalı; 15–17 yaş
  kuralları bu ADR'ye eklenecek.

## Sonuçlar

- Virajda pin yoldan çıkmaz: tahmin en fazla 1 saniye ve yalnızca düz yolda.
- Pin zamanda geri gitmez; kötü ve eski konumlar arkadaşlara gitmez; kapalı alanda konum en geç
  45 saniyede bir, doğruluğuyla gider.
- Arkadaşın konumu 5 saniyede bir geliyorsa pin 2 saniyede yeni yere kayar ve bekler (tahmin yerine
  doğruluk). Akıcılık için canlı mod gerekir; arka planda canlı mod 3. adımda.
- Testler: filtre (eski, bayat, zayıf, kapalı alan, sıçrama ve iki onay, tek sapkın, otoyol), motor
  (iki kaynak, kapalı alan, kaba çember aynı, ölçüme koordinat gitmez), alıcı (geç gelen, aynı zaman,
  saat geri), kayma (hedefi geçmez, 1 sn sınırı, viraj, duruş, zayıf konum, geç gelen, atlama).
