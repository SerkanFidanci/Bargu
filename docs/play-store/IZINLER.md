# İzinler, Beyanlar, Derecelendirme ve Yaş

Kod kontrolü (2026-10-15): `apps/mobile/app.config.ts`, `src/features/location/tracker.ts`, `src/i18n/locales`.

## 0. Önemli bulgu: arka plan konum izni istenmiyor

Kodda `isAndroidBackgroundLocationEnabled: false`; Android'de `ACCESS_BACKGROUND_LOCATION` **manifeste girmiyor**. Kilitli ekranda paylaşım, **ön plan servisi (konum türü)** ve kalıcı bildirimle (`killServiceOnDestroy: false`) yapılıyor.

Sonuç: Play'de iki ayrı yol var, ikisi için de metin hazırlandı.

| Yol                                                                        | Ne zaman                                                                  | Karar                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Ön plan servisi beyanı** (`FOREGROUND_SERVICE_LOCATION`) + demo video | Her durumda gerekli                                                       | Zorunlu. Play Console → Politika → Uygulama içeriği. Her servis türü için: açıklama, kesilirse kullanıcıya etkisi, demo video bağlantısı. Kullanım amacı kategorisi: **"Arka planda konum güncellemeleri: kullanıcı tarafından başlatılan konum paylaşımı"** ("Find my friend" tipi) [Google](https://support.google.com/googleplay/android-developer/answer/13392821) |
| **B. Arka planda konum beyanı formu**                                      | Google ön plan servisini "arka planda konuma eşdeğer" sayarsa isteyebilir | Hazır dur. Metin §1. Video ≤30 sn, **belirgin açıklama diyaloğunu** göstermeli [Google](https://support.google.com/googleplay/android-developer/answer/9799150)                                                                                                                                                                                                        |

Ek not: Google, hassas konumda (kesin) yeni bir bildirim formunu Kasım 2026'da açıyor; ayrıca 27 Ocak 2027'den itibaren "konum düğmesi" asgari kapsam olarak önerilecek. Takip et.

## 1. Arka planda konum beyanı metni (B yolu; A için de aynı gövde kullanılır)

**Tek özellik (İngilizce, forma yapıştır; Play İngilizce ister):**

```
Core feature: live location sharing with people the user chooses.

Bargu lets a user share their live location with the circles (friends and family) they pick, so those people can see them on a map while the user is walking, travelling or has the phone locked. This is the only feature that uses location. Location is never used for ads, analytics, or sold.

Why it must continue when the app is not in view: a friend who looks at the map expects to see where the user is now, not where the user was when the app was last open. The feature cannot work if updates stop when the screen locks.

How we keep it minimal and transparent:
- The user starts sharing themselves; nothing is shared until they choose circles.
- Android foreground service of type "location" with a persistent notification ("Sharing your location") for the whole time sharing is on.
- The app does not request ACCESS_BACKGROUND_LOCATION; only "while using the app" permission plus the foreground service.
- Per-circle off switch, ghost mode (freeze or hide), precision (exact / neighbourhood / city), time-limited sharing, and a one-tap stop.
- The user sees who can see them at any time and is notified when a new person starts seeing them.
- Location is end-to-end encrypted on the device before it leaves it; the server cannot read it and holds only the encrypted envelope for at most 24 hours.
```

**Kullanıcıya İngilizce prominent disclosure (uygulama içi diyalog):** §2.

## 2. Uygulama içi açıklama ekranı: kodda var mı?

**Güncel (`1a9aba4`, Faz 9 dilim 4):** aşağıdaki eksikler kapandı. Konum izni penceresi artık kendiliğinden açılmıyor; haritadaki kart §2'deki metni "Devam et / Şimdi değil" düğmeleriyle gösteriyor. Aşağısı ilk incelemedeki durumdur.

**Var, ama eksik.** `location.permission` ekranı (`en.json`/`tr.json`) sistem izin penceresinden önce gösteriliyor:

> "Location permission needed — So your friends can see you on the map. Your location is encrypted on your phone; not even our server can see it." [Allow]

Eksikler (Play "belirgin açıklama" ölçütü için kod oturumu işi K10):

1. Paylaşımın **uygulama kapalıyken / ekran kilitliyken de** sürdüğü yazmıyor.
2. Kalıcı bildirimin neden durduğu ve nasıl durdurulacağı yazmıyor.
3. Verinin ne için kullanıldığı net "yalnızca çemberlerinle paylaşım" diye yazılmalı; "Kabul et / Şimdi değil" düğmesi ayrı olmalı.

**Önerilen metin (TR / EN):**

- Başlık: `Konumunu çemberlerinle paylaş` / `Share your location with your circles`
- Gövde TR: _"Bargu, seçtiğin kişiler seni haritada görebilsin diye konumunu kullanır. Paylaşım açıkken, uygulama kapalı ya da ekran kilitliyken de sürer; bu sırada bildirim çubuğunda 'Konumun paylaşılıyor' bildirimi durur. Konumun telefonunda şifrelenir; Bargu sunucusu bile göremez. Hayalet modu ya da çemberi kapatarak her an durdurabilirsin. Konumun reklam ya da başka amaçla kullanılmaz."_
- Gövde EN: _"Bargu uses your location so the people you choose can see you on the map. While sharing is on, it continues when the app is closed or the screen is locked, and a 'Sharing your location' notification stays in your notification bar. Your location is encrypted on your phone; not even Bargu's server can see it. You can stop at any time with ghost mode or by turning a circle off. Your location is never used for ads or anything else."_
- Düğmeler: `Devam et` / `Şimdi değil`. Devam'dan sonra sistem penceresi.

iOS tarafı için (sonra): `NSLocationAlwaysAndWhenInUseUsageDescription` metni `native-locales` içinde zaten var.

## 3. Konum izinleri (Android)

| İzin                                                         | Durum                              | Not                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_FINE_LOCATION`                                       | İsteniyor ("kullanırken")          | Harita ve canlı konum için. Kullanıcı yalnızca "yaklaşık" verirse çalışır ama ince hassasiyet kaybolur. Play'e: "Tam konum gerekli çünkü arkadaşlar sokak düzeyinde görür; kullanıcı hassasiyeti mahalle/şehre düşürebilir" |
| `ACCESS_COARSE_LOCATION`                                     | İsteniyor                          |                                                                                                                                                                                                                             |
| `ACCESS_BACKGROUND_LOCATION`                                 | **İstenmiyor**                     | Kodla doğrulandı. Manifest birleşiminde bir kitaplık ekliyorsa AAB'ye bak (`aapt dump permissions`) — kod oturumu K3 kontrolü                                                                                               |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`          | Gerekli                            | Beyan: §0 yol A                                                                                                                                                                                                             |
| `POST_NOTIFICATIONS`                                         | Android 13+ çalışma anı izni       | Arkadaş bildirimi, dürtme, varış için; reddedilirse uygulama çalışır, bildirim gelmez. Bağlamda iste (ilk çember/yer)                                                                                                       |
| `CAMERA`                                                     | QR okuma                           | Mikrofon engelli, kayıt yok                                                                                                                                                                                                 |
| `READ_MEDIA_IMAGES`                                          | Gerekmez                           | Android 13+ sistem fotoğraf seçici izinsiz                                                                                                                                                                                  |
| `RECORD_AUDIO`                                               | **Engelli** (`blockedPermissions`) |                                                                                                                                                                                                                             |
| `INTERNET`, `VIBRATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED` | Kitaplıklardan gelir, olağan       |                                                                                                                                                                                                                             |

Yayından önce AAB'nin birleşik manifestosundan gerçek izin listesi çıkar ve bu tabloyla karşılaştır.

## 4. 30 saniyelik demo video senaryosu (ön plan servisi / arka plan beyanı)

Kayıt: Android telefon, ekran kaydı, dikey, sessiz ya da kısa altyazı, **İngilizce arayüz**. YouTube'a "liste dışı" yükle, bağlantıyı forma yaz. Demo hesabı, sahte konum, gerçek kişi yok.

| Süre     | Ne gösterilir                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–4 sn   | Bargu ana harita; başlık altyazısı "Live location sharing with chosen circles"                                                                    |
| 4–9 sn   | Çember ayarı: "Share my location" aç; **uygulama içi açıklama diyaloğu** tam görünsün (§2 metni), "Continue"                                      |
| 9–13 sn  | Sistem konum izin penceresi: "While using the app" seç                                                                                            |
| 13–17 sn | Paylaşım başlar; bildirim çubuğu aşağı çekilir: "Sharing your location" kalıcı bildirimi görünür                                                  |
| 17–22 sn | Ana ekrana çık (Bargu arka planda), ekranı kilitle, tekrar aç; ikinci telefon/emülatörde arkadaşın haritasında konumun güncellendiği (kısa kesit) |
| 22–27 sn | Bargu'yu aç: "Who can see me" ekranı; ghost mode ile paylaşımı durdur, bildirim kaybolur                                                          |
| 27–30 sn | Kapanış altyazısı: "Only the user's chosen circles see the location; end-to-end encrypted."                                                       |

Kural: video 30 sn'yi geçmesin; açıklama diyaloğu ve bildirimi mutlaka göstersin.

## 5. Hedef kitle, yaş ve içerik derecelendirme

### Hedef kitle (Console "Hedef kitle ve içerik")

**Karar (proje sahibi, PM aktardı): yaş sınırı 15+.** 15–18 yaş kuralları, yaş doğrulama (e-Devlet yaş belirteci), kapalı varsayılanlar, ebeveyn araçları ve ücretli işlemleri engelleme Faz 9'da tasarlanacak. Hukuki arka plan: `docs/arastirma/yas-siniri-ve-kvkk.md`.

Play'in yaş grupları: 5 ve altı, 6–8, 9–12, **13–15**, **16–17**, **18+**. "15+" diye grup yok.

| Seçenek                | Console'da                                                                                 | Değerlendirme                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Öneri: 16–17 + 18+** | Yalnızca bu iki grubu işaretle; uygulama içinde ve koşullarda "15 yaş altı kullanamaz" yaz | Play'de 13–15 işaretlenmez, böylece 13–14 yaşı hedeflemiş görünmeyiz. 15 yaşındaki kullanıcı uygulama içi kuralla kabul edilir; Console'a yansımayan tek fark bu. En yakın ve en güvenli yaklaşım |
| 13–15 + 16–17 + 18+    | Üç grup                                                                                    | 13–14 yaşı da "hedef" olur; yönetmelik (15 altı) ve Play'in çocuk beklentileriyle çelişir. **Seçme**                                                                                              |
| Yalnızca 18+           | Tek grup                                                                                   | En az sürtünme ama 15–17 yaş kararıyla (Faz 9) uyuşmaz; ilk sürümde 15–17 kullanıcı alınmayacaksa geçici seçenek                                                                                  |

Kesin yorum Play Console'da hedef kitle sihirbazı çıktısına göre netleşir: 16–17 işaretlendiğinde Play ek sorular sorar (uygulama çocuklara çekici mi vb.); cevap "hayır" olmalı. **Yaş doğrulama Faz 9'a kadar yok:** ilk kapalı testte testçilerin 15+ olduğundan emin ol; uygulama içinde doğum yılı/yaş beyanı ve koşullarda 15+ ibaresi ilk sürüm için asgaridir (K14: kod oturumu; kapsamı Faz 9 belirler). Sürümde yaş denetimi yetersizse Play ya da yönetmelik açısından risk sahibin: Faz 9 bitmeden herkese açık üretimi geciktirmek avukat ve PM kararı.

### İçerik derecelendirme anketi (IARC) — taslak cevaplar

Kategori: **Sosyal / İletişim**. Anket bölümleri:

| Soru                                                        | Cevap                                                                                                                                               | Not                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Şiddet, kan, korku, cinsel içerik, küfür, kumar, uyuşturucu | **Hayır**                                                                                                                                           | Uygulama içerik üretmez, yalnızca konum      |
| Kullanıcılar birbirleriyle iletişim kurabilir mi?           | **Evet**, ama yalnızca konum/dürtme/etkinlik planı; serbest metin sohbet **yok** (doğrula)                                                          | Sohbet eklenirse güncelle                    |
| Kullanıcılar içerik paylaşabilir mi?                        | Sınırlı: profil fotoğrafı (şifreli, yalnızca güvenilen arkadaşlar), çember/etkinlik adları                                                          | Herkese açık yok                             |
| Kullanıcı konumu paylaşılıyor mu?                           | **Evet** (kullanıcı seçtiği kişilere)                                                                                                               | IARC "konum paylaşımı" sorusu varsa evet     |
| Kullanıcılar tanımadıkları kişilerle etkileşebilir mi?      | **Hayır**, yalnızca QR/davet ile karşılıklı eklenen kişiler. Kullanıcı adı ile bulunma var: arkadaşlık isteği onay gerektirir (DURUM.md kontrol et) | Cevabı arkadaş-ekleme akışına göre netleştir |
| Dijital satın alma                                          | Şimdilik **hayır**; Bargu+ gelince **evet**                                                                                                         |                                              |
| Web'e erişim / dış bağlantılar                              | Hayır (uygulama içi tarayıcı yok)                                                                                                                   |                                              |

Beklenen sonuç: PEGI 3 / ESRB Everyone benzeri, ancak "kullanıcı etkileşimi + konum paylaşımı" bildirimi görünür. Türkiye için IARC: genelde "3+" ve etkileşim/konum uyarısı; 15+ (Play'de 16–17 + 18+) hedef kitle ile çelişmez.

## 6. Gönderim öncesi son kontrol

- Manifest izin listesi bu belgeyle aynı mı?
- Açıklama ekranı güncellendi mi (K10)?
- Demo video yüklendi, bağlantı açık mı?
- Hedef kitle kararı yazıldı mı?
