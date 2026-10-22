# 0026. Her çemberde buluşma, buluşmanın kendi görünümü ve ekranı

- Durum: Kabul edildi (PM, 2026-10-16)
- Tarih: 2026-10-16
- İlgili: [ADR 0017](0017-event-circles.md) (etkinlik çemberleri),
  [ADR 0018](0018-event-planning.md) (buluşma ve oylamalar), [ADR 0020](0020-circle-admins-and-planning-authority.md)
  (yöneticiler), [ADR 0024 §10](0024-entitlements-and-test-billing.md) (istemci seviyesi)

## Bağlam

Proje sahibi telefon denemesinden sonra iki şey istedi:

- "Buluşma alanı lokasyonmuş gibi gözüküyor, aynı şey değil. Bizim evde buluşacaksak da o an
  gösterimi farklı olmalı, tıklanabilmeli, kendi ekranı olmalı."
- "Çemberde buluşma başlat gibi seçenek yok." Seçimi: buluşma doğrudan çemberin içinde, davetsiz.

Bugün buluşma yalnızca etkinlik çemberinde var (ADR 0018). Haritadaki ayrı işaret yalnızca yeri
kesinleşmiş buluşmada çıkıyor; yer oylamadaysa etkinliğin yeri kayıtlı bir yer gibi görünüyor.
Dokununca çember sayfası açılıyor.

## Karar

### 1. Her çemberde bir buluşma

- Etkinlik dışı çemberde (ikili, arkadaş, aile) de tek bir buluşma belgesi olur: sunucunun bildiği
  tür `plan`, çemberin kimliğiyle saklanır, içeriği uçtan uca şifreli (yer ve saat).
- **Yetki (ADR 0020 ile uyumlu, sunucu denetler):**
  - Her etkin üye başlatabilir. Başlatan kişi belgenin yazarıdır.
  - Değiştirme ve bitirme yalnızca başlatan ve çemberin yöneticileri.
  - **İkili çemberde (arkadaşlık) iki kişi eşittir** (PM'in ürün kararı, 2026-10-16, migration
    0036): ikisi de buluşmayı değiştirir ve bitirir, kim başlatmış olursa olsun. Önceden
    arkadaşlığı kuran (çemberin yöneticisi) öbürünün başlattığını bitirebiliyor, öbürü onunkini
    bitiremiyordu.
  - Çemberde aynı anda tek buluşma: biri varken başkası yenisini başlatamaz (`409 MEETING_EXISTS`),
    var olanı görür.
  - Üye olmayan okuyamaz ve yazamaz.
- Etkinlik çemberlerinin kuralları değişmez: buluşmayı ve oylamaları yöneticiler yönetir.
- Etkinlik dışı çemberde oylama yoktur (sonraki dilim).
- Buluşma başlarken yer ve saat seçilir. Yer çemberin kayıtlı yerlerinden biridir (ailenin "Ev"i
  gibi) ya da yeni bir yer eklenir.
- Şifreli içerik başlatanı (`by`) taşır; ekran "Ayşe başlattı" der ve kimin değiştirebileceğini
  gösterir. Sunucu aynı kuralı yazar kimliğiyle denetler.

### 2. Ne zaman silinir

- Buluşma, saatinden 3 saat sonra silinir; "Bitir"e basılınca hemen silinir.
- Sunucu silmek için bitiş anını bilmek zorundadır: telefon belgeyle birlikte düz bir `endsAt`
  gönderir (buluşma saati + 3 saat). Sunucu böylece bir çemberde buluşma olduğunu, kimin
  başlattığını ve **buluşmanın saatini** bilir (`endsAt` − 3 saat, dakikasına kadar); yeri bilmez.
  Etkinliklerin bitişini zaten bildiği gibi.
- **Tam saate yuvarlama (PM, 2026-10-16; QA 22, 2026-10-17'de yapıldı):** `endsAt` bir sonraki
  tam saate yukarı yuvarlanır. Telefon göndermeden önce yuvarlar; sunucu da sakladığını yuvarlar
  (eski uygulamalar dakikasıyla gönderir). Sunucu saati yalnızca bir saatlik aralıkla saklar;
  yeni uygulamalarda yolda da öyle görür. Bedeli: buluşma sunucuda en çok bir saat daha geç silinir
  (telefon yine saat + 3 saatte haritadan kaldırır). Sunucu yuvarlanmamış değeri reddetmez; eski
  ve yeni uygulama birlikte çalışır.
- **Başlatan hesabını silerse (QA 21 B-3):** yazdığı belgeler hesabıyla gider; başlattığı buluşma
  da, etkinlikteki oylamaları ve oyları da. Hesabı temizleyen adım (hemen ya da işçide) bu
  belgelerin çemberlerindeki üyelere canlı olay (`docs.changed`) gönderir; telefonlar buluşmayı
  hemen kaldırır. Başlatan yalnızca çemberden ayrılırsa buluşma kalır; onu yöneticiler değiştirir
  ve bitirir.
- İşçi her dakika süresi dolan buluşmaları siler. Her değişiklik ve silme üyelere canlı olayla
  (`docs.changed`) gider; yoklama yoktur.

### 3. Haritada kendi görünümü

- Buluşma yerleri kayıtlı yer gibi çizilmez: başka renk, kesikli kenar, bayraklı iğne ve saat
  ("17:30 · Ev"). Etkinlikte yer oylamadaysa adaylar aynı görünümle ve "oylanıyor" ile çizilir.
- Kayıtlı bir yer (ailenin "Ev"i) buluşma yeri olunca buluşma süresince buluşma görünümüne geçer,
  sonra normale döner.
- İğne oradaki kişilerin çıkartmalarını ve ortak çerçeveyi örtmez: kişiler üstte kalır.
- Haritanın o anki yakınlığında etiketleri üst üste binecek buluşma yerleri (bir etkinliğin iki
  adayı bir sokak arada) tek kartta, alt alta birer satır olarak çizilir; her satır kendi
  buluşmasını açar, buluşmanın kendisi en üstte ve mercan. Yakınlaşınca ayrılırlar. Kartta en çok 4
  satır, fazlası sayıyla. Seçilmemiş yerlerin kesikli kenarı soluk (proje sahibi, 2026-10-18: biri
  ötekini örtüyor, tıklanamıyordu).
- Hareket Reanimated worklet'leri ve hareket tokenlarıyla yapılır; sade modda ve "Hareketi azalt"
  ayarında durur. Yazı açık ve koyu temada okunur.

### 4. Buluşmanın kendi ekranı

- İğneye dokununca buluşma ekranı açılır: yer, saat, başlatan, kim geliyor, küçük harita.
- "Yol tarifi" yalnızca dokununca telefonun harita uygulamasını açar. **Buluşma yerinin koordinatı
  o an Bargu'dan çıkar** ve o uygulamaya (Google Haritalar, Apple Haritalar) gider; Bargu bunu
  kendiliğinden hiç yapmaz.
- "Geç kalıyorum", "Geldim"; başlatan ve yöneticiler için yer ve saati değiştirme, buluşmayı bitirme.

### 5. "Kim geliyor" ve gizlilik

- Varış tahmini yalnızca kişinin o çemberde zaten paylaştığından hesaplanır: tahmini kişinin kendi
  telefonu hesaplar ve tam konumla birlikte gönderir (ADR 0018); kaba konumda tahmin şifrelemeden
  önce atılır.
- Hayalet modda, Mahalle ya da Şehir hassasiyetinde ve duraklamış çemberde tahmin yoktur; kişi
  "bilinmiyor" görünür.
- "Geldi" yalnızca iki durumda: kişinin tam konumu (doğruluğu en çok 100 m) buluşma alanının
  içindeyse, ya da kişi kendisi "Geldim" derse (yeni şifreli mesaj türü `arrived`). Kaba konum
  hücrenin ortasına konduğu için alanın içine düşebilir; bu yüzden kaba konum hiçbir zaman "geldi"
  saymaz. Bilinen bir yere varışı söylemek kaba hassasiyeti delmez.

### 6. Bildirim

- Buluşma başlayınca çemberin diğer üyelerine tek bir şifreli bildirim gider: "Ayşe buluşma
  başlattı: 17:30 · Ev". Başlatanın telefonu imzalar ve her cihaz için ayrı şifreler (ADR 0016),
  sunucu yalnızca taşır. Yeni bildirim türü `meeting`.
- Hız sınırı: bir kişi saatte en çok birkaç buluşma bildirimi gönderebilir.
- Eski uygulamalar tanımadıkları bildirimi göstermez (Android) ya da genel metni gösterir (iOS).

### 7. Uyumluluk: istemci seviyesi 3

- Etkinlik dışı çemberin buluşma belgesi seviyesi 3'ten düşük uygulamaya gönderilmez.
- Plan içeriği bundan sonra esnek okunur (yeni alanlar atılır). `by` yalnızca etkinlik dışı
  buluşmalarda yazılır; eski uygulamaların okuduğu etkinlik planları değişmez.
- `MIN_CLIENT_LEVEL` 2'yi de atlar: herkes bu dilimin APK'sına geçince doğrudan 3 yapılır, en geç
  1 Kasım, PM'e sorularak.

### 8. Harita kısayolları ve buluşma sayacı (proje sahibinin isteği, PM onayı 2026-10-16)

- Haritanın sağ kenarında, dock'un üstünde en çok üç yuvarlak düğme (48 pt dokunma alanı):
  - **Konumuma dön:** yalnızca harita bu telefondan uzağa bakınca çıkar.
  - **Hayalet modu:** tek dokunuşla açılır ("Gizle": haritalardan kaybolur, konum gönderilmez).
    Kapatırken kaç çembere yeniden paylaşılacağını söyleyen bir onay sorulur ("Konumun yeniden
    paylaşılacak: 3 çember"); yanlışlıkla kapatmak konumu açar, bu daha tehlikelidir. Paylaşılacak
    çember yoksa sormadan kapanır. Durum renkte, düğmenin seçili durumunda ve ekran okuyucunun
    söylediğinde görünür.
  - **Buluşma başlat:** bir buluşma varken yerini üstteki sayaç çipine bırakır. "Geldim" yalnızca
    saatine 15 dakika kala ya da tahmin penceresinde yere 300 m yaklaşınca çıkar; söylendiyse ve
    duraklamış çemberde çıkmaz.
  - Bir kişinin kartı açıkken düğmeler çekilir; kişilerin çıkartmaları ve dock açık kalır.
- **Sayaç çipi** üstte, en yakın buluşmayı gösterir: yer ve saat, son bir saatte geri sayım
  ("🏠 Ev · 17:30 · 25 dk"), son 10 dakikada belirgin renk; saatinden sonra "2/4 geldi · 1 yolda".
  Başka buluşma da varsa "+1". Dokununca buluşma ekranı açılır.
- **Sayılar §5'in kurallarıyla:** "geldi" tam konumla ya da kişinin kendi sözüyle; "yolda"
  yalnızca telefonun tahmininden (tahmin yalnızca tam paylaşımda gider). Hayalet moddaki ya da kaba
  hassasiyetteki kişi toplamda sayılır, durumu gösterilmez; kendi "geç kalıyorum"u onu "yolda"
  saydırmaz. Çip telefonun saatiyle çalışır (yarım dakikada bir); hiçbir şey sorulmaz, telefondan
  yeni bir şey çıkmaz.
- **Konfeti:** herkes oradayken ve her biri tam konumla oradaysa bir kez (bu telefonda
  hatırlanır). Biri yalnızca "Geldim" dediyse yok. "Hareketi azalt" açıkken yok; hareketler
  Reanimated worklet'leri ve hareket tokenlarıyla. Sade moda uyar: "az"da yarı yarıya, "kapalı"da yok (ADR 0027).
- **Efektler (PM, 2026-10-17):** düğmelerin yaylı girişi (yalnızca harita ilk açılınca), hayalet
  açılınca birkaç tur süzülme ve kapanınca "pof", "Konumuma dön"de radar halkası, "Geldim" belirince
  birkaç nabız, sayaçta kayan rakamlar. Hepsi her modda sonlu; sade mod (tam / az / kapalı), pil
  ve görünmeyen harita kuralları ADR 0027'de.

## Sonuçlar

- Sunucu yeni olarak şunu bilir: etkinlik dışı bir çemberde buluşma olduğu, kimin başlattığı,
  ne zaman biteceği, dolayısıyla buluşmanın saati (bir saatlik aralıkla; eski uygulamalardan yolda dakikasıyla). Yeri
  bilmez.
- "Yol tarifi" buluşma yerinin koordinatını kullanıcının seçtiği harita uygulamasına verir; bu,
  kullanıcının dokunmasıyla olur.
- Kaba konum paylaşan kişi buluşmada "bilinmiyor" görünür; geldiğini kendisi söyleyebilir.

## Ek 1 (2026-10-22): buluşma için eklenen yer buluşmayla gider

Sahip haritada "Woh date" adlı bir yeri buluşma sandı ve dokununca buluşmanın açılmasını bekledi.
O yer, bir buluşmayı başlatırken "Yeni yer ekle" ile eklenmişti. Buluşma saatinden 3 saat sonra
silindi, yer ise çemberde sıradan bir kayıtlı yer olarak kaldı. PM'in kararı:

- Başlatma ekranında "Yeni yer ekle" ile eklenen yer "bu buluşma için" sayılır. Yer düzenleyicisi
  buluşma için açılır, yeni yerin kimliğini kendisi üretir ve kaydedince bildirir. Böylece çemberin
  önceden kayıtlı bir yeri (ör. "Ev") hiçbir zaman yanlışlıkla bu sayılmaz.
- Buluşma belgesi (`plan`) bunu `placeGoes` ile söyler: `true` yer buluşmayla gider, `false`
  başlatan saklamayı seçti, alan yoksa yer çemberin önceden kayıtlı yeri ve hep kalır. Buluşma
  belgesini eski uygulamalar esnek okur, alanı atar ve yeri bırakır.
- Elle bitirirken ("Buluşmayı bitir") pencere "Bitir, yeri sakla" seçeneğini de sunar. Saklanınca
  önce belge `placeGoes: false` olarak yazılır, sonra buluşma silinir; böylece başka bir telefon
  yeri sonradan silmez.
- Sunucu buluşmayı kendiliğinden silince yeri, buluşmayı başlatanın telefonu bir sonraki eşitlemede
  siler. Yalnız onun telefonu siler ki birden çok telefon yarışmasın. Başlatan uygulamayı açmazsa
  yer onun bir sonraki açılışına kadar kalır.
- Başlatan ve yöneticiler buluşma ekranında "Bitince yeri sakla" anahtarıyla seçimi önceden
  değiştirebilir.
- Buluşma başka bir yere taşınınca, onun için eklenmiş eski yer hemen silinir. Yeni yer çemberin
  kayıtlı yeridir ve kalır.
- Bu düzeltmeden önce kalan yerler ("Woh date" gibi) olduğu gibi kalır; kullanıcı silebilir.

Sunucu değişmedi: yer ile buluşma arasındaki bağ şifreli belgenin içinde. Sunucu hangi yerin bir
buluşma için eklendiğini bilmez.
