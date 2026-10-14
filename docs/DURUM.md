# Proje Durumu

Her faz sonunda güncellenir: ne bitti, nasıl test edildi, açık riskler, kalan işler. Plan:
[BARGU_PLAN.md](../BARGU_PLAN.md) · Kararlar: [docs/ADR](ADR/README.md)

## Özet

| Faz                              | Durum                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| Faz 0 — Temel & Güvenlik Altyapı | ✅ Onaylandı (açık madde: iPhone dev client)                          |
| Faz 1 — Kripto Çekirdeği         | ✅ Tamamlandı                                                         |
| Faz 2 — Auth & Cihazlar          | ✅ Onaylandı                                                          |
| Faz 3 — Tasarım Sistemi & Harita | ✅ Tamamlandı (telefonda fps ve büyük yazı proje sahibince onaylandı) |
| Faz 4 — Çemberler & Anahtarlar   | ✅ Onaylandı (telefonda denendi: arkadaşlık, çember, davet, bildirim) |
| Faz 5 — Konum Motoru & Relay     | ✅ Onaylandı (telefonda konum görüldü; saha testleri sonraya)         |
| Faz 6 — Harita Deneyimi          | ✅ Onaylandı (telefon ölçümleri sona bırakıldı)                       |
| Faz 7 — Yerler & Bildirimler     | 🚧 Kod bitti, telefonda deneme bekliyor                               |

## Ortamlar

| Ne                      | Nerede                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging API             | `https://api.46-62-162-70.sslip.io` (geçici ücretsiz domain; bkz. ADR 0003)                                                                                                                           |
| Staging deploy          | `main`'e her yeşil CI → GHCR imajı → migration → API + işçi (otomatik, sağlık kontrollü)                                                                                                              |
| Staging e-posta         | Varsayılan iç Mailpit. Proje sahibi sunucuda `bargu-set-mail` ile bir Gmail hesabından gerçek gönderime geçirebilir (ADR 0006); `.test` test hesapları hep Mailpit'te                                 |
| Expo / EAS projesi      | hesap `otenus`, proje `bargu` (`app.config.ts`)                                                                                                                                                       |
| Android sürümleri       | `development` (dev client, Metro'ya bağlanır), `preview` (bağımsız, staging'e bağlanır)                                                                                                               |
| Yerel Android derlemesi | EAS'ın aylık ücretsiz hakkı bitince: `scripts/build-android-local.sh` (Docker, aynı imza anahtarı, ~22 dk), `scripts/publish-apk.sh` → `https://api.46-62-162-70.sslip.io/apk/…` (tahmin edilemez ad) |
| Uygulama kimliği        | `app.bargu` (mağazaya çıkınca değiştirilemez)                                                                                                                                                         |
| Harita dosyaları        | Sunucuda `/srv/bargu-map`, `https://api.46-62-162-70.sslip.io/map/` (Türkiye, 1,6 GB)                                                                                                                 |

## Faz 7 — Yerler & Bildirimler (2026-10-14)

Kararlar: [ADR 0015](ADR/0015-encrypted-places-and-arrivals.md) (şifreli yerler, varışı telefon
algılar), [ADR 0016](ADR/0016-sealed-push-notifications.md) (bildirimler uçtan uca şifreli; ADR
0010'un yerine). Durum: kod bitti, telefonda deneme bekliyor.

Ara iş (aynı gün): Faz 6'nın son sürümü telefonda çöküyordu (hareketli figürlerde UI thread'de
çağrılan sıradan bir fonksiyon; hata ayıklama sürümünde yalnızca uyarı). Düzeltildi (`5c7f170`),
uygulamadaki tüm animasyonlar aynı hata için tarandı. EAS'ın ücretsiz Android hakkı bittiği için
sürüm bu bilgisayarda derlendi ve sunucudan indirildi; proje sahibi kurdu, çökme yok.

### DoD

| Ölçüt                                                    | Durum                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS ile şifrelenen fixture'ı Swift NSE çözer (cross-impl) | ✅ Swift `openPush` TypeScript'in mühürlediği imzalı yer bildirimini ve sunucu haberini açar, başka alıcıya / bilinmeyen gönderene / bozuk gövdeye hayır der (macOS CI, CryptoKit). Eklenti kaynakları iOS SDK'sına karşı derleniyor. iPhone'da deneme Apple hesabıyla |
| Bildirim içeriği APNs/FCM'de düz görünmez                | ✅ FCM'e giden istek yalnızca şifreli kutu (`data.bargu`, metin yok); APNs'e içeriksiz yer tutucu + kutu (yerel HTTP/2 sunucusuyla test); kuyrukta ad, yer adı, olay türü yok (entegrasyon testi)                                                                      |

### Yapılanlar

- **Yerler**: çember ekranında "Yerler" ve "Yer ekle". Ekleme ekranında harita ve ortada daire:
  haritayı kaydırmak yeri taşır, dairenin kenarındaki tutamak 100 / 250 / 500 m'ye titreşimle
  oturur; ad ve simge. Yer telefonda şifrelenir; sunucu adını, konumunu, büyüklüğünü göremez.
  Ana haritada yerler soluk daire ve simgeyle görünür. Çember başına en çok 30 yer.
- **Varış ve ayrılış**: telefon kendi konumundan algılar (işletim sisteminin geofence'i yerine;
  "her zaman" izni gerekmez). Kenarda gidip gelmek "vardı-ayrıldı" yapmaz; zaten oradayken
  "vardı" denmez. Yalnızca o çembere **tam konum** paylaşırken gider; hayalet modda, paylaşım
  kapalıyken ya da mahalle/şehir hassasiyetinde gitmez.
- **Şifreli bildirimler**: her bildirim tek cihaza mühürlü; üyeden geleni (varış, dürtme) onun
  cihazı imzalar, sunucu "Ali eve vardı" uyduramaz. Google ve Apple içerik görmez; metni telefon
  kendi dilinde yazar ("🏠 Ev — Ali vardı", "Ali seni dürttü 👋"). Arkadaşlık ve çember haberleri
  de artık şifreli. Uygulama kapalıyken de çalışır (Android arka plan görevi). Yeni kanal:
  "Varışlar ve ayrılışlar".
- **Sessize alma**: kişiye basılı tut → "Bildirimler" → o kişinin varışları / dürtmeleri. Yer
  ekranında "Bu yerdeki varış ve ayrılışlar". Yalnızca telefonda; sunucu bilmez.
- **iPhone**: bildirim eklentisi (Swift) yazıldı ve Xcode projesine ekleniyor (Linux'ta üretilip
  kontrol edildi); APNs gönderimi hazır. Apple hesabı gelince açılır.
- **Test arkadaşı**: `places` (açabildiği yerler), `arrive` / `arrive:<ad>` (yere varır, sana
  şifreli bildirim gider), `leave` (ayrılır); dürtmeleri artık şifreli bildirimli.

### Test sonuçları

| Paket              | Test | Not                                                                                                   |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------- |
| `packages/crypto`  | 143  | + imzalı bildirim (alıcıya bağlı, sunucu yalnızca haber), saklanan yer; %100 kapsam                   |
| `packages/schemas` | 80   | + yer, bildirim gövdesi, cihaz bildirimleri                                                           |
| Swift (CryptoKit)  | CI   | + imzalı bildirim ve sunucu haberi fixture'ları, katı gövde                                           |
| API entegrasyon    | 128  | + yerler (sürüm, epoch, sınır, dışarıdaki göremez, veritabanında düz veri yok), şifreli bildirim yolu |
| API birim          | 81   | + FCM data-only, APNs (HTTP/2), sunucu haberinin mühürlenmesi                                         |
| Mobil              | 255  | + yer modeli, yer saklama/eşitleme/yeniden mühürleme, varış algılama, bildirim metni, sessize alma    |

### Açık riskler

1. **iPhone denenmedi** (Apple hesabı yok): eklenti derleniyor ve kriptosu CryptoKit'le uyumlu ama
   gerçek cihazda bildirim akışı Apple hesabıyla denenecek.
2. Android'de "zorla durdur" yapılan ya da üreticinin sert pil tasarrufu uyguladığı telefonlarda
   data-only bildirim uygulamayı uyandıramaz; o zaman bildirim gelmez (uygulama açılınca görülür).
3. iOS'ta sessize alınan bildirimi tamamen gizlemek Apple'ın özel iznini ister; o zamana kadar
   yerine içeriksiz yer tutucu görünür.
4. Eski uygulama sürümleri yeni (şifreli) bildirimleri gösteremez: sunucu ve uygulama birlikte
   güncellendi; herkes yeni sürüme geçmeli.
5. Yeni üye, epoch değiştikten sonra çevrimiçi bir üye yerleri yeniden mühürleyene kadar yerleri
   göremez.
6. Varış algılama konum servisine bağlı: paylaşım açıkken çalışır; telefon uzun süre konum
   vermezse (pil tasarrufu) varış gecikebilir.

## Faz 6 — Harita Deneyimi (2026-10-14)

Kararlar: [ADR 0012](ADR/0012-four-digit-login-code.md) (4 haneli kod),
[ADR 0013](ADR/0013-weather-without-location.md) (hava durumu),
[ADR 0014](ADR/0014-encrypted-profile-photos.md) (profil fotoğrafı). Android build: `eb58aade`
(`3e2663d`, çizilmiş hareket animasyonları; önceki `9f180547`, `db1a9fa1`).

Proje sahibi fazı 2026-10-14'te onayladı; telefondaki ölçümler (50 avatarla 60 fps, düşük seviye
Android) en sona bırakıldı. Yeni sürümü kendisi deneyecek.

### DoD

| Ölçüt                        | Durum                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50 avatarla 60 fps           | Sona bırakıldı. Ölçüm aracı hazır ("Ben" → Geliştirici: haritada 50 kişi testi → "Kare hızını ölç"); telefonda ölçülecek. Animasyonların hepsi UI thread'de |
| Düşük seviye Android cihazda | Sona bırakıldı: proje sahibinin cihazlarıyla                                                                                                                |

### Yapılanlar (plan)

- **Akıcı kayma**: avatarlar iki konum arasında hız ve yönle kayar (en çok 10 sn ileri tahmin),
  duran yerine yumuşakça oturur, uzak sıçramalar animasyonsuz. Hareket UI thread'de.
- **Ortam durumları**: hızla uzayan iz, şarjda şimşek, pil %15 altında kırmızı nabız, eski konum
  gri ve yaşıyla. Harita kuzey yukarı sabit (pusula yok).
- **Hareket türü** (proje sahibinin isteği, herkes aynı görür): yürürken ve koşarken adım adım
  zıplama, ağırlığın sağa sola geçmesi, öne eğilme, gölge ve arkada kalan ayak izleri; bisiklette
  yalpalama, araçta hafif titreşim + uzun iz; 30 dakikadır aynı yerdeyse yavaş yayılan halka.
  Köşede emoji yerine kendi çizdiğimiz hareketli figür: kolları ve bacakları sallanan yürüyen ve
  koşan adam, pedal çeviren bisikletli, tekerlekleri dönüp egzozu tüten araba, yelkovanı dönen
  saat. Ne zamandan beri aynı yerde olduğunu gönderen telefon söyler (yalnızca tam konumda).
- **Kişi kartı**: avatara dokununca avatar haritadan karta uçar; ne zaman, nerede (yer adı
  telefonda haritanın kendi etiketlerinden, koordinat hiçbir yere gitmez), ne kadar uzakta, pil,
  durum. Aşağı kaydırınca / haritaya dokununca / geri tuşuyla kapanır.
- **Radyal menü**: avatara basılı tut, parmağını kaydırıp bırak: Dürt · Yol tarifi · Profil ·
  Bildirimler (kişiye özel bildirimler Faz 7'de).
- **Dürt**: şifreli `bump` mesajı, sunucu saklamaz, dakikada 10; karşı tarafta titreşim, avatarı
  zıplar, kim olduğu yazar; uygulaması kapalıysa içeriksiz bildirim ("Biri seni dürttü 👋").
- **Buluşma**: ikisi de tam konum paylaşırken 50 m'ye girince bir kez: titreşim, "X ile
  buluştunuz! 🎉" ve avatar çevresinde iki renkli parçacık patlaması (Skia).
- **Durum**: emoji + birkaç kelime, 1/4/24 saat; çember başına şifreli, süresi dolunca sunucudan
  kendiliğinden silinir. Haritada avatarın üstünde emoji, kartta metin.
- **Sıvı kümeleme**: ekranda üst üste binen kişiler tek kabarcıkta sıvı gibi birleşir (Skia
  "goo"), sayı ve avatarlarla; dokununca yakınlaşır.

### Yapılanlar (proje sahibinin ek istekleri)

- **4 haneli giriş kodu** ve yeni kod ekranı: odakta yalnızca ışık, renk sadece sonuçta; son
  hanede kutular yörüngeye kıvrılıp dönerek tek yeşil kutuya iner (yanlışsa çözülür, kırmızı,
  sallanır); "Yapıştır" düğmesi (pano yalnızca dokununca okunur). Deneme sınırları sıkılaştırıldı.
- **Hava durumu**: bulunduğun yerdeki havaya göre haritada yağmur, çisenti, kar, sis, bulut,
  fırtınada şimşek, açık günde güneş ışıltısı, gece yıldızlar; "☀️ 24°" göstergesi. Konum hiçbir
  yere gitmez: herkes aynı Türkiye ızgarasını indirir, telefon kendi hücresini bulur.
- **Profil fotoğrafı**: isteğe bağlı; telefonda şifrelenir, yalnızca çemberler açabilir, sunucu
  göremez. "Fotoğrafı kaldır" emojiye döner.
- **Test arkadaşı**: `poke`, `status:☕ kahve`, `nostatus`, `walk` / `run` / `bike` / `drive`,
  `meet` (yanına gelir, buluşma efekti), `still` (30 dk sonra "yerleşmiş").

### Test sonuçları

| Paket              | Test | Not                                                                                        |
| ------------------ | ---- | ------------------------------------------------------------------------------------------ |
| `packages/crypto`  | 132  | + profil fotoğrafı şifreleme, `since` bulanıklaştırmada düşer                              |
| `packages/schemas` | 72   | 4 haneli kod                                                                               |
| API entegrasyon    | 123  | + dürt, durum, hava durumu, şifreli fotoğraf (çember dışı göremez), 4 haneli kod sınırları |
| API birim          | 77   | + hava ızgarası                                                                            |
| Mobil              | 232  | + kayma, kümeleme, buluşma, menü geometrisi, yer adı, hava, durum, hareket türü, çizimler  |

### Açık riskler

1. 50 avatarla 60 fps ve düşük seviye cihaz testi sona bırakıldı (araç hazır).
2. **Open-Meteo ücretsiz katmanı ticari olmayan kullanım içindir**: yayından önce ticari plan ya
   da kendi Open-Meteo sunucumuz gerekir.
3. 4 haneli kod: hedefli, sabırlı bir saldırgan için yılda ~%10 tahmin riski (ADR 0012); 6 hane
   aynı sınırlarla ~%0,1.
4. Konum mesajına `since` eklendi: eski uygulama sürümleri yeni konumları açamaz; herkes yeni
   sürüme geçmeli (test botu güncellendi).
5. Tahminle kayma, duran birini en çok birkaç saniye ileride gösterip geri çekebilir.
6. Yer adı haritanın çizdiği etiketlere bağlı: çok uzaktan bakarken boş kalabilir.
7. Dürt bildirimi Google üzerinden gider (içeriksiz).
8. Skia ve fotoğraf paketleri uygulama boyutunu büyüttü.
9. iOS denenmedi (Apple hesabı).

## Faz 5 — Konum Motoru & Relay (2026-10-14)

Kararlar: [ADR 0011](ADR/0011-location-engine-and-relay.md). Android build: `54141ab5` (`502219b`;
sonraki küçük düzeltmeler `99be7b5` bir sonraki build'de).

Telefonda (2026-10-14, mobil veri): kendi konumun ve test arkadaşının şifreli konumu haritada
göründü, "2 kişi seni görüyor" doğru. Proje sahibi fazı onayladı; saha testleri sonraya bırakıldı
(aşağıda "Sonraya kalan testler").

### DoD

| Ölçüt                                                | Durum                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log/DB/Redis'te düz koordinat yok (otomatik test)    | ✅ API testi gerçek şifreli konum gönderip Redis'i, tüm tabloları, iş kuyruğunu ve ayrıntılı log'u tarıyor                                                                                |
| Kilitli ekranda arka planda gönderim                 | Android: hazır (görünür bildirimli konum servisi, arka plan izni yok), telefonda denenecek. iOS: Apple hesabı bekliyor                                                                    |
| Gönderen → alıcı ekranı p95 < 500 ms                 | Sunucu yolu p95 **17 ms** (canlı bağlantı), 25 ms (arka plan / HTTP); ağ gidiş-dönüş p95 244 ms (şirket ağından); tahmini uçtan uca p95 ≈ 270 ms. İki gerçek telefonla doğrulama bekliyor |
| Uçak modu, Wi-Fi ↔ hücresel, 10 dk arka plan sonrası | Otomatik: yeniden bağlanma + kaçırılanları alma, çevrimdışıyken yalnız en yeni konumu bekletme, açılışta son konumlar ✅. Elle: telefonda denenecek                                       |
| 8 saatlik saha testi pil raporu                      | Proje sahibi telefonda yapacak                                                                                                                                                            |

### Yapılanlar

- **Şifreli konum aktarıcısı (sunucu)**: telefon her çember için ayrı şifrelenmiş ve imzalı zarf
  yollar; sunucu yalnızca imzayı, üyeliği ve epoch'u denetler, her üyenin en son zarfını 24 saat
  tutar ve diğer üyelere anında iletir. Konumu okuyamaz. Canlı bağlantıdan (uygulama açıkken) ya da
  HTTP'den (ekran kilitliyken) gelir; açılışta herkesin son konumu bir kerede gelir.
- **Konum motoru (telefon)**: tek motor, uygulama açıkken de ekran kilitliyken de aynı. Kural:
  hareket ederken 5 sn ve 10 m, dururken 5 dk'da bir "buradayım", biri haritanı açmışsa saniyede
  bir (2 dk boyunca). Pil seviyesi ve şarj durumu da şifreli zarfın içinde. İnternet yoksa yalnızca
  en yeni konum bekler, bağlantı gelince gider.
- **Kilitli ekran (Android)**: yalnızca "uygulamayı kullanırken" izni. Paylaşım açıkken bildirim
  çubuğunda "Konumun paylaşılıyor" görünür; uygulama kaydırılıp kapatılsa da sürer. GPS yalnızca
  bir çembere tam konum veriliyorsa açık; mahalle/şehirde Wi-Fi ve baz istasyonu yeter.
- **Harita**: arkadaşlar avatarlarıyla, kendi avatarın kendi yerinde; harita açılışta sana döner.
  Bir kişi birkaç çemberdeyse en ayrıntılı konumu görünür. 10 dakikadan eski konum gri ve yaşıyla
  ("12 dk", "3 sa"). Son konumlar telefonda şifreli saklanır, uygulama yeniden açılınca hemen
  görünür; sunucuda artık olmayan konum (24 saat dolan, geri çekilen, çıkan üye) silinir.
- **Paylaşım ayarları (çember ekranında)**: aç/kapa, ne kadar ayrıntılı (tam / mahalle ~1 km /
  şehir ~10 km, bulanıklaştırma şifrelemeden önce telefonda), ne kadar süre (süresiz / 1 saat / bu
  akşama kadar). Ayarlar yalnızca telefonda; sunucu öğrenmez. Kapatınca, süre dolunca konum
  sunucudan anında geri çekilir; daha kaba ayar, eski ince konumun yerine hemen geçer.
- **Hayalet modu ("Ben" panelinde)**: dondur (son konumun kalır, yenisi gitmez) veya gizle
  (herkesin haritasından kalkarsın). Üstteki "Seni kim görüyor" hapı hayalet modunu söyler.
- **Bağlantı ve izin**: konum izni yoksa haritada neden gerektiğini anlatan kart (reddedildiyse
  Ayarlar'a götürür); bağlantı 2 sn'den uzun koparsa "Bağlanıyor…" satırı. Yenileme butonu yok.
- **Test arkadaşı (staging)**: `@deneme.arkadas` artık şifreli konumunu yolluyor (senin 400 m
  doğunda yürüyerek bir tur atıyor) ve seninkini açıyor; log'una yalnızca doğruluk, pil ve yaş
  yazar, koordinat yazmaz. Komutlar: `walk`, `still`, `hide`. Anahtarları dosyada, yeniden
  başlarsa "yeni telefon" sayılmaz.

### Test sonuçları

| Paket           | Test | Not                                                                                                        |
| --------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| API entegrasyon | +5   | aktarıcı: canlı ve HTTP iletim, düz koordinat taraması, en yeni kazanır, retler, geri çekme, izleme sınırı |
| Mobil           | 198  | +40: gönderme kuralları, şifreleme/çözme, tekrar koruması, bekleyen anahtar, motor, olay akışı             |
| CI (GitHub)     | ✅   | `502219b`, `99be7b5`                                                                                       |

Gecikme ölçümü (2026-10-14, staging): iki test hesabı arkadaş olup anahtar değişti, biri 200
şifreli konumu canlı bağlantıdan, 40'ını HTTP'den yolladı; diğeri aldı ve çözdü. Hiçbiri kaybolmadı.

| Yol                                 | p50    | p95       | p99   |
| ----------------------------------- | ------ | --------- | ----- |
| Canlı bağlantı → alıcıda çözülmüş   | 13 ms  | **17 ms** | 22 ms |
| HTTP (arka plan) → alıcıda çözülmüş | 21 ms  | 25 ms     | 31 ms |
| Ağ gidiş-dönüş, bilgisayar → sunucu | 112 ms | 244 ms    | —     |

Telefonda doğrulama + çözme 1,19 ms (Faz 1 cihaz ölçümü). Bilgisayardan doğrudan uçtan uca ölçüm
şirket ağının TLS araya girmesi yüzünden yapılamadı (doğrulama kapatılmadı); iki telefonla
yapılacak.

### Açık riskler

1. Pil: tam konum paylaşılan çember varsa GPS 5 sn'de bir açık; Android konum servisini arka
   planda yeniden ayarlamaya izin vermediği için duran telefonda da açık kalır. 8 saatlik test
   belirleyecek; kötü çıkarsa hareket algılama (Transistorsoft, ücretli lisans, ya da kendi modülümüz).
2. Bazı Android üreticileri (Xiaomi, Huawei, bazı Samsung ayarları) arka plandaki servisi
   kapatabilir; gerekirse "pil optimizasyonundan çıkar" yönlendirmesi eklenecek.
3. Arka plandaki telefona "biri haritana baktı" isteği ulaşmaz (canlı bağlantı kapalı); hareket
   halinde zaten 5 sn'de bir gönderiyor. Sessiz push ile uyandırma Faz 7'de değerlendirilecek.
4. Avatarlar iki ölçüm arasında akıcı kaymıyor, yeni konuma geçiyor (Faz 6, harita deneyimi).
5. Uçtan uca p95 iki gerçek telefonla ölçülmedi (tek telefon); şimdilik sunucu ölçümü + ağ.
6. Sunucu kimin kimin haritasını ne zaman açtığını ("izle") ve paylaşımın ne zaman durduğunu görür
   (THREAT_MODEL); içerik ve sebep görünmez.
7. iOS derlenemiyor (Apple hesabı).

### Sonraya kalan testler (proje sahibiyle)

| Test                                                               | Ne zaman              |
| ------------------------------------------------------------------ | --------------------- |
| Ekran kilitliyken 10 dk sonra konum gidiyor mu                     | Uygun ilk denemede    |
| Uçak modu aç/kapa, Wi-Fi ↔ mobil veri sonrası kendiliğinden güncel | Uygun ilk denemede    |
| 8 saatlik pil raporu (marka ve model ile)                          | Faz 10 öncesi         |
| İki gerçek telefonla uçtan uca p95                                 | İkinci telefon olunca |
| iOS kilitli ekran                                                  | Apple hesabı gelince  |

## Faz 4 — Çemberler & Anahtar Dağıtımı (2026-10-14)

Kararlar: [ADR 0009](ADR/0009-circles-keys-and-events.md)

### DoD

| Ölçüt                                       | Durum                                                               |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Çıkarılan üye yeni epoch'u çözemez          | ✅ Gerçek kriptoyla API testi; staging'de de denendi                |
| Davet linki tekrar kullanılamaz             | ✅ Aynı anda iki kişi denese bile tek kişi girer (test + staging)   |
| Yetkisiz kullanıcı çember verisine erişemez | ✅ HTTP'den ve doğrudan veritabanından denendi (RLS), staging'de de |
| Kabul etmeden hiçbir şey paylaşılmaz        | ✅ Davetliye anahtar gitmez; davetli diğer üyeleri bile görmez      |

### Yapılanlar

- **Arkadaş ve çember**: kullanıcı adıyla istek (önce kişinin kartı görünür), QR kodumu göster
  (okutan anında arkadaş olur; ekran görüntüsü engelli, 24 saat ve tek kullanımlık), QR tara, davet
  linki paylaş. Aile/arkadaş grubu kur, kişi davet et, adını değiştir, üye çıkar, ayrıl.
  Arkadaşlıktan çıkınca iki taraf için de biter; yeniden arkadaş olmak yeni onay ister.
- **Uçtan uca anahtarlar**: her çemberde her epoch için telefon kendi anahtarını üretir, yalnızca
  güvendiği aktif üyelere şifreli gönderir; sunucu içeriği göremez. Üyelik veya cihaz değişince ve
  24 saatte bir yeni epoch. Anahtarlar telefonda şifreli kasada (MMKV, AES-256), çıkışta silinir.
- **Güvenlik numarası**: 60 hane + QR; yan yana gelip karşıdakinin kodunu okutunca "Doğrulandı".
  Hesap ekranı dondurmadan, kare kare yapılıyor (Faz 1'deki 373 ms donma riski kapandı).
- **Anahtar değişince uyarı**: bir arkadaşın anahtarı değişirse (yeni telefon ya da araya giren
  biri) ona konum gitmez ve ondan anahtar alınmaz; kullanıcı QR ile doğrular ya da onaylar.
- **Canlı güncelleme**: yenileme butonu yok. Telefon tek bir şifreli WebSocket bağlantısı tutar;
  istek gelmesi, kabul, çıkarma, yeni anahtar anında ekrana düşer. Bağlantı koparsa kaçırdıklarını
  sırayla alır; uygulama arka plana gidince kapanır, öne gelince devam eder.
- **Kolay davet** (proje sahibinin denemesinden sonra): çember kurarken arkadaşlar listeden tek
  dokunuşla seçilir ("Oluştur ve davet et"); sonradan çember ekranındaki "Kişi ekle" ile aynı liste,
  ayrıca kullanıcı adı / QR / link. Tek kişilik yeni çemberde "Arkadaşlarını davet et" kartı.
- **Uygulama içi bildirim**: davet geldiğinde, arkadaşlık kabul edildiğinde, biri çembere katıldığında
  veya birinin anahtarı değiştiğinde üstten kayan bildirim + titreşim (dokununca çember açılır);
  uygulama kapalıyken olanlar bir sonraki açılışta bir kez. Alt menüde bekleyen istek rozeti.
- **Sistem bildirimleri** (proje sahibinin isteğiyle Faz 7'den erken, [ADR 0010](ADR/0010-early-push-notifications.md)):
  izin giriş biter bitmez istenir; uygulama kapalıyken arkadaşlık isteği, kabul, çember daveti ve
  katılım bildirimi gelir. Metin içeriksiz (kim/hangi çember yazmaz), push token sunucuda şifreli,
  Google'a aracısız (FCM HTTP v1). Firebase anahtarı `bargu-set-push` ile sunucuya, uygulama
  ayarı EAS'a yüklenince açılır.
- **Görünüm**: çemberler paneli (istekler, arkadaşlar, gruplar, şifreleme rozetleri), çember ekranı,
  davet ekranı, QR kartı (hale animasyonu), tarayıcı (tarama çizgisi), güvenlik numarası (haneler
  sırayla zıplar), kabul ve doğrulamada konfeti + titreşim ([MOTION.md](MOTION.md)).

### Bağımsız güvenlik incelemesi (yayından önce)

Sunucu kodu yayına çıkmadan ayrı bir inceleyiciyle saldırgan gözüyle tarandı; bulguların hepsi
yayından önce kapatıldı ve her biri testle korunuyor:

| Bulgu                                                                             | Önem   | Durum                                                        |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Arkadaşlıktan çıkan, karşı taraf onaylamadan arkadaşlığı geri açabiliyordu        | Yüksek | ✅ Bitiş iki taraf için; yeniden istek yeni onay ister       |
| Veritabanında elle sahte arkadaşlık / epoch geri alma / üyelik sorgulama mümkündü | Orta   | ✅ Kurallar veritabanında kapatıldı                          |
| Canlı bağlantı, oturum iptal edilse de açık kalabiliyordu                         | Orta   | ✅ Anahtar süresi kadar yaşar; iptalde hemen kapanır         |
| Eski sahip geri dönünce sahiplik geri geliyordu                                   | Düşük  | ✅ Üye olarak döner                                          |
| Sahipsiz grup kalabiliyordu                                                       | Düşük  | ✅ En eski üye sahip olur, kimse yoksa davetler geri çekilir |
| Arkadaşlık bittikten önce yapılmış QR hâlâ çalışıyordu                            | Düşük  | ✅ Geçersiz                                                  |
| 50 kişi sınırı aynı anda katılımlarda aşılabiliyordu                              | Düşük  | ✅ Çember başına kilit                                       |
| Her girişte gereksiz anahtar yenileme; çıkışta yenileme yoktu                     | Düşük  | ✅ Yalnızca yeni cihaz, çıkış ve iptalde                     |
| Cihaz başına bağlantı ve `resume` sınırı yoktu                                    | Düşük  | ✅ Telefon başına tek bağlantı, sınırlı `resume`             |
| Davetli kabul etmeden tüm üyeleri görüyordu                                       | Bilgi  | ✅ Yalnızca daveti göndereni görür                           |

### Test sonuçları

| Paket              | Test | Not                                                                                   |
| ------------------ | ---- | ------------------------------------------------------------------------------------- |
| `packages/crypto`  | 130  | + tarama karşılaştırması                                                              |
| `packages/schemas` | 72   | çember, davet, anahtar, olay şemaları                                                 |
| API entegrasyon    | 109  | +37: çemberler, arkadaşlık, davet linkleri, anahtarlar (gerçek kripto), canlı olaylar |
| API birim + HTTP   | 65   |                                                                                       |
| Mobil              | 158  | +33: anahtar kasası kuralları, olay akışı, çember senkronu, davet linki, QR, panel    |

Staging'de uçtan uca (nginx dahil, gerçek WebSocket): üç hesap, imzalı canlı bağlantı, başka
cihazın imzasının reddi, istek → kabul → olayın anında gelmesi, anahtarın uçtan uca açılması,
davetlinin yalnızca daveti göndereni görmesi, çıkarılanın hiçbir şey görmemesi ve anahtar
alamaması, tek kullanımlık link, arkadaşlıktan çıkınca yeniden onay — 25/25 doğru.

Telefonda (2026-10-14): uygulama kapalıyken test arkadaşının arkadaşlık isteği sistem bildirimi
olarak geldi, 17 sn sonra kabul edildi, iki taraf anahtarlarını uçtan uca açtı. Android build: `e57490c0` (sistem bildirimleri, Firebase ile; önceki `4a2e4641`, `8fb45363`). Tek telefonla deneme için staging'de bir test arkadaşı (`@deneme.arkadas`)
çalıştırıldı: istekleri kabul eder, anahtarını gönderir, gelen anahtarı açar (kontrol hesabıyla
doğrulandı).

### Açık riskler

1. Davet linki `bargu://i/…`: bazı mesajlaşma uygulamaları bunu tıklanabilir göstermez. Gerçek
   alan adı gelince https link (App Links / Universal Links) olacak.
2. Uygulamadan çıkış yapılmışken açılan davet linki, giriş sonrası kendiliğinden açılmaz (linke
   yeniden dokunmak gerekir).
3. Arkadaşın uygulaması hiç açılmazsa şifreleme "hazırlanıyor" kalır; uygulamayı açınca kendiliğinden
   tamamlanır. Kapalı uygulamayı uyandıran bildirim Faz 7'de.
4. Canlı bağlantı yalnızca uygulama açıkken; arka planda konum Faz 5'te HTTP ile gönderiliyor.
5. Tek sunucu: olay yayını tek süreçte (Faz 10'da Redis adaptörü).
6. Kullanıcı kimlikleri (UUIDv7) hesabın açılış zamanını kabaca ele verir; yalnızca aynı
   çemberdekiler görür (THREAT_MODEL).
7. iOS derlenemiyor (Apple hesabı); iPhone denemesi bekliyor.

## Faz 3 — Tasarım Sistemi & Harita İskeleti (2026-10-13)

Kararlar: [ADR 0008](ADR/0008-design-system-and-map.md) · Kurallar: [MOTION.md](MOTION.md)

### DoD

| Madde                        | Durum | Kanıt                                                                                                       |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| Tüm geçişler 60 fps          | ⏳    | Uygulamadaki kare hızı ölçeri (Ben → bileşen galerisi) ile telefonda ölçülecek                              |
| Hareketi azalt çalışır       | ⏳    | Kodda her animasyon sistem ayarına bağlı (yaylar anında biter, kaymalar solmaya döner); telefonda denenecek |
| iPhone SE + büyük yazı testi | ⏳    | iPhone yok: Android'de en büyük yazı boyutuyla denenecek; yazı ölçekleri sınırlı, ekranlar kayıyor          |

### Yapılanlar

- **Tasarım sistemi**: renk (açık/koyu, WCAG AA testle zorunlu), yazı (Bricolage Grotesque + Inter,
  gömülü), 4'lük boşluk, köşe, gölge ve hareket değişkenleri; 15 bileşen; geliştirici galerisi ve
  kare hızı ölçer. ESLint, hareket değişkenleri dışında animasyon sayısını ve JS iş parçacığı
  animasyonunu reddediyor.
- **Harita**: MapLibre 11.5; Türkiye haritası, etiket yazı tipleri ve simgeler **kendi
  sunucumuzda** (tek PMTiles dosyası, nginx). Türkçe etiketli açık/koyu stil. Başka adrese istek
  gitmediği testle zorunlu.
- **Ekranlar**: 3 tanıtım kartı (çizim animasyonlu) → e-posta → 8 haneli kod (e-postadan otomatik
  doldurma, 60 sn sonra yeniden gönder) → kullanıcı adı (yazarken müsaitlik) → ad + renk + emoji
  (harita işaretçisi önizlemesiyle) → harita. Ana ekran: "Seni kimse görmüyor" balonu, alt menü
  (Çemberler · Ekle · Ben), paneller. Profil düzenleme, çıkış.
- **Passkey**: e-posta ekranında "Passkey ile giriş yap", Ben panelinde "Passkey ekle". Sunucuda
  Android imza parmak izi ve uygulama kaynağı tanımlı (`assetlinks.json` yayında).
- **Sunucu**: profil güncelleme ve kullanıcı adı müsaitliği uçları (RLS'i aşan tek boolean
  fonksiyon, hesap başına hız sınırı); migration 0002.
- **Güvenlik**: görünmez / yön değiştiren karakterler (Trojan Source) CI'da ve commit'te
  reddediliyor.
- **Hareket ve görünüm** (proje sahibinin isteğiyle zenginleştirildi, [MOTION.md](MOTION.md)):
  yaylanan butonlar ve ışık süzülmesi, sırayla gelen ekran öğeleri, zıplayan kod kutuları ve yanlış
  kodda titreme + hata titreşimi, canlı ✓/✕ kullanıcı adı işareti, büyüyen seçimler, paralaks
  tanıtım kartları, üstten inen bildirimler, + → × dönen alt menü düğmesi, kayıt sonunda konfeti.
  Hepsi UI iş parçacığında ve "hareketi azalt"a uyuyor.
- **Harita görünümü**: gündüz açık, gece (20:00–07:00) koyu; Ben panelinden Otomatik / Açık / Koyu.
  Koyu tema gece mavisi (ilk sürüm çok karanlık bulundu). OpenStreetMap yazısı açılışta görünür,
  5 sn sonra kaybolur; lisans Ben → Harita verisi'nde.
- **Marka**: menekşe üzerinde beyaz iğne + mercan nokta simgesi ve marka renginde açılış ekranı
  (geçici logo, `scripts/build-icons.mjs`).
- **Passkey düzeltmesi**: telefondaki ilk denemede passkey oluşturulamadı. Sunucu, Android'in reddettiği
  iki şey gönderiyordu: boş görünen ad ve tanınmayan bir algoritma (ML-DSA). İkisi düzeltildi
  ve testle sabitlendi; sunucu artık reddetme nedenini (kişisel veri olmadan) kaydediyor,
  önizleme sürümü hata kodunu mesajda gösteriyor.

### Test sonuçları

| Paket              | Test | Not                                                                                                         |
| ------------------ | ---- | ----------------------------------------------------------------------------------------------------------- |
| `packages/schemas` | 67   | kullanıcı adı, görünen ad (görünmez karakter), avatar                                                       |
| API entegrasyon    | 72   | +15 profil: yarış, yasak ad, imzasız istek, başkasının profili, hız sınırı; passkey seçenekleri             |
| API birim + HTTP   | 65   |                                                                                                             |
| Mobil              | 125  | kontrast, bileşenler, giriş akışı, oturum, passkey, kullanıcı adı, harita stili ve görünümü, hata titreşimi |

Son Android build: `ba9f1f6d` (animasyonlar, simge, harita görünümü, passkey teşhisi). Faz, proje
sahibinin isteğiyle otomatik testlerden sonra kapatıldı; DoD'deki üç telefon ölçümü açık madde.

Staging'de uçtan uca deneme (CI → otomatik deploy, migration 0002 dahil): giriş, kullanıcı adı
kontrolü, profil kaydı, imzasız değişikliğin reddi, `assetlinks.json` ve harita dosyaları (aralık
istekleriyle) — 22/22 doğru. Android build: `53ef50dd` (passkey dahil).

### Açık riskler

1. Harita yalnızca Türkiye'yi kapsıyor; yurt dışında boş görünür. Genişletmek: aynı betikle daha
   büyük bölge (disk ve bant genişliği maliyeti).
2. Görsel ayrıntı: OpenStreetMap şehirlerde iyi, kırsalda adres ve işletme bilgisi Google'dan
   zayıf; uydu görüntüsü yok. Bargu için bilinçli tercih (gizlilik, avatarlar öne çıksın).
3. iOS tarafı derlenemiyor (Apple hesabı); iPhone SE testi ve iOS passkey'i bekliyor.
4. Passkey'ler geçici alan adına bağlı; gerçek alan adına geçince yeniden oluşturulacak. Google
   Play'e çıkınca Play imza anahtarı da `ANDROID_CERT_SHA256`'ya eklenecek.
5. Logo ve uygulama simgesi henüz Expo varsayılanı.
6. Plan §4.1: her UI fazında 3 kişiyle 5 dakikalık kullanılabilirlik testi (proje sahibi).

## Faz 2 — Auth & Cihazlar (2026-10-13)

Kararlar: [ADR 0005](ADR/0005-auth-and-devices.md) (giriş, cihaz, RLS) ·
[ADR 0006](ADR/0006-jobs-and-notifications.md) (kuyruk ve bildirim) · Protokol eki:
[PROTOCOL.md §12](PROTOCOL.md#12-hesap-yardımcıları-faz-2)

### DoD

| Madde                                           | Durum | Kanıt                                                                                             |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| Auth e2e testleri                               | ✅    | 56 entegrasyon testi, gerçek Postgres + Redis + kuyruk (CI'da ayrı görev)                         |
| Brute-force testi                               | ✅    | 8 haneli kod, cihaza bağlı; 5 yanlışta kod ölür; cihaz ve adres sınırları; eşzamanlı tahmin testi |
| Refresh reuse testi                             | ✅    | Dönmüş token tekrar kullanılınca bütün oturum ailesi iptal + güvenlik olayı                       |
| `app.user_id` set edilmeden sorgu 0 satır döner | ✅    | Her tabloda test; ayrıca `app` şemasında zorlanmış RLS'i olmayan tablo kalırsa test kırılıyor     |

### Yapılanlar

- **Giriş**: e-posta kodu (türetilir, hiçbir yerde saklanmaz), passkey (kayıt + giriş), EdDSA erişim
  token'ı (10 dk), cihaza bağlı ve her kullanımda dönen refresh token.
- **Cihaz**: girişte anahtar paketi + cihazın kendi imzası; hesap başına tek aktif cihaz veritabanında
  zorunlu; yeni cihaz eskisini ve oturumlarını anında iptal ediyor; App Attest ve Play Integrity
  doğrulaması (staging'de isteğe bağlı, production'da zorunlu).
- **İstek imzalama**: durum değiştiren her istek cihaz anahtarıyla imzalı ve tek kullanımlık; imza
  politikası belirtilmemiş bir uç kendiliğinden reddediliyor.
- **Veri minimizasyonu**: e-posta adresi saklanmıyor (anahtarlı özet); IP saklanmıyor; kuyruktaki
  e-posta adresi şifreli.
- **Veritabanı**: sahip rol / uygulama rolü ayrımı, her tabloda zorlanmış RLS, SQL migration'lar
  (değiştirilirse durur), migration adımı ayrı container'da.
- **Kuyruk ve bildirim**: Kafka/RabbitMQ yerine pg-boss (Postgres): iş, veriyle aynı işlemde
  ekleniyor; ayrı işçi container'ı; e-posta SMTP ile (staging'de iç ağdaki Mailpit).
- **Mobil**: cihaz anahtarları güvenli depoda (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, yedeğe gitmez);
  istekleri imzalayan ve token'ı tek seferde yenileyen API istemcisi. Ekranlar Faz 3'te.
- **Kripto paketi**: istek imzası, kod türetme, e-posta özeti, token özeti, sunucuda şifreleme ve JWT
  anahtarı eklendi; API'de `node:crypto` kullanımı lint ile yasak.

### Test sonuçları

| Paket                   | Test | Not                                                              |
| ----------------------- | ---- | ---------------------------------------------------------------- |
| `packages/crypto`       | 127  | %100 satır, ifade, dal, fonksiyon                                |
| `packages/schemas`      | 31   |                                                                  |
| API birim + HTTP        | 65   | env kuralları, hata biçimi, App Attest (test CA), Play Integrity |
| API entegrasyon         | 56   | giriş, brute-force, oturum, tek cihaz, RLS, passkey, onay, işçi  |
| Mobil                   | 21   | anahtar deposu, imzalı istemci, token yenileme, saat düzeltme    |
| Swift (CryptoKit uyumu) | 10   |                                                                  |

Ek doğrulamalar:

- Semgrep (CI kural setleriyle) temiz.
- Mutasyon testleri: imza doğrulaması ve yanlış deneme hakkı ayırma bilerek kapatılınca testler
  kırıldı.
- Derlenmiş API + işçi ile uçtan uca deneme: kod isteği → kuyruk → işçi → Mailpit'e e-posta. İlk
  denemede yanlış SMTP portu yüzünden gitmeyen iş, tekrar denemeyle teslim edildi.
- **Staging'de uçtan uca deneme** (CI → otomatik deploy sonrası, herkese açık HTTPS adresi ve nginx
  üzerinden): kod e-postası 0,6 sn'de geldi (konu satırında kod yok); yanlış kod, imzasız istek ve
  kodu başka cihazdan kullanma reddedildi; doğru kodla yeni hesap açıldı; kod ikinci kez
  kullanılamadı; `/v1/me` doğru hesap ve cihazı döndü; refresh token döndü, başka cihazın imzasıyla
  reddedildi; çıkıştan sonra erişim token'ı geçersiz. `/health/ready` internete kapalı (404), sunucu
  içinden açık. API ve işçi loglarında e-posta adresi yok.
- CI'da bulunan verim sorunu: işçi işleri tek tek alıp her işten sonra bekliyordu; yoğun anda kodlar
  gecikirdi. Artık 20'lik gruplarla ve beklemeden çalışıyor (ADR 0006).

### Bağımsız güvenlik incelemesi (kapanış kontrolü)

Kod, ayrı bir inceleyiciyle saldırgan gözüyle tarandı; iki bulgu canlı test sunucusuna karşı deneme
testiyle doğrulandı. Kritik bulgu yok; token, RLS, oturum dönüşümü ve tek cihaz kuralı sağlam çıktı.

| Bulgu                                                                                     | Önem  | Durum                                                                               |
| ----------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| Eşzamanlı yanlış kodlarla kilit aşılabiliyordu; IPv6'da her adres ayrı sayılıyordu        | Orta  | ✅ Hak, kod karşılaştırılmadan önce tek adımda ayrılıyor; IPv6 /64; 8 hane          |
| Herkes bir adresin yanlış deneme hakkını harcayıp sahibini kilitleyebiliyordu             | Orta  | ✅ Kod isteyen cihaza bağlı; hak (adres, cihaz) başına; adres için günlük üst sınır |
| Giriş öncesi bazı uçlarda istek sınırı yoktu (Redis doldurma, Google kotası)              | Orta  | ✅ İstemci ağı başına sınır; doğrulama sınırı pahalı kontrollerden önce             |
| JSON dışı gövdeler imzanın dışında kalabiliyordu                                          | Düşük | ✅ Yalnızca JSON (415) + imzasız gövde reddi                                        |
| `NODE_ENV=production` ama `APP_ENV` yoksa geliştirme ayarları devreye giriyordu           | Düşük | ✅ Production'da `APP_ENV` zorunlu                                                  |
| Silinmekte olan hesabın adresiyle giriş 500 dönüyordu                                     | Düşük | ✅ `ACCOUNT_UNAVAILABLE`                                                            |
| Deploy betiği çekilemeyen imajı geri dönüş hedefi yapabiliyordu                           | Düşük | ✅ İmaj ancak çekilip migration geçince kaydediliyor                                |
| Saat farkı "geçersiz imza" görünüp oturumu kapatıyordu; Google kesintisi "geçersiz cihaz" | Bilgi | ✅ `CLOCK_SKEW` + istemci düzeltmesi; kesintide 503                                 |
| IP özeti anahtarsızdı; migration şifreyi her çalışmada gönderiyordu; aynı passkey 500     | Bilgi | ✅ Anahtarlı takma ad; şifre yalnızca gerektiğinde; 409                             |

### Açık riskler

1. **Platform doğrulaması gerçek cihazla denenmedi**: Apple Developer ve Google Play Console hesabı
   yok. Doğrulayıcılar Apple'ın belgelenen biçimiyle üretilmiş test zinciri ve sahte Google
   yanıtlarıyla test edildi; staging'de `optional`.
2. **Gerçek e-posta teslimi yok**: domain ve aktarıcı (Scaleway önerisi) gelene kadar staging kodları
   sunucudaki Mailpit'e gidiyor; telefondan giriş ancak kodu oradan okuyarak denenebilir.
3. **Passkey alan adı geçici** (sslip.io). Gerçek domainde passkey'ler yeniden oluşturulacak (henüz
   kullanıcı yok). Android'de passkey için `assetlinks.json`'a uygulamanın imza parmak izi
   eklenmeli (`ANDROID_CERT_SHA256`).
4. **İşçinin sağlık kontrolü yok** (HTTP sunucusu yok); kuyruk metrikleri ve alarmlar Faz 10'da.
5. **E-posta ile girişte kasıtlı engelleme hâlâ mümkün**: çok sayıda cihaz anahtarıyla bir adrese günde 50 yanlış
   kod denenirse adres 24 saat kilitlenir (tahmini sınırlamanın bedeli). Production'da her cihaz
   anahtarı gerçek bir telefonla onaylanmak zorunda; passkey'li kullanıcılar etkilenmez.
6. **Yoğun saldırıda Redis belleği** (staging 256 MB, `noeviction`): dağıtık bir saldırı giriş öncesi
   uçlarla belleği doldurabilir; CDN/WAF ve ölçekli sınırlar Faz 10'da.
7. İşçi container'ı kullanmadığı bazı anahtarları da alıyor (aynı ortam dosyası); Faz 10'da ayrılacak.
8. Mobil bağımlılıklarda 2 orta seviye bulgu (`uuid` Expo derleme araçlarında, `decode-uri-component`
   `expo-router` içinde); yüksek/kritik yok. Expo güncellemelerinde tekrar bakılacak.

### Kalan işler

| İş                                            | Kim                              | Ne zaman               |
| --------------------------------------------- | -------------------------------- | ---------------------- |
| Gerçek domain                                 | Proje sahibi alır, bağlama bizde | Faz 3 (passkey ekranı) |
| E-posta aktarıcısı hesabı (Scaleway TEM)      | Proje sahibi (ödeme/kimlik)      | Domain ile birlikte    |
| Apple Developer Program / Google Play Console | Proje sahibi                     | En geç Faz 5           |
| ~~Android imza parmak izini staging'e ekle~~  | ✅ 2026-10-13                    | Faz 3                  |

## Faz 1 — Kripto Çekirdeği (2026-10-13)

Protokol: [PROTOCOL.md](PROTOCOL.md) · Tehdit modeli: [THREAT_MODEL.md](THREAT_MODEL.md) · Kararlar:
[ADR 0004](ADR/0004-e2ee-protocol.md)

### DoD

| Madde                                  | Durum | Kanıt                                                                                    |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| Test vektörleri geçer                  | ✅    | RFC 7748 (X25519), 8032 (Ed25519), 8439 (ChaCha20-Poly1305), 5869 (HKDF) — RFC metninden |
| `packages/crypto` %100 satır coverage  | ✅    | Satır, ifade, dal ve fonksiyon %100 (CI'da eşik olarak zorunlu)                          |
| Tamper / replay / epoch testleri yeşil | ✅    | Tek bit değişikliği (property), tekrar ve eski `seq`, yanlış epoch/çember/gönderen       |
| Cihazda şifreleme < 5 ms               | ✅    | Android'de p95 **0,96 ms** (yerel eğri işlemleri, ADR 0007); saf JS ile 6,70 ms'ydi      |

### Yapılanlar

- `packages/crypto`: cihaz anahtarları (DH anahtarı kimlikle imzalı), sender key dağıtımı, mesaj başına
  anahtar (rastgele `salt` ile), tekrar penceresi, bildirim sealed box'ı, güvenlik numarası (60 rakam +
  QR), ızgara hassasiyeti, rekey kuralları. Yalnızca `@noble/*` 2.4 ve `@scure/base`.
- `packages/schemas`: içerik birleşimi (`loc`, `bump`, `place_enter/exit`, `share_stop`, `status`) ve
  kablo şemaları (zarf, dağıtım, cihaz paketi).
- `packages/crypto/swift`: çözen taraf (bildirim eklentisi için) CryptoKit ile; TypeScript fixture'larını
  birebir açtığı macOS CI job'u ile doğrulanıyor.
- Mobil: `expo-crypto` ile işletim sistemi CSPRNG'si; geliştirme / önizleme sürümlerinde `/_dev/crypto`
  hız testi ekranı.

### Test sonuçları

- `packages/crypto`: 84 test (RFC vektörleri, fast-check property testleri, tamper, replay, epoch,
  çıkarılan üye, kötü niyetli gönderici, fixture, performans) — %100 kapsam.
- `packages/schemas`: 21 test. Swift: 10 test (Linux'ta swift-crypto ile; CI'da macOS CryptoKit ile).

### Bağımsız güvenlik incelemesi (kapanış kontrolü)

Faz kapanmadan önce kripto kodu ayrı bir inceleyiciyle saldırgan gözüyle tarandı. Bulgular ve durum:

| Bulgu                                                                                                   | Önem   | Durum                                                                |
| ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Tekrar koruması çemberi ayırt etmiyordu: bir çemberdeki yeni epoch, diğerinde eski mesajı geri açıyordu | Yüksek | ✅ Düzeltildi: `(çember, gönderen)` başına durum + iki çember testi  |
| Epoch tabanı yoktu: sunucu eski bir epoch'un mesajlarını yeniden gönderebilirdi                         | Orta   | ✅ Düzeltildi: N − 2 ve öncesi reddedilir                            |
| Sırası karışan olaylar (ör. `place_enter`) sessizce düşüyordu                                           | Düşük  | ✅ Düzeltildi: 64'lük kayan pencere; eski konum `STALE`              |
| Zarf boyutu hassasiyet seviyesini ve hareketi sızdırıyordu                                              | Düşük  | ✅ Düzeltildi: tüm mesajlar tek boy (512 bayt); `acc` yuvarlanıyor   |
| Swift tarafı UUID / bilinmeyen alan / `ct` boyutunda TypeScript kadar katı değildi                      | Düşük  | ✅ Düzeltildi + Swift testleri                                       |
| CryptoKit küçük mertebeli Ed25519 anahtarlarını reddetmiyor                                             | Düşük  | Belgelendi: eklenti yalnızca TS ile doğrulanmış anahtarları kullanır |
| Bildirim eklentisinin tekrar durumu, değişen kimlik anahtarına otomatik dağıtım                         | Bilgi  | Faz 4 ve Faz 7 kalan işlerine eklendi                                |

### Testlerin bulup düzelttiği hatalar

- Hassasiyet ızgarası tarih değiştirme hattında idempotent değildi (property testi buldu) → ızgara artık
  180°/360°'yi tam bölüyor.
- Güvenlik numarasında rakam eşitliğinde iki telefonun farklı QR üretme ihtimali → sıralama tam
  parmak izine göre.
- noble'ın `isValidPublicKey` fonksiyonu küçük mertebeli noktaları kabul ediyor → ek kontrol eklendi.

### Cihaz ölçümü (Android, 2026-10-13)

| İşlem                      | Saf JS (p95) | Yerel eğri işlemleri (p95) |
| -------------------------- | ------------ | -------------------------- |
| Konum şifreleme            | 6,70 ms      | **0,96 ms**                |
| Hassasiyet + şifreleme     | 6,73 ms      | 0,69 ms                    |
| Doğrulama + çözme          | 15,09 ms     | 1,19 ms                    |
| Anahtar dağıtımı (1 alıcı) | 22,19 ms     | 2,45 ms                    |
| Bildirim kutusu            | 16,24 ms     | 1,57 ms                    |
| Cihaz anahtarı üretimi     | 12,47 ms     | 4,13 ms                    |
| Güvenlik numarası          | 363,91 ms    | 373,23 ms (eğri değil)     |

Ekran "telefonun yerel kripto kodu (öz test geçti)" gösterdi: Tink, açılıştaki noble karşılaştırmasını
geçti.

### Açık riskler

1. iOS'taki yerel eğri işlemleri (CryptoKit) Apple hesabı gelene kadar derlenemiyor ve ölçülmedi;
   Android'de ölçüldü (aşağıda). Öz test başarısız olursa uygulama saf JS'e döner (daha yavaş ama
   güvenli).
2. ~~**Güvenlik numarası 373 ms** sürüyor ve JS iş parçacığını kilitler.~~ Faz 4'te kapandı: hesap
   kısa dilimlerle, her dilim arasında bir kare beklenerek yapılıyor; ekran donmuyor.
3. Epoch içinde ileri gizlilik ve inkâr edilebilirlik yok (bilinçli tercih, THREAT_MODEL.md).
4. Protokol henüz uygulama akışlarına bağlı değil: anahtar saklama (Faz 2), çember ve dağıtım (Faz 4),
   konum gönderimi (Faz 5), bildirim eklentisi (Faz 7).

## Faz 0 — Temel & Güvenlik Altyapısı (2026-10-13)

### DoD

| Madde                                    | Durum | Kanıt                                                                                    |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `pnpm dev` ile api + mobile ayağa kalkar | ✅    | API :3000, Metro :8081; Android ve iOS bundle'ları derleniyor                            |
| CI yeşil                                 | ✅    | CI (format, typecheck, lint, test, build, audit) ve Security (gitleaks, Semgrep, CodeQL) |
| Staging HTTPS üzerinden erişilebilir     | ✅    | Let's Encrypt, sadece TLS 1.3, `/health/live` 200, `/health/ready` dışarıya 404          |
| Dev client Android'e kurulu              | ✅    | EAS build, telefonda "API bağlantısı hazır" görüldü                                      |
| Dev client iPhone'a kurulu               | ⏳    | Ücretli Apple Developer Program üyeliği bekleniyor                                       |

### Yapılanlar

- pnpm 12 + Turborepo monorepo; TypeScript 6 sıkı mod; ESLint 10 (tip bilgili + güvenlik +
  gerekçesiz `eslint-disable` yasağı); Prettier; CLAUDE.md kuralları lint ile zorunlu.
- API (NestJS 12, Fastify): zod env doğrulama, live/ready sağlık kontrolleri, log maskeleme, güvenlik
  başlıkları, CSRF, body limit, zaman aşımları, distroless ve root olmayan imaj.
- Mobil (Expo SDK 57): Expo Router, i18n (tr varsayılan, en), env doğrulama (release'de HTTPS zorunlu).
- Lokal altyapı: Postgres 18, Redis 8, Mailpit (sadece 127.0.0.1).
- Staging: paylaşımlı sunucuda sadece ekleme yapan kurulum; host nginx + certbot; API sadece
  loopback'te; zorunlu komutlu SSH ile deploy, otomatik geri dönüş.
- Sunucu sertleştirme (sahibinin onayıyla): SSH sadece anahtar; fail2ban (Ubuntu 24.04 filtre hatası
  düzeltildi). Sertleştirme öncesi günde ~13.000 şifre denemesi vardı.
- Tedarik zinciri: 24 saat karantina, yayın kanıtı düşüşü engeli, install script izin listesi,
  digest/SHA ile sabitlenmiş imajlar ve Actions, Renovate (7 gün).

### Test sonuçları

- API: 21 test (Vitest) — readiness 503, CSRF 403, body limit 413, log maskeleme, istek kimliği.
- Mobil: 10 test (Jest) — i18n anahtar eşitliği, API adresi kuralları.
- Ek doğrulamalar: gitleaks, Semgrep, CodeQL, actionlint, shellcheck, `nginx -t`, compose config,
  container sağlık kontrolü, gerçek Postgres/Redis ile kesinti ve toparlanma testi, deploy anahtarının
  kabuk / enjeksiyon / yabancı imaj denemelerini reddettiğinin testi, h2c smuggling denemesinin
  engellendiğinin testi.

### Bulunan ve düzeltilen sorunlar

- nginx'te h2c smuggling riski (Semgrep) → yükseltme sadece `websocket`.
- CI'dan çağrılan deploy'a secret gitmiyordu → sadece `STAGING_SSH_KEY` adıyla geçiriliyor; boşsa açık hata.
- `secrets: inherit` en az yetki ilkesine aykırıydı (Semgrep) → kaldırıldı.
- fail2ban hiçbir denemeyi saymıyordu (Ubuntu 24.04 paketi yanlış servis adını dinliyor) → düzeltildi.

### Açık riskler

1. Expo geliştirme araçlarında yaması olmayan 2 yüksek seviye bulgu (node-forge, braces): uygulama
   paketine girmiyor; `pnpm-workspace.yaml`'da gerekçeli istisna. Her Expo güncellemesinde tekrar bak.
2. Expo SDK 57 yamaları provenance olmadan yayınlanıyor (SDK 58 ile değişiyor); 7 günlük bekleme ve
   güven politikası riski sınırlıyor.
3. Paylaşımlı sunucu: `deploy` kullanıcısı docker grubunda (host'ta root eşdeğeri); zorunlu komut CI
   anahtarını sınırlıyor.
4. Staging'de yedek yok (kullanıcı verisi yok); gerçek veriden önce şifreli yedek + geri yükleme testi
   şart (Faz 10).
5. Mevcut geliştirme ağı TLS trafiğine araya giriyor, LAN ve tünel bağlantılarını engelliyor: telefon
   geliştirme sunucusuna bu ağdan bağlanamıyor. Çözüm: `preview` sürümü veya başka bir ağ.
6. sslip.io geçici: Let's Encrypt limiti diğer kullanıcılarla ortak; passkey için gerçek domain şart.

### Kalan işler

| İş                                     | Kim                              | Ne zaman                      |
| -------------------------------------- | -------------------------------- | ----------------------------- |
| iPhone dev client                      | Proje sahibi: Apple üyeliği      | Üyelik gelince (en geç Faz 5) |
| Renovate GitHub App'i kur              | Proje sahibi                     | Önerilir                      |
| Gerçek domain                          | Proje sahibi alır, bağlama bizde | Faz 2'den önce                |
| pnpm 12 + gitleaks (kendi makinesinde) | Proje sahibi                     | Komut çalıştırmak isterse     |

### Takip (tarihli)

- **2026-10-20**: lockfile'daki tüm kayıtlar 7 günü geçince `minimumReleaseAge`'i 10080'e çıkar;
  `trustPolicyExclude` listesini sil (2026-10-13 12:16 UTC'den sonra zaten gereksiz).
- **Expo yamaları** (57.0.28 vb.) olgunlaşınca güncelle; `expo-doctor` temiz olsun.
- **Node 26 LTS** (2026-10-28): araçlar destekleyince geçiş değerlendir.
- `eslint-config-expo` ESLint 10 desteği verince geri al (ADR 0001).
- Expo hesabında hesap genelinde tanımlı `GOOGLE_MAPS_ANDROID_API_KEY` Bargu build'lerine de
  yükleniyor; Bargu kullanmıyor → sadece ilgili projeye kapsamla.
- Geliştirme ve önizleme sürümlerinin telefonda yan yana durabilmesi için ayrı uygulama kimliği
  (`app.bargu.dev`) değerlendir.
- **Faz 4:** güvenlik numarası (373 ms) JS iş parçacığından çıksın (yerel SHA-256 veya arka plan).
- **Faz 4:** anahtar deposu mevcut epoch'tan eski dağıtımı reddetsin; kimlik anahtarı değişen üyeye
  sender key, kullanıcı uyarıyı onaylayana kadar otomatik dağıtılmasın.
- **Faz 7:** iOS bildirim eklentisi tekrar korumasını (`ReplayGuard` durumu) uygulamayla uygulama
  grubu üzerinden paylaşsın.
