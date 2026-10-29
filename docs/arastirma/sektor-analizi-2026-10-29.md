# Bargu: Sektör Analizi (Ekim 2026)

Araştırma oturumu, 29.10.2026. PM için. Kod yazılmadı, commit edilmedi.

**Okuma notu**

- Her bilginin sonunda `[K#]` var. Kaynak listesi en altta. Her kaynağın yanında "okundu" (sayfa açıldı) ya da "özet" (yalnız arama özeti okundu) yazıyor.
- life360.com ve birkaç site 403 verdi; zorlanmadı. Life360 bilgileri yatırımcı bildirileri, haber siteleri ve üçüncü taraf yorumlardan geldi.
- "Doğrulanamadı": kaynaklar çelişiyor ya da tek zayıf kaynak var. "Bulunamadı": aradım, çıkmadı.
- Dövizi TL'ye çevirmedim. Kur uydurmamak için.

---

## 1. Kısa özet

1. **Life360 büyüyor, ama yönü reklam.** 2026 ikinci çeyrekte yaklaşık 102 milyon aylık kullanıcı, 3,2 milyon ücretli çember. Reklam geliri çeyrekte 22 M$ (yıllık +%315); Ocak 2026'da reklam şirketi Nativo'yu aldı [K1, K4]. Bargu'nun "reklam yok, veri satmayız, sunucu konumu göremez" vaadi tam bu boşlukta duruyor.
2. **Life360'ın 2025–26 yenilikleri aile ve güvenlik odaklı:** "Varmadı" uyarısı (Ağu 2025), evcil hayvan GPS'i (Eki 2025), linkle geçici konum paylaşımı (Mar 2026), Uber ile genç yolculuğu (Haz 2026). Yapay zekâ yalnız plan aşamasında; çıkmış ürün bulunamadı [K6, K8–K11].
3. **Zenly'nin gerçek halefleri Bump ve whoo; ikisi de büyük.** Bump: Android'de 10M+ kurulum, 4,8 yıldız, Türkçe var. whoo: 35M+ indirme, Haziran 2026'da 8,5 M$ yatırım. İkisinde de uçtan uca şifreleme iddiası bulunamadı [K17–K21].
4. **"Bize benzer" şifreli uygulamalar var ama hepsi çok küçük:** Starling, Find Family, XCoord, Where, Fenzly. Çoğu 2026'da çıktı, tek geliştiricili, bağımsız denetimi yok, kullanıcı sayısı bulunamadı [K22–K27]. Büyük ve şifreli yeni bir rakip bulunamadı.
5. **Büyük platformlar güvenlik özelliklerini eşitledi.** Snap varış bildirimi (Şub 2026), Google Find Hub konum bildirimi (May 2026), Apple iOS 27'de kişi bazlı sessiz gizleme ve özel süre. "Eve vardım", süreli link ve kişiye özel gizleme artık beklenen özellik [K28, K33, K35, K36].
6. **Türkiye:** pazar payı verisi bulunamadı, yerli rakip bulunamadı. Life360 için Türkçe şikâyetler: operatör faturasından istenmeyen yenileme, iptal edilemeyen abonelik, yanlış ya da donmuş konum [K16].
7. **Bargu'nun dürüst açığı:** kullanıcı yok, Play'de değil, iOS yok. Bump, whoo, Snap ve Instagram Harita ücretsiz; Bargu'da 21 günden sonra gruptan biri ödemek zorunda. Bu sürtünme henüz ölçülmedi.
8. **Öneri:** 6 yeni fikir (N1–N6). İlk üçü küçük ve güven kuran işler: eski konumu dürüstçe göstermek, "sunucu ne görür?" ekranı, güvenli abonelik. Ayrıca Ö5, Ö9 ve Ö6'nın öne alınması için somut gerekçe var (bölüm 6).

---

## 2. Rakip tablosu

| Uygulama                             | Yeni özellikler (tarihli)                                                                                                                                                                                                                                                                                                                                                                  | Fiyat                                                                                                                                             | Şifreleme                                                                                           | Para modeli                                                                  | Zayıf yanı                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Life360**                          | Linkle geçici paylaşım: 1/4/8 saat ya da gün sonu, alıcıda uygulama gerekmez (30.03.2026) [K6]. Uber ile genç yolculuğu (duyuru 17.02, canlı 18.06.2026, seçili pazarlar) [K9]. "Varmadı" uyarısı (20.08.2025) [K8]. Pet GPS (22.10.2025), evcil bakım (25.08.2026) [K10]. Konuma dayalı reklam (Place Ads, 12.06.2025) [K3]. Nativo alımı (Ocak 2026) [K4]. Yapay zekâ: yalnız plan [K11] | Free, Silver, Gold, Platinum. ABD: Gold ~14,99–16,99 $, Platinum ~24,99 $/ay (kaynaklar çelişiyor, doğrulanamadı). **TL fiyatı bulunamadı** [K12] | Şifreleme iddiası bulunamadı                                                                        | Abonelik + reklam + veri lisanslama. Q2 2026 gelir 159 M$, reklam 22 M$ [K1] | Pil, donan ya da yanlış konum, paywall, "takip hissi" [K13–K15]. Veri satışı geçmişi [K5]. Türkiye'de abonelik şikâyeti [K16]                         |
| **Bump** (amo, Zenly'nin eski ekibi) | Konum, pil, hız, süre; sohbet; kazıma haritası ve yarış; sallayarak "bump"; müzik; ETA ve Uber; widget; hayalet modu [K17, K18]. Android çıkışı 19.04.2024 [K19]                                                                                                                                                                                                                           | Ücretsiz. "Bump Club" uygulama içi 1,99 / 3,99 / 24,99 $ [K17]                                                                                    | İddia bulunamadı. Mağaza etiketinde kesin konum ve telefon no "sana bağlı" [K17]                    | Ücretsiz + uygulama içi satın alma                                           | Telefon no ister; profil herkese açık; yerlerde herkese açık "sık gelenler" sıralaması [K18]. ~10M+ Android kurulum, ~1,2M aylık aktif (tahmin) [K19] |
| **whoo** (LinQ, Japonya)             | Aralık 2022 çıkış; 35M+ indirme (Nis 2026); 170+ ülke; ¥1,1 mlr / 8,46 M$ A turu (08.06.2026); Endonezya, Tayvan, Vietnam'a açılıyor. Konum, pil, hareket geçmişi, rota ve süre, sohbet [K20, K21]                                                                                                                                                                                         | Bulunamadı                                                                                                                                        | Bulunamadı                                                                                          | Açıklanmamış [K20]                                                           | Türkiye'de var mı doğrulanamadı                                                                                                                       |
| **Küçük şifreli grup**               | Starling (Android, ilk commit 31.08.2026, v0.21.0 15.10.2026, SOS + check-in) [K22, K23]. Find Family (Android, v2.6.10 25.10.2026, geçici paylaşım, yerler, UWB) [K24]. XCoord (iOS, 1.0.0 14 Mayıs [2026], 1–15 gün sonra silinen grup) [K25]. Where (iOS, Mayıs 2026) [K26]. Fenzly (politika 15.06.2026, mağaza doğrulanamadı) [K27]                                                   | Hepsi ücretsiz görünüyor; XCoord reklamlı (AdMob)                                                                                                 | Hepsi kendi beyanı: AES-256-GCM; Starling anahtarı linkin `#` kısmında. Bağımsız denetim bulunamadı | Bulunamadı                                                                   | Küçük, tek geliştirici, denetimsiz. Sohbet ve hikaye bulunamadı. Kullanıcı sayısı bulunamadı                                                          |
| **Snap Map**                         | Varış bildirimi (09.02.2026), Home Safe (Tem 2025) [K28]. Place Loyalty rozetleri (Nis 2026) [K29]. Promoted Places reklamı (tarih belirsiz) [K30]                                                                                                                                                                                                                                         | Ücretsiz                                                                                                                                          | İddia bulunamadı                                                                                    | Reklam                                                                       | Sıralama ve rozet; yabancılara açık keşif                                                                                                             |
| **Instagram Harita**                 | 06.08.2025, ABD. Son aktif konum, uygulama açılınca güncellenir. Arkadaş / yakın arkadaş / özel liste / kimse. Denetimli genç hesapta ebeveyne bildirim [K31]                                                                                                                                                                                                                              | Ücretsiz                                                                                                                                          | İddia bulunamadı                                                                                    | Meta reklamı                                                                 | Canlı değil. Türkiye'de açık mı doğrulanamadı [K32]                                                                                                   |
| **Apple Find My**                    | iOS 27 (WWDC Haz 2026): kişi bazlı "Konumu gizle"; karşı taraf bildirim almaz, "Konum bulunamadı" görür. Özel süre ya da tarih. Watch'tan paylaşım [K33]. Yayın durumu kaynakta belirtilmemiş                                                                                                                                                                                              | Cihazla gelir                                                                                                                                     | Find My ağı uçtan uca şifreli (Apple). Arkadaş paylaşımı için doğrulanamadı [K34]                   | Cihaz satışı                                                                 | Yalnız Apple; Android arkadaşla çalışmaz                                                                                                              |
| **Google**                           | Messages'ta canlı konum (Mar 2026) [K35]. Find Hub: kişi bir yere varınca ya da ayrılınca bildirim (18.05.2026) [K36]. Bagaj linki (Mar 2026) [K37]                                                                                                                                                                                                                                        | Ücretsiz                                                                                                                                          | Find Hub ağı şifreli, Google bile göremez (ikincil kaynak). Paylaşım için doğrulanamadı [K37]       | Platform                                                                     | Sosyal katman yok. Google Maps paylaşımında 2026 yeniliği bulunamadı                                                                                  |
| **WhatsApp**                         | Canlı konum 2017'den beri; süreli; 2026'da yenilik bulunamadı [K38]                                                                                                                                                                                                                                                                                                                        | Ücretsiz                                                                                                                                          | Uçtan uca (WhatsApp'a göre) [K38]                                                                   | Meta                                                                         | Sohbetin içinde; çember ve kalıcı harita yok                                                                                                          |

---

## 3. Türkiye pazarı

- **Pazar payı verisi bulunamadı.** Sensor Tower gibi ücretli bir kaynak gerekir. Türkçe karşılaştırma yazıları (çoğu ticari rakip siteleri) en çok Google Haritalar, WhatsApp canlı konum, iPhone "Konumumu Paylaş" ve Life360'ı sayıyor [K39]. Kanıt zayıf.
- **Yerli konum paylaşım uygulaması bulunamadı.**
- **Life360 Türkiye şikâyetleri** (Şikayetvar) [K16]:
  - Turkcell hattından 169,99 TL'lik yenileme "onaysız" alındı (31 Temmuz, yıl yazmıyor).
  - Gold abonelik iptal edilemedi, iade istendi (18.10.2025).
  - Ayda iki kez kesinti şikâyeti (08.02.2024).
  - Konum yanlış ya da güncellenmiyor (Ekim 2025 dahil birkaç şikâyet).
  - "Türkiye operatör seçeneği yok", şifre sıfırlanamadı (10.08.2025).
  - Sayı küçük, tek site; yön gösterir, oran değil.
- **Bump'ın Türkçe arayüzü var** (App Store, 30+ dil) [K17]. whoo ve Instagram Harita'nın Türkiye durumu doğrulanamadı. Hürriyet, Instagram Harita'yı Türkçe menü adlarıyla anlatıyor ama "Türkiye'de açıldı" demiyor [K32].
- **Hukuk (plan notu):** 15 yaş altı yönetmeliği 1 Kasım 2026'da yürürlükte; Bargu zaten 15+ (BARGU_PLAN Faz 9).

---

## 4. Bargu nerede önde

1. **Sunucu konumu görmüyor ve bu iddia mimaride duruyor.** Canlı konum Redis'te yalnız şifreli zarf, en çok 24 saat (BARGU_PLAN Bölüm 1; MAGAZA-METNI). Rakipler: Life360'ın çeyrekte 22 M$ reklam geliri var, konuma dayalı reklam satıyor [K1, K3]. Bump'ın mağaza etiketinde kesin konum kullanıcıya bağlı [K17]. Bump, whoo, Snap ve Instagram için şifreleme iddiası bulunamadı. WhatsApp ve Apple'ın Find My ağı istisna [K34, K38].
2. **Reklam yok, veri satışı yok, kural olarak.** Life360 geçmişte hassas konum verisini veri simsarlarına sattı (2021), sonra durduğunu açıkladı, Arity'ye satmaya devam ediyor [K5]. Snap Promoted Places ile reklam gösteriyor [K30]. XCoord reklamlı [K25]. Not: Life360 18 yaş altı verisini reklam hedeflemeden çıkardığını ve hastane, okul, ibadethaneyi hedeflemediğini söylüyor [K3]; bu kendi beyanı.
3. **Telefon numarası ve rehber istemiyor** (QR, kullanıcı adı, davet linki). Bump'ın etiketinde telefon numarası "sana bağlı" [K17].
4. **Şeffaflık hep açık:** "Beni kimler görüyor", yeni izleyici bildirimi, 7 günlük hatırlatma, tek dokunuşla tümünü durdur. Güvenlik ve gizlilik özellikleri ücretsiz kalıyor (BARGU_PLAN Faz 9B tablosu).
5. **Harita kendi sunucusunda.** Konum (harita bakışı) üçüncü tarafa gitmiyor. Rakipte bulunamadı: Bump rota için Apple Maps ve Uber'e gidiyor [K17]; Starling OpenStreetMap karosu çekiyor [K22].
6. **Şifreli sosyal paket:** sohbet, 24 saatte silinen hikaye, etkinlik çemberi, buluşma planı, hepsi uçtan uca (MAGAZA-METNI). Küçük şifreli rakiplerde sohbet ve hikaye bulunamadı; Bump ve whoo'da sohbet var, şifreleme iddiası yok.
7. **Yerel uyum:** Türkçe, KVKK'ya göre amaç başına rıza, 15+ kuralı, ₺99,99 fiyat. Life360'ın Türkiye'de operatör ve abonelik şikâyetleri var [K16].
8. **Sade fiyat:** tek paket (Bargu+), Life360'ın dört kademesine karşı [K12]. Not: Life360 de çember başına ücret alıyor ("paying circle"), yani "kuran öder" fikri yeni bir üstünlük değil; üstünlük sadeliği.

---

## 5. Bargu nerede geride ya da eksik

1. **Kullanıcı ve ağ etkisi yok.** Life360 ~102M, whoo 35M+ indirme, Bump 10M+ Android kurulum. Konum paylaşımı arkadaşın da kurmasıyla işe yarar.
2. **Henüz Play'de değil, iOS yok.** Rakiplerin hepsi iki platformda. Snap ve Instagram gençlerin telefonunda zaten kurulu.
3. **Ücretli duvar, ücretsiz rakiplere karşı.** Bump, whoo, Snap Map, Instagram Harita ücretsiz. Bargu'da davetle girmek bedava, ama 21 günlük deneme bitince çemberde bir ödeyen gerekir. Arkadaş grubunda "kim ödeyecek?" sürtünmesi olabilir. Veri yok; kapalı testte ölçülmeli.
4. **"Eve vardım / varmadı" üç rakipte çıktı:** Life360 (Ağu 2025), Snap (Şub 2026), Google Find Hub (May 2026). Bargu'da "vardı" bildirimi var (Yerler), "varmadı" uyarısı Paket C'de ve kodlanmadı.
5. **Uygulamasız süreli link:** Life360 (Mar 2026), Google Messages (Mar 2026), WhatsApp (2017) sunuyor. Bargu'da Ö9 Paket E'de. Yeni kullanıcı kazanmanın en kolay yolu şu an rakiplerde.
6. **Kişiye özel gizleme:** Apple iOS 27 kişi bazlı gizleme ve özel süre getiriyor [K33]. Bargu'da çember bazlı; Ö6 yalnız arkadaşlıklarda, grupta v2 fikri.
7. **Widget yok** (Bump'ta var [K17]); Ö10 Paket F'de.
8. **Zenly hissi katmanı eksik:** Bump'ta müzik, sallama, ETA ve kazıma yarışı var. Bargu'da kazıma haritası bayrakla kapalı, varış tahmini Paket D'de.
9. **Pil kanıtı yok.** Life360'ın 1–3 yıldız yorumlarının yaklaşık %23'ü pil (üçüncü taraf analiz, doğrulanamadı) [K13]. Bargu'nun ölçümü sahipte bekliyor; Ö2 buna bağlı.
10. **Hesap başına tek cihaz;** Apple'ın Watch paylaşımı gibi çoklu cihaz yok.
11. **15 yaş altı kapalı.** Bump 13+ [K17]; Life360'ın Uber entegrasyonunda genç hesabı 13–17 [K9]. Bu bilinçli (Türkiye yönetmeliği) ama küçük çocuklu aile pazarını dışarıda bırakıyor.
12. **Kayıt sürtünmesi:** e-posta + geçiş anahtarı. Küçük şifreli rakipler hesapsız (Starling, Find Family, XCoord) [K22, K24, K25]. Yaş doğrulama ve KVKK için hesap gerekli; bilinçli ödün.

---

## 6. "Daha iyi olmak için" önerileri

### 6.1 Mevcut fikirlere bağlantı (Ö1–Ö13 tekrar edilmedi)

| Fikir                                   | Bulgu                                                                                                                           | Öneri                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ö5 Eve vardım** (Paket C)             | Üç rakip 12 ayda çıkardı; artık eşitlik işi [K8, K28, K36]                                                                      | **Öne alınsın.** Paket D'den önce yapılabilir. Bargu'nun farkı "mühürlü emanet": sunucu uyarıyı açamaz. Snap'ten ders: tek seferlik ve tekrarlı seçenek, tek seferlik uyarı 24 saatte kendiliğinden kapanır [K28]. Life360'tan ders: uyarıdan önce birkaç dakikalık ek süre [K8] |
| **Ö9 Şifreli link** (Paket E)           | Life360 ve Google Mart 2026'da çıkardı. Life360 süreleri: 1/4/8 saat, gün sonu [K6]. Starling'in anahtarı da `#` kısmında [K22] | **Öne alınsın.** Etkinlik çemberine de link ver (festival, gezi: herkes kurmayabilir)                                                                                                                                                                                            |
| **Ö6 Kişiye süreli paylaşım** (Paket B) | Apple iOS 27 aynı şeyi sessiz gizleme ile getiriyor [K33]                                                                       | Ö6 doğru yönde. BARGU_PLAN Bölüm 8'deki "grupta kişiye özel paylaşım" v2'den öne alınabilir (kripto tasarımı gerekir; PM kararı)                                                                                                                                                 |
| **Ö2 Pil modu**                         | Pil, Life360 şikâyetinde 1 numara [K13–K15]                                                                                     | Ölçümü yayınla ("Bu hafta Bargu pilin %X'ini kullandı") ve mağaza metnine kanıt olarak koy                                                                                                                                                                                       |
| **Ö10 Widget**                          | Bump'ta var [K17]                                                                                                               | Değişmedi                                                                                                                                                                                                                                                                        |
| **Ö12 Varış tahmini**                   | Bump ETA'sı Apple Maps ve Uber'e dayanıyor [K17]                                                                                | Bargu'nun telefonda yaklaşık hesabı üçüncü tarafa konum vermiyor; bunu söyle                                                                                                                                                                                                     |
| **Ö7, Ö11**                             | Bump kazıma haritasında yarış ve herkese açık sıralama var [K18]                                                                | Bargu'da yarış yok, bu doğru; "yarışsız kazıma haritası" olarak anlat                                                                                                                                                                                                            |
| **Ö8 Yakındayım**                       | whoo'nun büyüme motoru                                                                                                          | Değişmedi                                                                                                                                                                                                                                                                        |

### 6.2 Yeni fikirler (öncelik sırasıyla)

**Öncelik 1: küçük işler, kapalı test sırasında ya da hemen sonra**

**N1. Eski konumu dürüstçe göster, pil bitmeden son konumu bırak**

- _Ne:_ Her kişide "3 dk önce" gibi tazelik etiketi. Eskiyince neden olabileceği: "2 sa önce, telefon kapalı ya da internetsiz olabilir". Pil çok düşünce (örn. %5) telefon şifreli son konumu bir kez gönderir; çemberde "pili bitmek üzereydi" yazar.
- _Kime karşı:_ Life360. "Konum donuyor, evdeyken başka yerde görünüyorum" bir numaralı şikâyetlerden [K14, K16].
- _Fayda:_ "Nerede bu çocuk?" paniğini azaltır. Ö5'in yanlış alarmını da azaltır (eski veriyle "varmadı" dememek için).
- _Kurallara uyum:_ Tamam. Etiket gelen olaydan hesaplanır, polling değil. Yeni izin yok. Son konum yine şifreli.
- _Boy:_ küçük (etiket), küçük–orta (pilde son konum).
- _Risk:_ Android pil kritikken arka planı kısıtlayabilir; "garanti" değil "olabilir" diye yaz.

**N2. "Sunucu benim hakkımda ne biliyor?" ekranı**

- _Ne:_ Ben → Gizlilik altında tek ekran. "Görür": e-posta, hangi çemberlerde olduğun, güncelleme sıklığı, push token. "Göremez": konum, mesaj, fotoğraf, yer adları, geçmiş. Altında güvenlik numarası kısayolu (zaten var).
- _Kime karşı:_ Life360 (reklam geliri ve politikada "hassas veriyi satabiliriz" cümlesi; haber aktarımı, politikayı kendim doğrulamadım) [K4]. Bump (etikette kesin konum "sana bağlı") [K17].
- _Fayda:_ "Bargu bile konumunu göremez" vaadini abartısız, kanıtlı gösterir. Kabul edilen metadata sızıntısını açıkça söylemek güven yaratır.
- _Kurallara uyum:_ Tam. THREAT_MODEL'deki "kabul edilen sızıntı" dilini kullanır.
- _Boy:_ küçük.
- _Risk:_ Yanlış ya da eksik cümle hukuki risk. Metni test oturumu kodla karşılaştırsın.

**N3. Güvenli abonelik**

- _Ne:_ Satın alma ekranında fiyat ve yenileme tarihi açık. Yenilemeden 3 gün önce hatırlatma (planda yalnız deneme sonu için var). Bargu+ ekranında "Aboneliği yönet" ile tek dokunuşla Play abonelik sayfası. Operatör faturası ödemesinin açık olup olmadığı Play Console'dan kontrol edilsin (bu raporda doğrulanamadı).
- _Kime karşı:_ Life360 Türkiye şikâyetleri: onaysız yenileme, iptal edilemeyen abonelik [K16].
- _Fayda:_ Güven ve düşük iade/şikâyet. Mağaza yorumlarında en kolay kaçınılabilir kötü yorum.
- _Kurallara uyum:_ Tam. Tek paket Bargu+ aynen. 15–17 yaşta ebeveyn onayı değişmez (ADR 0023).
- _Boy:_ küçük.
- _Risk:_ Düşük. Play abonelik politikasının güncel şartları kontrol listesinde (KONTROL-LISTESI.md) doğrulanmalı.

**Öncelik 2: orta/büyük, açık yayından önce**

**N4. Yoklama: "Herkes yerinde mi?"**

- _Ne:_ Etkinlik çemberinde sahip tek dokunuşla yoklama başlatır. Üyeler tek dokunuşla "Buradayım" der. Sahip kimin cevap vermediğini görür. 10 dakika sonra kapanır. Cevap şifreli küçük bir öğedir (Ö8 ve Ö5 ile aynı türden).
- _Kime karşı:_ Life360'ın "Geçici Çember" özelliği [K7]. Gezi, kamp ve konser grupları için aile uygulaması zayıf kalıyor. Bargu'nun etkinlik paketi (Faz 11) için doğal bir özellik. Türkiye'de afet sonrası "iyiyim" demek için de kullanılabilir (bu bağ araştırmadan çıkmadı, ürün çıkarımı; Bargu acil servis değildir).
- _Fayda:_ "Herkes otobüste mi?" sorusunu çözer. Konum paylaşmadan çalışır.
- _Kurallara uyum:_ Sunucu düz veri görmez. 15–17 için yalnız en çok 8 üyeli çemberlerde (ADR 0037 ile aynı kural). Yalnız sahip başlatır; baskı aracı olmasın.
- _Boy:_ orta. _Risk:_ bildirim yağmuru; ADR gerekir.

**N5. Bağımsız güvenlik denetimi ve açık belge**

- _Ne:_ `packages/crypto` ve protokol belgesini herkese açık yayınla. Bağımsız bir denetçiden kısa rapor al. Mağaza metnine "denetlendi" ancak rapor çıkınca yazılır.
- _Kime karşı:_ Starling ve Find Family açık kaynak ama denetimsiz; Privacy Guides forumunda "denetim bekleyin" deniyor (02.10.2026) [K23]. Life360 ve Bump'ta böyle bir şey yok.
- _Fayda:_ "Bargu bile görmez" iddiasının tek kalıcı kanıtı. Play'in Veri Güvenliği formundaki bağımsız güvenlik incelemesi etiketi buna bağlanabilir (bu satır benim önceki bilgim; araştırmada doğrulanmadı).
- _Kurallara uyum:_ Kod yazılmaz, yeni primitive yok. Açık kaynak lisansı kararı sahibe ait.
- _Boy:_ büyük (para ve süre). Maliyet bilgisi bulunamadı; teklif alınmalı.
- _Risk:_ Bulgular lansmanı geciktirebilir. Zamanlama: kapalı testten sonra, açık yayından önce.

**Öncelik 3: sonra**

**N6. Programlı gizlilik**

- _Ne:_ "Her gün 00:00–07:00 çemberimde dondur" gibi tekrarlı kural. Telefon her konum güncellemesinde saati kontrol eder; kesin alarm izni gerekmez.
- _Kime karşı:_ Apple yalnız süre ve tarih sunuyor [K33]. Başka rakipte araştırmada rastlamadım (yok demek değil).
- _Fayda:_ "Takip ediliyorum" hissini azaltır; bir kez kur, unut.
- _Kurallara uyum:_ Yeni izleyici bildirimi ve "Beni kimler görüyor" bozulmamalı. 15–17'de ebeveyn araçlarıyla çakışma var; ADR 0023 incelenmeli.
- _Boy:_ orta. _Risk:_ karmaşık ekran; T5 ile hayalet modunu sadeleştirme çalışmasıyla birlikte düşünülmeli.

---

## 7. Önermediklerimiz

| Rakipte olan                                                                               | Neden önermiyoruz                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Konuma dayalı reklam, sponsorlu yerler (Life360 Place Ads, Snap Promoted Places) [K3, K30] | Kural: reklam ve veri satışı yok. Plan Bölüm 1                                        |
| Konum verisini ortaklara lisanslama (Life360, Arity) [K5]                                  | Aynı kural; E2EE ile zaten mümkün değil                                               |
| Yer sıralaması, rozet, "sık gelenler" (Snap Place Loyalty, Bump) [K18, K29]                | Gençleri baskıya sokar; ADR 0023 sıralamayı ve seri tutmayı yasaklıyor                |
| Uber ve üçüncü taraf yolculuk bağlantısı (Life360, Bump) [K9, K17]                         | Konum üçüncü tarafa gider. Kural: sunucuya ve üçüncü tarafa düz konum yok             |
| Herkese açık profil, yabancıya açık keşif (Bump, Snap Map)                                 | Gizlilik ilkesi; 15–17 koruması                                                       |
| Telefon numarası ve rehber eşleştirme (Bump) [K17]                                         | Temel karar: rehber ve numara yok                                                     |
| Müzik paylaşımı (Bump)                                                                     | Önceki raporda elendi: ek izin, düşük değer                                           |
| Kaza algılama, 7/24 acil yönlendirme, yol yardımı (Life360 Gold/Platinum) [K12]            | Büyük iş, "her zaman konum" izni, operatör maliyeti. Bargu acil servis değil          |
| Evcil hayvan GPS'i, Tile benzeri donanım (Life360) [K10]                                   | Donanım; odak dışı                                                                    |
| Konuma dayalı yapay zekâ asistanı (Life360 planı) [K11]                                    | Konum içeriğini sunucuda analiz gerektirir. Telefonda yapılırsa v2 konusu             |
| Hesapsız kayıt (Starling, Find Family, XCoord)                                             | 15+ yaş doğrulaması ve KVKK için hesap şart                                           |
| 13–14 yaş desteği (Bump 13+, Uber genç hesabı 13–17) [K9, K17]                             | Türkiye'de 15 yaş altı yönetmeliği; ADR 0023                                          |
| Sessiz gizleme: karşı tarafı hiç bilgilendirmemek (Apple iOS 27)                           | Bargu'da süre dolunca iki tarafa tek satır bilgi düşüyor (ADR 0038). Bu ilke korunsun |

Önceki raporun "önermediklerim" listesi (seri tutma, sesli mesaj, galeri, sürüş raporu, müzik) geçerli.

---

## 8. Araştırmada bulunamayanlar ve açık sorular

- Life360'ın güncel ABD fiyat sayfası (403). Fiyatlar üçüncü taraf kaynaklarda çelişiyor [K12]. **Türkiye TL fiyatı bulunamadı.**
- Life360 için "FTC kararı" iddiası (bir hukuk bloğunda): doğrulanamadı, kullanılmadı.
- "Life360'ın gizlilik politikasında hassas veriyi satabiliriz yazıyor": haber aktarımı, politikayı kendim açmadım [K4].
- **Sahibin söylediği "bize benzer 1–2 yeni program":** adı verilmedi. Küçük şifreli uygulamalar bulundu (bölüm 2) ama büyüyen, tanınan, şifreli bir yeni rakip bulunamadı. Sahip uygulamanın adını verirse tek tek bakılır.
- Bump ve whoo için şifreleme açıklaması, whoo fiyatı, whoo ve küçük uygulamaların Türkiye'de olup olmadığı.
- Türkiye'deki pazar payı, Türkçe Play yorumları, yerli rakip.
- Instagram Harita'nın Türkiye'de açık olup olmadığı. iOS 27'nin tam yayın durumu.
- Snap Map'in "400M aylık kullanıcı" bilgisinin tarihi belirsiz; kullanılmadı.
- WhatsApp canlı konumda 2026 yeniliği: bulunamadı.

---

## 9. Kaynaklar

Erişim tarihi: 29.10.2026. "okundu" = sayfa açıldı; "özet" = yalnız arama özeti okundu.

**Life360**

- K1. Q2 2026 sonuçları (10.08.2026): https://www.barchart.com/story/news/3762799/life360-reports-record-q2-2026-results ve https://investors.life360.com/news-releases/news-release-details/life360-reports-record-q2-2026-results (özet; resmi sayfa 403)
- K2. Q4 2025 sonuçları (95,8 M aylık kullanıcı; karşılaştırma için): https://www.barchart.com/story/news/518205/life360-reports-record-q4-2025-results (özet)
- K3. Place Ads (12.06.2025): https://adexchanger.com/mobile/family-safety-app-life360-launches-location-based-ad-targeting/ ve https://investors.life360.com/news-releases/news-release-details/life360-enhances-ad-platform-launch-place-ads-and-uplift (özet)
- K4. Nativo alımı (Ocak 2026): https://pulse2.com/life360-to-acquire-nativo-in-120-million-deal-to-expand-family-focused-ad-platform ve https://coverager.com/life360-to-acquire-nativo/ (özet)
- K5. Veri satışı: The Markup (06.12.2021) https://themarkup.org/privacy/2021/12/06/the-popular-family-safety-app-life360-is-selling-precise-location-data-on-its-tens-of-millions-of-user ; AppleInsider (28.01.2022) https://appleinsider.com/articles/22/01/28/life360-to-stop-selling-precise-location-data-of-users ; dava (01.06.2023) https://themarkup.org/privacy/2023/06/01/life360-sued-for-selling-location-data ; Life360'ın açıklaması https://www.life360.com/en-ca/blog/respecting-privacy-choices (özet)
- K6. Geçici konum paylaşımı (30.03.2026): https://www.life360.com/blog/temporary-location-sharing (özet)
- K7. Geçici çember: https://www.life360.com/features/temporary-circles (özet)
- K8. No Show Alerts (20.08.2025): https://techcrunch.com/2025/08/20/life360-adds-a-new-no-show-notification-to-its-app (okundu)
- K9. Uber (duyuru 17.02.2026, canlı 18.06.2026): https://thenextweb.com/news/life360-uber-teen-rides-family-integration (okundu); https://investors.life360.com/news-releases/news-release-details/life360-and-uber-partner-help-parents-coordinate-rides-anywhere (özet)
- K10. Pet GPS (22.10.2025) https://quantisnow.com/insight/life360-debuts-new-pet-tracker-and-pet-recovery-features-connecting-6240976 ; evcil bakım (25.08.2026) https://investors.life360.com/news-releases/news-release-details/life360-announces-new-pet-care-products-so-no-one-forgets-fido (özet)
- K11. Yapay zekâ planı, Q4 2025 görüşmesi (02.03.2026): https://statementdog.com/analysis/LIF/earnings_calls/307236 (özet)
- K12. Fiyat ve kademeler (üçüncü taraf, çelişkili): https://www.itechguides.com/what-is-life360-how-it-works-features-and-free-vs-paid-plans/ ; https://subger.com/en/service/life360 ; https://www.life360.com/en-us/driving-safety/ ; https://www.life360.com/no-no/plans (özet)
- K13. Şikâyet analizi, pil %23: https://unstar.app/blog/life360-find-my-google-glympse-find-my-kids-family-location-apps-ranked-2026 (özet; üçüncü taraf)
- K14. Konum güncellenmiyor yorumları: https://unstar.app/blog/life360-location-not-updating-accuracy-app-reviews-2026 (özet; üçüncü taraf)
- K15. Yorum özeti: https://marlvel.ai/apps/life360-stay-connected-safe (özet; üçüncü taraf)
- K16. Türkiye şikâyetleri: https://www.sikayetvar.com/life360/calismiyor (okundu)

**Benzer uygulamalar**

- K17. Bump, App Store: https://apps.apple.com/us/app/-/id6471519217 (okundu)
- K18. Bump, nasıl çalışır: https://help.bumpmaps.com/en/articles/11420926-how-bump-works (okundu)
- K19. Bump, Android sayıları (AppGoblin tahmini): https://appgoblin.info/apps/co.amo.android.location (okundu)
- K20. whoo yatırımı (08.06.2026): https://dealroom.co/news/133956-linq-closes-1-1b-series-a-to-take-location-sharing-app-whoo-global/ (okundu)
- K21. whoo, NTT Docomo Ventures (19.02.2026): https://www.nttdocomo-v.com/en/news/aepuhm57n6/ (okundu); The Bridge: https://thebridge.jp/en/2026/06/location-sharing-app-whoo-raises-%c2%a51-1-billion-in-series-a-round-led-by-ntt-docomo-ventures (özet)
- K22. Starling: https://f-droid.org/packages/app.starlingmap/ (özet)
- K23. Starling tartışması (02.10.2026): https://discuss.privacyguides.net/t/starling-has-anyone-tried-out-this-floss-e2ee-location-sharing-app/41133 (okundu)
- K24. Find Family: https://f-droid.org/packages/com.vayunmathur.findfamily/ (okundu)
- K25. XCoord: https://apps.apple.com/us/app/xcoord/id6767400331 (okundu)
- K26. Where: https://appshunter.io/ios/app/where-share-privately/id6763714413 (özet)
- K27. Fenzly (politika 15.06.2026): https://fenzly-website.pages.dev/privacy (özet)

**Büyük platformlar**

- K28. Snap varış bildirimi (09.02.2026): https://techcrunch.com/2026/02/09/snapchat-now-lets-you-inform-others-when-you-have-arrived-at-your-destination/ ve https://newsroom.snap.com/expanded-arrival-notifications-snap-map (özet)
- K29. Snap Place Loyalty (Nis 2026): https://www.pulse.bot/media/news/snap-maps-new-place-loyalty-badges-will-show-the-spots-you-visit-most-often-df8c80f3-3814-4f66-a71c-497e1f4f336a/ (özet; haber derlemesi)
- K30. Snap Promoted Places (tarih belirsiz): https://www.pulse.bot/digital-marketing/news/snap-launches-promoted-places-transforming-the-snap-map-into-real-world-discovery-2d639cf8-e233-465f-ba35-b33d53d7f18f/ (özet)
- K31. Instagram Harita (06.08.2025): https://techcrunch.com/2025/08/06/instagram-takes-on-snapchat-with-new-instagram-map (özet)
- K32. Hürriyet, Instagram Harita (11.08.2025): https://www.hurriyet.com.tr/teknoloji/instagram-haritasini-gonul-rahatligiyla-kullanmak-icin-ipuclari-42910155 (okundu)
- K33. Apple iOS 27 Find My (29.09.2026): https://9to5mac.com/2026/09/29/ios-27-find-my-adds-new-ways-to-hide-your-location-more/ (okundu); https://www.macrumors.com/2026/09/14/ios-27-find-my-app-hide-location/ (özet)
- K34. Apple Find My gizlilik ve güvenlik: https://support.apple.com/guide/security/sec6cbc80fd0/web ; https://www.apple.com/legal/privacy/data/en/find-my/ (özet)
- K35. Google Messages canlı konum (Mar 2026): https://www.newsbytesapp.com/news/science/google-messages-now-lets-you-share-your-real-time-location/tldr (özet; ikincil)
- K36. Google Find Hub konum bildirimleri (18.05.2026): https://9to5google.com/2026/05/18/find-hub-location-notifications/ (okundu)
- K37. Google Find Hub bagaj linki (03.03.2026): https://economyclassandbeyond.boardingarea.com/2026/03/03/google-launches-share-item-location-in-find-hub-for-android/ (özet)
- K38. WhatsApp canlı konum: https://blog.whatsapp.com/share-your-live-location (özet)

**Türkiye ve genel**

- K39. Türkçe karşılaştırma yazıları (ticari siteler, zayıf kanıt): https://www.airdroid.com/tr/parent-control/best-family-location-sharing-app/ ; https://parental-control.flashget.com/tr/find-people-app (özet)
- K40. Zenly'nin kapanışı (03.02.2023): https://www.life360.com/blog/what-happened-to-zenly (özet)
