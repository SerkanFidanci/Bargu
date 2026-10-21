# 0016. Bildirimler uçtan uca şifreli: Google ve Apple içerik görmez

- Durum: Kabul edildi (ADR 0010'un yerine)
- Tarih: 2026-10-14

## Bağlam

ADR 0010 sosyal haberleri içeriksiz ama düz metinle gönderiyordu ("Bir çembere davet edildin");
dürtme bildirimi kimin dürttüğünü söylemiyordu. Faz 7 "Ali eve vardı" gibi konum bildirimleri
getiriyor ve planın şartı: bildirim içeriği APNs/FCM'de düz görünmez; TypeScript'in mühürlediği
kutuyu iOS bildirim eklentisi (Swift + CryptoKit) açar.

## Karar

- **Her bildirim tek cihaza mühürlü kutu** (PROTOCOL §9): X25519 + HKDF + ChaCha20-Poly1305,
  128 baytlık bloklara dolgulu.
- **Üyenin bildirimi imzalı**: dürtme ve varış/ayrılış bildirimini gönderen üyenin telefonu, her
  alıcı cihaz için ayrı mühürler ve kendi kimlik anahtarıyla imzalar (imza alıcının cihaz
  kimliğini de kapsar). Alıcı yalnızca güvendiği cihazların imzasını kabul eder ve gönderenin
  adını kendi bildiğinden yazar. Böylece sunucu "Ali eve vardı" uyduramaz.
- **Sunucunun haberleri** (arkadaşlık isteği, davet, katılım) imzasız `notice`'tir ve yalnızca türü
  ve çemberi söyler; işçi bunu cihazın DH anahtarına mühürler. Metni telefon kendi dilinde yazar
  (çemberin adını kendi kaydından ekleyebilir).
- **Sunucu yalnızca taşır**: telefonun gönderdiği kutuları yalnızca çemberin çevrimdışı üyelerine
  ve yalnızca o üyenin güncel cihazına iletir; yabancı bir cihaz kimliği atlanır. Kutular kuyrukta
  şifreli durur; içerik, ad, yer adı hiçbir yerde düz olarak yoktur (testle doğrulanır).
- **Android**: FCM data-only, yüksek öncelik, 1 saat ömür; anahtar adı `bargu` (expo-notifications
  `title`/`body`'yi kendisi gösterirdi). Uygulama kapalı olsa da bir arka plan görevi kutuyu açar,
  imzayı denetler, bayat (1 saatten eski) ve tekrar eden kutuları atar, sessize alınanları
  göstermez, metni yazar ve bildirimi "Arkadaşlar ve çemberler" ya da "Varışlar ve ayrılışlar"
  kanalında gösterir. Uygulama açıkken sistem bildirimi yerine uygulama içi satır çıkar.
- **iOS**: APNs (HTTP/2, .p8 anahtarı, doğrudan) `mutable-content` ve içeriksiz yer tutucu
  ("Yeni bir bildirimin var") ile; Notification Service Extension
  (`apps/mobile/targets/notification-service`) kutuyu açıp metni değiştirir. Eklenti yalnızca uygulamayla paylaştığı
  keychain grubundaki şeyleri okur: cihazın X25519 gizli anahtarı (kimlik anahtarı değil), güvenilen
  kişiler, sessize almalar. Xcode hedefini `@bacons/apple-targets` 5.0.0 üretir (Expo ekibinden
  Evan Bacon, MIT, Temmuz 2026 sürümü, yaygın kullanılan widget/eklenti eklentisi; Android'e
  dokunmaz).
- **Sessize alma** yalnızca telefonda: kişi başına (varışlar, dürtmeler) ve yer başına. Sunucu kimin
  kimi sessize aldığını bilmez.
- **APNs** Apple hesabı gelene kadar kapalı (`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`); kod ve
  testleri hazır. iOS hedefinin derlenebilirliği CI'da iOS SDK'sına karşı tip denetimiyle,
  kriptonun uyumu CryptoKit fixture testleriyle kanıtlanır.

## Sonuçlar

- Google ve Apple yalnızca bildirimin zamanını ve boyutunu (dolgulu) görür; ne olduğunu, kimden ve
  nereden olduğunu görmez. Sosyal haberler de artık şifreli (ADR 0010'daki düz metin kalktı).
- Eski uygulama sürümleri yeni bildirimleri gösteremez (metin yok, açacak görev yok): sunucu ve
  uygulama birlikte güncellenir.
- Android'de üreticinin uygulamayı tamamen durdurduğu (zorla kapat) telefonlarda data-only mesaj
  uygulamayı uyandıramaz; o zaman bildirim gelmez, açılınca uygulama içinden görülür.
- iOS'ta sessize alınan bir bildirimi tamamen gizlemek Apple'ın "notification filtering" iznini
  ister; o izin gelene kadar yerine içeriksiz yer tutucu görünür.
- Büyük bir çemberde dürtme ve varış, üye başına bir kutu taşır (en çok ~55 KB); bu yüzden canlı
  bağlantı sınırını aşan istekler HTTP'den gider.

## Ek (2026-10-21, QA-28 B-1: sunucu haberleri imzalı)

- Durum: Kabul edildi (PM, 2026-10-21). İki adımda yayılır (aşağıda "Geçiş").
- İlgili: [ADR 0025](0025-cosmetic-pass-and-look.md) (sunucunun imzaladığı belge, aynı desen),
  [ADR 0028](0028-location-accuracy-and-glide.md) (arka plan canlı modu, `watch`),
  [PROTOCOL §9](../PROTOCOL.md).

**Neden:** Sunucu haberleri (`notice`) imzasızdı (`0x00 ‖ gövde`) ve alıcı cihazın DH anahtarına
mühürleniyordu. Bu anahtarı çemberdeki her üye bilir. Bir üye kendi "haberini" mühürleyip
(`sealPush({ sender: null, body: { kind: 'notice', notice: 'watch', … } })`) varış ya da dürtme
isteğinin `pushes` alanıyla gönderebiliyordu; sunucu kutuyu açamadığı için taşıyordu, alıcının
telefonu da onu gerçek bir sunucu haberi sanıyordu. `watch` için sonuç: sunucunun sınırları (90 sn,
saatte 20) atlanıyor, arkadaşın telefonu saatte 15 dakikaya kadar 1 saniyelik canlı moda
zorlanıyordu (saldırgana daha çok konum, kurbana pil). Telefon haberin kendisine göre davrandığı için
`WATCH_PUSH` kapalıyken de işliyordu. Öteki haberlerle sahte "arkadaşlık isteği", "davet" ya da
ebeveyn bildirimi gösterilebiliyordu.

### Karar

- **Her sunucu haberi imzalı.** `packages/schemas/src/push.ts`'deki bütün türler (arkadaşlık,
  çember, ebeveyn haberleri, `watch`) Ed25519 ile imzalanır. İmza tek yerde atılır: push işçisi, her
  haberi hedef cihaz için mühürlerken (`sealedFor`). Yeni bir haber türü de kendiliğinden imzalanır.
- **Yeni ve ayrı anahtar:** `NOTICE_SIGNING_KEY` (32 bayt) ve `NOTICE_SIGNING_KID`; ikisi birlikte
  ya da hiçbiri. Süs anahtarıyla (`ENTITLEMENT_SIGNING_KEY`) aynı olamaz, sunucu açılmaz. Etiket de
  ayrı: `bargu/v1/server-notice`.
- **Kutunun içi:** `0x02 ‖ len(kid) ‖ kid ‖ issuedAt(8) ‖ id(16) ‖ imza(64) ‖ gövde`.
- **İmzalanan baytlar** (JSON değil, sabit düzen, süs belgesindeki gibi):
  `0x01 (sürüm) ‖ len(kid) ‖ kid ‖ alıcı cihaz kimliği(16) ‖ issuedAt(8, BE, ms) ‖ id(16) ‖ gövde`.
  - **Alıcı cihaz:** üye kendine gelen gerçek bir haberi başkasına yeniden mühürlerse imza tutmaz.
  - **issuedAt:** haberin kendi `ts`'i; ikisi eşit olmalı (tek saat).
  - **id:** her habere 16 rastgele bayt. Telefon gördüğü id'leri tutar, ikinci kez geleni atar.
  - **Gövde:** haberin kanonik JSON'u, en sonda (uzunluğu kalan kısımdır). İmza ham bayt olarak
    kutunun içindedir: Google ve Apple görmez; base64 yazımı olmadığı için QA-28 B-2 türü bir
    "kanonik olmayan karakter" hatası çıkamaz.
- **Telefon bir haberi yalnızca şu durumda kabul eder** (`verifyServerNotice`):
  - `kid` derlemenin güvendiği listede: `EXPO_PUBLIC_NOTICE_KEYS` (`kid:base64url`, virgülle),
    derleme profiline göre (preview staging'inkine, üretim ileride kendi anahtarına güvenir; süs
    anahtarlarıyla aynı düzen, ADR 0025 §2);
  - imza doğru ve bu cihaz için;
  - taze: `watch` en çok 2 dakika (FCM ömrüyle aynı), öteki haberler 1 saat (bugünkü kural);
  - id daha önce görülmemiş.
  - Başka her şey, imzasız haberler dahil, **sessizce** düşer: hata yok, bildirim yok, satır yok,
    arka plan canlı modu açılmaz.
- **iOS bildirim eklentisi** aynı kuralı CryptoKit ile uygular. Güvenilen anahtarları uygulama,
  cihaz bilgisiyle birlikte paylaşılan anahtarlığa yazar; gördüğü id'leri eklenti kendisi tutar.
  APNs hâlâ kapalı; doğruluğu Swift–TypeScript ortak test vektörleri gösterir.
- **Anahtar yoksa** sunucu imzalayamaz: işçi başlarken bir kez uyarır (sır yazmaz) ve haberleri
  imzasız gönderir. Yeni uygulamalar bunları atar, eski uygulamalar bugünkü gibi davranır. Anahtar
  varken işçi başlarken yalnızca açık anahtar satırını (`kid:anahtar`) yazar.
- **Staging anahtarı sunucuda üretilir** (`infra/staging/notice-key.sh`, `apply-pending.sh`
  çağırır): sır yalnızca sunucudaki `.env`'de durur; açık yarısı `notice-public-key.txt`
  dosyasındadır, oradan `apps/mobile/eas.json`'a girer. Kimlik `stg-n1`.
- Üyelerin bildirimleri (varış, dürtme, geç kalma, buluşma) değişmedi: onları zaten üyenin cihazı
  imzalıyor.

### Neden böyle

- **Ayrı anahtar:** süs anahtarı sızarsa yalnızca bedava süs demektir; haber anahtarı ise telefonun
  davranışını (arka plan canlı modu, ebeveyn ekranı) yönetir. Biri ötekini açmamalı.
- **Alıcıya bağlı imza:** üyenin bildirimindeki gibi (yukarıda); yeniden mühürleme işe yaramaz.
- **Sabit bayt düzeni:** JSON'un alan sırasına ve boşluklarına bağlı değil; Swift aynı baytları
  kolayca kurar.
- **id ve tazelik:** haberi yalnızca sunucu imzalayabildiği için tekrar ancak kutuyu ele geçiren
  biri (ör. bildirim servisi ya da tekrar teslim) için anlamlıdır; yine de engellenir.

### Geçiş

- **1. adım (bu dal, hemen):** `packages/crypto` (imza ve doğrulama), sunucunun imzası (anahtar
  varsa), `notice-key.sh`, belgeler. Bu adımın APK'sı imzalı haberi okur ama **hiçbir şey
  denetlemez**: imzasız haberleri bugünkü gibi kabul eder. İstemci seviyesi 4.
- **Eski uygulamalar** (028ab2e ve öncesi) imzalı haberin ilk baytını (0x02) tanımaz; açma kodu
  kendi "geçersiz kutu" hatasını verir, uygulama bunu zaten yakalar: haber sessizce düşer, çökme
  yok. Bu, 028ab2e'deki açma kodunun kopyasıyla (`packages/crypto/test/legacy-app.spec.ts`) ve
  uygulamanın aynı hata yolundan geçen testiyle (`background-push.test.ts`) gösterildi. iOS
  eklentisi içeriksiz yer tutucuyu bırakır. Yani anahtar kurulunca eski APK'lar sunucu haberlerini
  (arkadaşlık isteği, davet, katılım, ebeveyn haberleri, `watch`) almaz; üyelerin bildirimleri
  gelmeye devam eder.
- **Önerilen sıra:** herkes 1. adımın APK'sına geçince anahtar betiği çalışır ve `MIN_CLIENT_LEVEL`
  4 olur; açık anahtar `eas.json`'daki preview profiline girer.
- **2. adım (sonra, anahtar eas.json'a girince):** telefon denetimi (imzasız ve geçersiz haberi
  atma, alıcı, tazelik, tekrar) ve iOS eklentisi. İstemci seviyesi 5. Herkes 2. adımın APK'sına
  geçince `MIN_CLIENT_LEVEL` 5 olur: 1. adımın APK'sı imzasız haberi hâlâ kabul ettiği için açık
  ancak o zaman bütün telefonlarda kapanır. Uygulandı: telefon `background-push.ts` (güvenilen
  anahtarlar `notice-keys.ts`, gördüğü id'ler `push:notices:v1`), iOS `BarguCrypto.swift` ve
  `PushShare.swift`.
- Güvendiği anahtarı olmayan derleme (geliştirme; üretim, Faz 10'a kadar) 2. adımdan sonra bütün
  sunucu haberlerini atar. Yerelde denemek için yerel API'ye bir haber anahtarı, geliştirme
  derlemesine de onun açık yarısı verilir.

### Sonuçlar

- Bir üye artık sunucu adına haber uyduramaz; `watch`'ın sınırları gerçekten sunucunun sınırları
  olur (sahte `watch` canlı modu açmaz).
- Haber kutusu ~100 bayt büyür (dolgulu boyutu 256 baytta kalır; base64 ~410 karakter).
- **Kabul edilen risk:** haber anahtarı sızarsa, sızdıran sunucu adına haber uydurabilir (bugünkü
  durum). Anahtar değiştirilir, eski `kid` uygulamanın listesinden çıkar; süs anahtarı etkilenmez.
- Sunucu (ve yöneticileri) hâlâ haber gönderebilir; bu zaten tehdit modelinde: sunucu yalnızca
  `notice` gönderebilir, "eve vardı" uyduramaz.
