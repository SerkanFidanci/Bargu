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
