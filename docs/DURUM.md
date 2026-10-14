# Proje Durumu

Her faz sonunda güncellenir: ne bitti, nasıl test edildi, açık riskler, kalan işler. Plan:
[BARGU_PLAN.md](../BARGU_PLAN.md) · Kararlar: [docs/ADR](ADR/README.md)

## Özet

| Faz                              | Durum                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Faz 0 — Temel & Güvenlik Altyapı | ✅ Onaylandı (açık madde: iPhone dev client)                                     |
| Faz 1 — Kripto Çekirdeği         | ✅ Tamamlandı                                                                    |
| Faz 2 — Auth & Cihazlar          | ✅ Onaylandı                                                                     |
| Faz 3 — Tasarım Sistemi & Harita | ✅ Tamamlandı (açık madde: telefonda fps ve büyük yazı ölçümü, passkey denemesi) |
| Faz 4 — Çemberler & Anahtarlar   | 🟡 Kod ve testler tamam, staging'de doğrulandı; telefonda deneme bekliyor        |

## Ortamlar

| Ne                 | Nerede                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging API        | `https://api.46-62-162-70.sslip.io` (geçici ücretsiz domain; bkz. ADR 0003)                                                                                           |
| Staging deploy     | `main`'e her yeşil CI → GHCR imajı → migration → API + işçi (otomatik, sağlık kontrollü)                                                                              |
| Staging e-posta    | Varsayılan iç Mailpit. Proje sahibi sunucuda `bargu-set-mail` ile bir Gmail hesabından gerçek gönderime geçirebilir (ADR 0006); `.test` test hesapları hep Mailpit'te |
| Expo / EAS projesi | hesap `otenus`, proje `bargu` (`app.config.ts`)                                                                                                                       |
| Android sürümleri  | `development` (dev client, Metro'ya bağlanır), `preview` (bağımsız, staging'e bağlanır)                                                                               |
| Uygulama kimliği   | `app.bargu` (mağazaya çıkınca değiştirilemez)                                                                                                                         |
| Harita dosyaları   | Sunucuda `/srv/bargu-map`, `https://api.46-62-162-70.sslip.io/map/` (Türkiye, 1,6 GB)                                                                                 |

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

Android build: `8fb45363`. Tek telefonla deneme için staging'de bir test arkadaşı (`@deneme.arkadas`)
çalıştırıldı: istekleri kabul eder, anahtarını gönderir, gelen anahtarı açar (kontrol hesabıyla
doğrulandı).

### Açık riskler

1. Davet linki `bargu://i/…`: bazı mesajlaşma uygulamaları bunu tıklanabilir göstermez. Gerçek
   alan adı gelince https link (App Links / Universal Links) olacak.
2. Uygulamadan çıkış yapılmışken açılan davet linki, giriş sonrası kendiliğinden açılmaz (linke
   yeniden dokunmak gerekir).
3. Arkadaşın uygulaması hiç açılmazsa şifreleme "hazırlanıyor" kalır; uygulamayı açınca kendiliğinden
   tamamlanır. Kapalı uygulamayı uyandıran bildirim Faz 7'de.
4. Canlı bağlantı yalnızca uygulama açıkken; arka planda konum Faz 5/7. Uygulama tamamen kapalıyken
   telefonun sistem bildirimi (push) Faz 7'de; Android için Firebase projesi gerekiyor.
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
