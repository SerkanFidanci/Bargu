# Bargu: Son Durum ve Geliştirme Önerileri

PM, 29.10.2026. Bu rapor üç parçadan oluşur:

1. Son durum: neler bitti, neler bekliyor.
2. Tasarım iyileştirmeleri.
3. Kullanışlılık ve yeni özellik önerileri, öncelik sırasıyla.

Öneriler rakip uygulamalara (Life360, Bump, whoo, Snap Map, Google Maps), kullanıcı şikâyetlerine, 21.10 tarihli UX raporuna ve kodun bugünkü hâline dayanıyor. Hiçbiri henüz yapılmadı; hepsi senin kararını bekliyor.

---

## 1. Son durum

### Bitenler (27–28 Ekim)

| İş                         | Durum                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Mesajlaşma ve anlık hikaye | Bitti. Uçtan uca şifreli, 24 saatte silinir, yalnız kamera; Bildir, Engelle ve topluluk kuralları penceresi var. QA-38 ve 38b geçti       |
| Pil                        | GPS 5 saniyeden 30 saniyeye indi. Uygulama kapalıyken dakikada 12 kez uyanıyordu, artık en çok 1 kez uyanıyor. Ölçüm sende                |
| Alt çubuk                  | Senin çizimin: Çemberler · Mesajlar · ortada + · Mağaza · Ben                                                                             |
| Mağaza                     | Pin süsleri ve Bargu+ tek ekranda                                                                                                         |
| Geçmişte yer adları        | "Bir yerde" yerine "Caferağa, Kadıköy". Ad telefonda bulunur, hiçbir yere gitmez                                                          |
| Hikayeyi görenler          | "N kişi gördü" ve kişiler listesi. PM onayladı, iki şartı kodlanıyor: "Açtığını {ad} görür" uyarısı ve sahte görüntülenmenin engellenmesi |
| Mesaj ekranı               | Instagram DM düzeninde                                                                                                                    |

Son APK: `4f29fe7` (28.10). QA-39 (pil, görenler, yer adları, DM düzeni) şu an test oturumunda.

### Bekleyenler

**Senden (Play'e çıkış için):**

1. bargu.app alan adını al (Spaceship'te ilk yıl yaklaşık 5 $).
2. Play geliştirici hesabını aç (25 $, geliştirici adı "Otenus").
3. 15–20 kapalı test kullanıcısı bul.
4. Pil ölçümünü yap: bir gün normal kullan, sonra Ayarlar → Pil ekranında Bargu'nun payına bak.
5. otenus.com'a iki sayfa eklenecek: kurallar ve çocuk güvenliği. Görev kartı hazır; senin başlatman gerekiyor.
6. Avukat soruları sonraya kaldı: ay yıldız marka, yurt dışına veri aktarımı, istismar bildirimi.

**Kodda:**

- Hikaye görenlerin iki şartı;
- QA-39 bulguları;
- herkes yeni APK'yı kurunca eski sürümleri güncellemeye zorlamak (istemci seviyesi 6).

---

## 2. Tasarım iyileştirmeleri

21.10 UX raporundaki önerilerin çoğu yapıldı:

- kişi kartında "Sessize al";
- Ben sayfası gruplara ayrıldı, her grup kendi ekranında açılıyor;
- "Seni görenler" ekranından çember ayarına geçiş.

Kalanlar ve yeni ekranlarla çıkanlar:

| #   | Öneri                                                                                                                                                                                                                                                                          | Neden                                                                                                                  | Boy   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| T1  | **Renk ve logo uyumu.** Logo lacivert ve turuncu; uygulamanın ana rengi mor (#5B34F2), ikinci rengi turuncu (#FF6A3D). Mesaj baloncukları maviden mora geçiyor. Ya ana rengi logoya yaklaştır (lacivert) ya da logoyu mor tona çek. Mağaza görsellerinden önce karar verilmeli | Mağazada ilk göze çarpan şey simge ile ekran görüntülerinin aynı marka gibi görünmesi                                  | Küçük |
| T2  | **"+" düğmesi hızlı eylem menüsü olsun:** Fotoğraf çek · Arkadaş ekle · Buluşma · Güvendeyim. Ortadaki en büyük düğme en sık işi açmalı                                                                                                                                        | Alt çubuğun ortası en değerli yer                                                                                      | Küçük |
| T3  | **Kişi kartını sadeleştir:** önde 3 ana eylem (Mesaj, Dürt, Yol tarifi), gerisi "Daha fazla" altında                                                                                                                                                                           | Kartta artık 8'e yakın eylem var: mesaj, hikaye, dürt, buluşma, yol, geçmiş, sessize al, profil. Dar ekranda kalabalık | Küçük |
| T4  | **Harita üstünde tek kart kuralı:** izin, buluşma, hatırlatma gibi kartlardan aynı anda yalnız en önemlisi görünsün, yanında "+2" yazsın                                                                                                                                       | UX raporundaki açık risk: kartlar birikince harita küçülüyor                                                           | Küçük |
| T5  | **Hayalet modu tek yerde:** haritadaki kısayol ile Ben'deki ayar aynı üç seçeneği (Kapalı / Dondur / Gizle) aynı adlarla göstersin. Kısayolun yanında kısa bir etiket olsun                                                                                                    | Gizlilikte karışıklık güveni zedeler                                                                                   | Küçük |
| T6  | **İlk kullanım ipuçları:** üç kısa baloncuk, her biri bir kez: "Kişiye uzun bas", "Halka = yeni hikaye", "+ ile hızlı işler"                                                                                                                                                   | Uzun basma menüsü ve hikaye halkası kendiliğinden anlaşılmıyor                                                         | Küçük |
| T7  | **Boş ekranlar:** arkadaşı ya da mesajı olmayan kişiye tek düğmeli davet ("QR ile ekle" ya da "Davet linki gönder")                                                                                                                                                            | Boş harita, yeni kullanıcının bıraktığı ilk yer                                                                        | Küçük |
| T8  | **Yeni ekranlarda koyu tema ve büyük yazı kontrolü:** Mesajlar, Mağaza ve alt çubuk 27–28.10'da yeniden yapıldı                                                                                                                                                                | QA-39 kontrastı kodda denetliyor; telefonda bir bakış yeter                                                            | Küçük |

---

## 3. Kullanışlılık ve yeni özellikler

### Araştırmadan çıkanlar

- **Pil, 1 ve 2 yıldızlı yorumların bir numaralı şikâyeti.** Aile konum uygulamalarının kötü yorumlarının yaklaşık dörtte biri pil hakkında. Kullanıcılar güncelleme sıklığını kendileri seçmek istiyor.
- **Kullanıcının kontrolü elinde tutması önemli.** Life360 Mart 2026'da "süreli konum paylaşımı" çıkardı. Google Maps'te paylaşım zaten süreli.
- **Zenly'nin varisleri sohbeti haritaya bağlıyor.** Bump (Zenly'nin eski ekibi) sohbet, kazıma haritası, varış tahmini ve arkadaşın pili ile hızını sunuyor. whoo "yakındayım, kahve?" tarzı anlık buluşmaları öne çıkarıyor ve gençler arasında çok yaygın.
- **Snap Map 2026'da "sık gidilen yer" rozetleri ekledi.** Bu, sıralama ve rekabet içeriyor. Bizim gizlilik ilkelerimize ve 15–17 kurallarına uymuyor, önermiyorum.

### Öneriler, öncelik sırasıyla

**A. Kapalı testten önce (küçük, hemen değer katar)**

| #   | Özellik                                                                                                                                                                                                                                   | Neden                                                                                                      | Boy        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| Ö1  | **Uygulamadan "Sorun bildir":** Ben → Yardım. Kısa yazı ve isteğe bağlı ekran görüntüsü support@otenus.com'a gider. Uygulama sürümü ve telefon modeli eklenir; konum ve mesaj eklenmez                                                    | Kapalı testte geri bildirimin tek yolu bu olacak. Analitik kitaplık kullanmıyoruz                          | Küçük      |
| Ö2  | **Pil modu seçimi:** Ben → Konum → "Canlı / Dengeli / Pil dostu". Dengeli bugünkü ayar. Pil dostu: GPS yerine Wi-Fi ve baz istasyonu, 2 dakikada bir; biri bakınca yine canlı. Altında "Bugün Bargu GPS'i şu kadar süre kullandı" bilgisi | Bir numaralı şikâyete doğrudan cevap; rakiplerde yok denecek kadar az. ADR 0036 ölçümüyle birlikte yapılır | Orta       |
| Ö3  | **Mesaja ve hikayeye emoji tepki:** çift dokununca ❤️, basılı tutunca 6 emoji. Şifreli küçük bir öğe; 24 saatte silinir                                                                                                                   | Instagram DM'ine benzemesini istedin; en çok eksik hissedilen parça bu. Okundu bilgisi yine yok            | Küçük      |
| Ö4  | **Kullanılabilirlik testi:** 3 kişiye 5 görev ver, sen izle. Görevler: arkadaş ekle; konumu bir çembere gizle; hikaye at; birini engelle; paylaşımı durdur. Plan zaten istiyor (Faz 9B)                                                   | Tasarım sorunlarını en ucuz bulma yolu                                                                     | Senin işin |

**B. Kapalı testin ilk güncellemeleri (orta, ürünü öne çıkarır)**

| #   | Özellik                                                                                                                                                                                                | Neden                                                                                                   | Boy        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------- |
| Ö5  | **Eve vardım kontrolü** (planda Faz 11'de, öne alınsın). "Eve varınca haber ver" ya da "30 dk içinde". Varmazsan ve cevap vermezsen seçtiğin kişilere konum ve pil gider. KADES ve 112'ye kısayol olur | Life360'ın en sevilen güvenlik işi. 15–17 yaşındakiler ve geceleri yalnız dönenler için güçlü bir neden | Orta       |
| Ö6  | **Kişiye süreli paylaşım ve sessiz dondurma** (Faz 11'de). "Bu kişiye 21:30'a kadar göster", "Yalnız bu kişiye dondur"                                                                                 | Life360 ve Google'da var. Bizde çember bazında var, kişi bazında yok                                    | Küçük–orta |
| Ö7  | **Kendi konum geçmişin ve kazıma haritası** (ADR 0030 hazır, onaylı). Gün gün iz, duraklar, gezdiğin yerlerin haritada açılması. Hepsi yalnız telefonda                                                | Zenly ve Bump'ın en sevilen işi; Bargu+ için iyi bir neden. İstediğin bir şeydi                         | Orta       |
| Ö8  | **"Yakındayım" daveti:** tek dokunuşla "Yakındayım, gelir misin?". Yalnız seçtiğin çembere gider, mesafeyi karşının telefonu hesaplar                                                                  | whoo'nun büyüme motoru bu. Bizde buluşma var ama ağır; bu onun tek dokunuşluk hâli                      | Küçük      |

**C. Sonra (büyük ya da yan iş)**

| #   | Özellik                                                                                                                                                                       | Neden                                                                                                             | Boy   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----- |
| Ö9  | **Uygulamasız şifreli konum linki** (Faz 11). Süreli web linki; anahtar linkin içinde, sunucu göremez                                                                         | Uygulaması olmayan anne, baba ya da ev sahibi için; büyüme kanalı                                                 | Büyük |
| Ö10 | **Android ana ekran widget'ı.** 3–4 arkadaşın yüzü ve uzaklığı; dokununca harita açılır                                                                                       | Uygulamayı açmadan bakmak; Life360 ve Bump'ta var                                                                 | Büyük |
| Ö11 | **"Bir aradasınız" anı:** iki arkadaş buluşunca ikisinin telefonunda küçük bir kutlama (Zenly'deki "bump" hissi). Tamamen telefonda hesaplanır. Seri tutma ya da sıralama yok | Zenly hissinin özü                                                                                                | Orta  |
| Ö12 | **Varış tahmini:** kişi kartında "eve 12 dk", buluşmada "4 dk'ya orada"                                                                                                       | Bump'ta var; "nerdesin" sorusunu bitirir                                                                          | Orta  |
| Ö13 | **Sallayarak ekleme**                                                                                                                                                         | Zenly'nin imzası. Ama sunucunun iki kişiyi eşleştirmesi konum ister; Bluetooth ile yapılırsa iş büyür. QR yeterli | Büyük |

### Önermediklerim

- **Seri tutma (streak), sıralama, "en çok gelen" rozetleri:** gençleri baskıya sokar. 15–17 kurallarımız (ADR 0023) davranışa dayalı yönlendirmeyi yasaklıyor.
- **Sesli mesaj:** mikrofon izni gerekir. Bugün mikrofonu bilerek engelliyoruz ve "ses kaydetmez" diyoruz.
- **Galeriden fotoğraf ve video:** "Yalnız o an çekilen" kuralının özü bu; çocuk güvenliği riskini de büyütür.
- **Kaza algılama ve sürüş raporu (Life360 Driver Protect):** büyük iş ve "her zaman konum" izni gerektirir. Bizim işimiz değil.
- **Müzik paylaşımı (Bump'ta var):** Spotify'a bağımlılık ve ek izin gerektirir; değeri küçük.

---

## 4. PM önerisi: sıradaki adım

1. **Hemen** (bir APK, yaklaşık 1–2 gün): T1 renk kararı, T2 + menüsü, T3 kişi kartı, T4 tek kart, T6 ipuçları, Ö1 Sorun bildir ve Ö3 emoji tepki.
2. **Pil ölçümünden sonra:** Ö2 pil modu.
3. **Kapalı test başlayınca:** Ö5 eve vardım, Ö7 kendi geçmişin, Ö6 kişiye süreli paylaşım ve Ö8 yakındayım; her biri ayrı bir güncelleme.
4. **Sonra:** Ö9–Ö13, kapalı test geri bildirimine göre.

**Karar (sahip, 29.10):** "Lacivert turuncu renk geçişleri". T1 lacivert ve turuncu, geçişlerle. 1. maddedeki paket kod oturumuna verildi.

---

## Kaynaklar

- [Life360: Temporary Location Sharing ve 2026 haberleri](https://www.life360.com/blog/category/life360-news/page/2)
- [Life360 pet özellikleri (2026)](https://quantisnow.com/insight/life360-debuts-new-pet-tracker-and-pet-recovery-features-connecting-6240976)
- [Bump uygulama sayfası](https://apps.apple.com/us/app/-/id6471519217), [How Bump works](https://help.bumpmaps.com/en/articles/11420926-how-bump-works)
- [whoo Series A haberi (2026)](https://thebridge.jp/en/2026/06/location-sharing-app-whoo-raises-%c2%a51-1-billion-in-series-a-round-led-by-ntt-docomo-ventures), [whoo App Store](https://apps.apple.com/es/app/id6444837964)
- [Snap Map Place Loyalty rozetleri](https://www.pulse.bot/media/news/snap-maps-new-place-loyalty-badges-will-show-the-spots-you-visit-most-often-df8c80f3-3814-4f66-a71c-497e1f4f336a/)
- [Google Maps konum paylaşımı kısayolu testi](https://www.eweek.com/news/google-maps-hidden-button-location-sharing/), [Google: trip ve gerçek zamanlı konum paylaşımı](https://blog.google/products/maps/share-your-trips-and-real-time-location-google-maps/)
- [Aile konum uygulamaları karşılaştırması ve şikâyet dağılımı](https://unstar.app/blog/life360-find-my-google-glympse-find-my-kids-family-location-apps-ranked-2026)
- [Konum paylaşımında pil ve gizlilik anketleri](https://martech.org/location-paradox-mobile-users-recognize-its-value-but-many-wont-share-it), [Mobile Marketing Magazine](https://mobilemarketingmagazine.com/?p=109114)
- [Zenly'nin bump ve keşif haritası özellikleri](https://techcrunch.com/2022/04/22/how-zenly-made-social-maps-cool-again-and-whats-next)

Not: kaynakların bir kısmı haber toplayıcılar ve karşılaştırma blogları. Sayılar yön göstermek için verildi, kesin değil.
