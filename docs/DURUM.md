# Proje Durumu

Her faz sonunda güncellenir: ne bitti, nasıl test edildi, açık riskler, kalan işler. Plan:
[BARGU_PLAN.md](../BARGU_PLAN.md) · Kararlar: [docs/ADR](ADR/README.md)

## Özet

| Faz                              | Durum                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Faz 0 — Temel & Güvenlik Altyapı | ✅ Onaylandı (açık madde: iPhone dev client)                                              |
| Faz 1 — Kripto Çekirdeği         | ✅ Tamamlandı                                                                             |
| Faz 2 — Auth & Cihazlar          | ✅ Onaylandı                                                                              |
| Faz 3 — Tasarım Sistemi & Harita | ✅ Tamamlandı (telefonda fps ve büyük yazı proje sahibince onaylandı)                     |
| Faz 4 — Çemberler & Anahtarlar   | ✅ Onaylandı (telefonda denendi: arkadaşlık, çember, davet, bildirim)                     |
| Faz 5 — Konum Motoru & Relay     | ✅ Onaylandı (telefonda konum görüldü; saha testleri sonraya)                             |
| Faz 6 — Harita Deneyimi          | ✅ Onaylandı (telefon ölçümleri sona bırakıldı)                                           |
| Faz 7 — Yerler & Bildirimler     | ✅ Onaylandı (telefon denemeleri sona bırakıldı)                                          |
| Faz 8 — Etkinlik Çemberleri      | ✅ Onaylandı (telefonda botla denendi; + planlama, geçmiş)                                |
| Faz 9 — Güvenlik & Uyum          | ✅ Onaylandı (+ anahtar düzeltmesi, haritada çıkartma ve ada)                             |
| Faz 9B — Para modeli & Bargu+    | 🟡 Sürüyor: 1–2c, 3a, buluşma, tema, konum 1, B, UX düzeni, kendi kartın bitti; 3b sırada |

## Ortamlar

| Ne                      | Nerede                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staging API             | `https://api.46-62-162-70.sslip.io` (geçici ücretsiz domain; bkz. ADR 0003)                                                                                                                                                                                                                                                                                                          |
| Staging deploy          | `main`'e her yeşil CI → GHCR imajı → migration → API + işçi (otomatik, sağlık kontrollü). CI kırmızıysa staging güncellenmez: push'tan sonra CI sonucu beklenir (15 Ekim 21:35 – 16 Ekim 10:19 arası bu yüzden 4437080'de kaldı). İmaj commit'ini `org.opencontainers.image.revision` etiketinde taşır                                                                               |
| Staging e-posta         | Varsayılan iç Mailpit. Proje sahibi sunucuda `bargu-set-mail` ile bir Gmail hesabından gerçek gönderime geçirebilir (ADR 0006); `.test` test hesapları hep Mailpit'te                                                                                                                                                                                                                |
| Expo / EAS projesi      | hesap `otenus`, proje `bargu` (`app.config.ts`)                                                                                                                                                                                                                                                                                                                                      |
| Android sürümleri       | `development` (dev client, Metro'ya bağlanır), `preview` (bağımsız, staging'e bağlanır)                                                                                                                                                                                                                                                                                              |
| Yerel Android derlemesi | EAS'ın aylık ücretsiz hakkı bitince: `scripts/build-android-local.sh` (Docker, aynı imza anahtarı; yalnızca arm64 telefonlar için, eski 32 bit telefon ve emülatör için `ABIS=armeabi-v7a,arm64-v8a,x86,x86_64`), `scripts/publish-apk.sh` → `https://api.46-62-162-70.sslip.io/apk/…` (tahmin edilemez ad). Staging bu APK'nın sunucu değişikliklerini henüz çalıştırmıyorsa uyarır |
| Linux CI (yerel)        | `scripts/ci-linux.sh [commit]`: CI'ın format, typecheck, lint, test ve build işini temiz bir kopyada Docker'da (Ubuntu) çalıştırır. Test değiştiren her commit'ten önce; Windows'ta geçip Linux'ta kırılanları yakalar                                                                                                                                                               |
| Uygulama kimliği        | `app.bargu` (mağazaya çıkınca değiştirilemez)                                                                                                                                                                                                                                                                                                                                        |
| Harita dosyaları        | Sunucuda `/srv/bargu-map`, `https://api.46-62-162-70.sslip.io/map/` (Türkiye, 1,6 GB)                                                                                                                                                                                                                                                                                                |

## Faz 9B — Para Modeli & Bargu+ (sürüyor, 2026-10-16)

Kararlar: [ADR 0024](ADR/0024-entitlements-and-test-billing.md) (hesap bazlı hak, çemberin
ödeyeni, deneme, duraklama, sahte ödeme, 15–17 satın alma, en eski desteklenen uygulama),
[ADR 0025](ADR/0025-cosmetic-pass-and-look.md) (süs geçiş belgesi ve görünüm mesajı),
[ADR 0026](ADR/0026-meetings-in-any-circle.md) (her çemberde buluşma), ADR 0011'e ek (hız ve
durma süresi etiketi). Proje sahibi 2026-10-16'da durum analizi için durdurdu; ardından buluşma
dilimini istedi (PM onayıyla). Dilim 3b ve sonrası onay bekliyor.

### Önce: CI 13 saat kırıktı (düzeltildi)

- 5c'den (`cfe3c3b`, 15 Ekim 21:35) 16 Ekim 10:19'a kadar her push'ta CI kırmızıydı; staging bu
  yüzden `4437080`'de kaldı. "staging'e kendiliğinden gider" demiştim, yanlıştı.
- Sebep: `guardian-tools.test.tsx` Linux'ta açılamıyordu (expo-router → iOS'a özel yerel görünüm);
  Windows'ta geçiyordu. Düzeltme `bcf285d`.
- Önlemler (`ad0d1bc`, `b7bac16`): `scripts/ci-linux.sh` CI'ı Docker'da Ubuntu üzerinde
  çalıştırır (ana klasörden ve worktree'den); staging imajı commit etiketini taşır;
  `publish-apk.sh` staging APK'nın sunucu kodunu çalıştırmıyorsa uyarır. Her push'tan sonra CI
  sonucu beklenir, imaj kontrol edilmeden "staging'de" denmez.

### Yapılanlar

| Dilim                        | Commit                                                           | Ne                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                            | `c04c446`, `b4fb39a`                                             | Hak tablosu, 21 günlük deneme, duraklayan çember, test satın alma uçları (yalnızca `BILLING_TEST=on` olan yerde)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| QA 19                        | `e95152b`                                                        | Hak tablosuna yalnızca işlevlerle yazılır (P1), işçi işlevleri oturuma bir şey vermez (P2), iptal ya da yenileme başkasına söylenmez (P3), istemci seviyesi kapısı (P4), silip yeniden kaydolma denemesi kabul edilen risk (P5)                                                                                                                                                                                                                                                                                                                               |
| 2a                           | `8aa73f8`                                                        | Bargu+ ekranı (TEST bandı, yıllık önde, tek dokunuşla iptal), deneme hatırlatması, duraklamış çember uygulamada, "Yeni sürüm gerekiyor" ekranı                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2b                           | `40fe657`                                                        | Haritada hız ("40 km/sa") ve durma süresi ("2 sa") satırı; "Hızımı göster" ayarı (15–17'de kapalı başlar)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| QA 20 P1b                    | `714b71b`                                                        | Test hakları veritabanında da yalnızca test kurulumunda sayılır ve yazılır (migration 0030); test planı en çok bir yıl                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2c                           | `f7b73de`, `2571e4f`, `b85ac9d`                                  | 15–17 satın alma ebeveyn onayıyla (migration 0031); istemci seviyesi 2 (satın alma isteği eski uygulamalara gönderilmez); profil içeriği esnek okunur (yeni alanlar eski uygulamayı bozmaz)                                                                                                                                                                                                                                                                                                                                                                   |
| 3a                           | `450e155`                                                        | Sunucu imzalı süs geçiş belgesi (`GET /v1/me/cosmetics/pass`) ve şifreli `look` mesajı; staging imza anahtarı `stg-1`. Uygulama tarafı (3b) yok: süs henüz görünmez                                                                                                                                                                                                                                                                                                                                                                                           |
| Buluşma                      | `230cf81`, `8de3a8b`                                             | Proje sahibinin isteği: her çemberde tek buluşma (migration 0032), herkes başlatır, başlatan ve yöneticiler değiştirir ve bitirir, saatinden 3 saat sonra kendiliğinden silinir. Haritada kayıtlı yer gibi değil (mercan, kesikli kenar, bayrak), dokununca kendi ekranı; "Geldim", yol tarifi, başlayınca tek bildirim. İstemci seviyesi 3                                                                                                                                                                                                                   |
| QA 21                        | `557be04`, `ce453a9`, `d93196e`, `5fb98a3`, `f060920`, `ff86173` | Bildirimler cihaz başına bir kez ve yalnızca üyenin kendi cihazına (B-2); "Ebeveynime sor"a aynı anda iki dokunuş 500 değil (B-1, migration 0033); test satın alma veritabanı bayrağına uyar, kapalıysa 404 (B-5, migration 0034); hesabı silinenin belgeleri giderken çember haber alır (B-3, migration 0035); duraklamış çemberde "geç kalıyorum" yok (B-4, uygulama); paketlerin derlemesi eskiyse entegrasyon testleri açık hatayla durur                                                                                                                 |
| İkili eşit                   | `220d2c8`, `fae1d4d`                                             | PM'in kararı: arkadaşlıkta iki kişi de buluşmayı değiştirir ve bitirir (migration 0036; uygulama bir sonraki APK'da)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kısayollar                   | `c9313c0`                                                        | Sahibin isteği: haritanın sağ kenarında konumuma dön, hayalet modu (tek dokunuşla açılır, kapatırken onay) ve buluşma başlat; üstte en yakın buluşmanın sayaç çipi ("🏠 Ev · 17:30 · 25 dk", saatinde "2/4 geldi · 1 yolda", sayılar ADR 0026 kurallarıyla); herkes tam konumla gelince bir kez konfeti (ADR 0026 §8)                                                                                                                                                                                                                                         |
| Efektler ve sade mod         | `79abd4e`, `7b6c059`                                             | Kısayol efektleri (yaylı giriş, süzülen hayalet ve "pof", radar halkası, Geldim nabzı, kayan dakika), hepsi sonlu; sade mod (Ben > Efektler: tam / az / kapalı), pil tasarrufu ve %20 altı "az" gibi, "Hareketi azalt" ve görünmeyen harita "kapalı" gibi; hava 20 sn oynayıp donar (ADR 0027). QA 22: buluşma bitişi sunucuda tam saate yuvarlanır, tahmin yalnızca tam konumla, çipte yaklaşan buluşma önde                                                                                                                                                 |
| Tema ve pin                  | `f4138da`, `1aba84f`, `5d64cb9`                                  | Sahibin gönderdiği tasarım (ADR 0008 eki): lacivert-mor koyu tema ve açık karşılığı, durağan mor parıltı, iki satırlı "seni görüyor" (ikinci satır gerçek durumu söyler), şehir/ilçe adlı hava kartı, simgeli seçim çubukları ve ⓘ açıklamalar, kartlı Ben sayfası, dock'ta seçili sekme; hayalet düğmesinde "konum paylaşılıyor" noktası; kişiler pin (mor halka, uç, konum noktası, yeşil canlı noktası), birlikte duranlar tek ortak pin                                                                                                                   |
| QA 23–24                     | `7f08964`                                                        | İzin bilinmeden "paylaşılıyor" denmez ("Kontrol ediliyor…", hayalet düğmesinde nokta yok); süreli paylaşım bittiği an konum durur ve bütün ekranlar aynı anda söyler; hava kartında eski ilçe adı kalmaz; iki renk çifti okunur; QR halesi ve tarayıcı çizgisi sade mod "tam"dan çıkınca durur; titreşim yalnızca Efektler seçimine bağlı                                                                                                                                                                                                                     |
| Konum doğruluğu, 1. adım     | `7f23b98`, `c7eb602`, `f9ffb32`                                  | Sahibin şikâyeti: konum geç geliyor, virajda pin yoldan çıkıp sonra düzeliyor (ADR 0028). Gönderen ham konumu süzer (eski, 2 dk'dan bayat, GPS açıkken 100 m'den zayıf, 180 km/sa'ten hızlı sıçrama; kapalı alanda 45 sn sonra en iyisi doğruluğuyla gider); alıcı geç gelen eski konumu göstermez; pin iki konum arasında kayar, tahmin en çok 1 sn ve yalnızca düz yolda (eskiden 10 sn); zayıf konumda daire; harita açıkken kendi pini saniyede bir; Efektler'de pil tasarrufu notu; önizleme paketinde ölçüm katmanı (production'da kodu yok)            |
| Buluşma kartı                | `7f4d989`                                                        | Sahibin ekran görüntüsü: bir etkinliğin iki adayı (Hilltown, Avm) haritada üst üste biniyor, alttaki tıklanamıyordu. Haritanın yakınlığında etiketleri çakışacak buluşmalar tek kartta alt alta birer satır; her satır kendi buluşmasını açar, buluşmanın kendisi üstte ve mercan; yakınlaşınca ayrılır; seçilmemiş yerlerin kesikli kenarı soluk (ADR 0026 §3)                                                                                                                                                                                               |
| B: hareket çizimleri         | `bc5f925`                                                        | Sahibin isteği, önizlemesi onaylı (ADR 0008 eki): dizi, dirseği bükülen yürüyen ve koşan insan, pedalı izleyen bisikletli; tekerlekleri ve yolu hıza göre giden araba (şehirde duman, yolda hava çizgileri); 120 km/sa'ten yarış arabası ve düz hız çizgileri, 200'den hızlı tren, 300'den uçak; kişinin kendi rengi. Yalnızca hız bilgisiyle ("Hızımı göster" açık, tam konum); kendi pininde hız gizliyken en fazla araba; kutlama yok; sade moda uyar                                                                                                      |
| B: düzeltmeler               | `6c0aad3`, `28805fd`, `51b3cb9`, `b4bb890`, `67f4638`            | Sıçrama kuralı bildirilen hıza ve yöne göre esner (ADR 0028 eki: 250 km/sa tren kabul, tünel çıkışı tutulur); 24,8 günden uzak süreli paylaşım hemen bitmez (QA 25); dışarıdan gelen bağlantılar yalnızca bargu://i/ ve /g/ ile açılır, gerisi ana sayfa (tarama notu 1); ölü test yardımcısı ve dosya içi export'lar (tarama notu 3)                                                                                                                                                                                                                         |
| UX düzeni                    | `8e965a2`                                                        | Dış gezinme notu, PM'in dilimi (ADR 0008 eki): Ben sayfası başlıklı gruplarda, profilin altında "Konum ve gizlilik" (hayalet, kimler görüyor, konum geçmişim); yeni "Bildirim tercihleri" ekranı (izin, telefon ayarları, sessize alınanlar ve sesi açma); kişi kartında × ve bildirim zili (sessizdeyse çizili, "Sessizde"), çember düğmesi "Arkadaşlık" ya da "Çember"; "Seni görenler"den çemberin paylaşım ayarına; Ekle'de "Çember oluştur"; Çemberler'de boş bölüm açıklamalı; ayrılma ayrı; "Gizlilik ve hesap" → "Hesap ve veri"                      |
| Donma düzeltmesi             | `225e8a0`                                                        | Sahibin telefonu dondu: hareket çiziminin döndürme yardımcısı UI thread'de çağrılıyordu ama worklet değildi, `bc5f925`'ten beri her karede hata atıyordu. Worklet yapıldı. Yeni test (`worklet-calls.test.ts`) animasyon kancalarının çağırdığı her yerel fonksiyonun worklet olduğunu kodu okuyarak denetler                                                                                                                                                                                                                                                 |
| Kendi kartın, ayar ekranları | `9209d58`                                                        | Sahibin telefon denemesi (ADR 0008 eki): kendi pinine dokununca diğerlerindeki gibi kart açılır (durum, konumun kime gidiyor, pil, hayalet; Kimler görüyor, Durum, Geçmiş, Ayarlar; dürtme ve buluşma yok). Ben sayfası yalnızca satırlar, her biri kendi ekranını açar (Konum ve gizlilik, Görünüm ve harita, Uygulama yeni ekranlar; passkey ve ebeveyn bağlantısı Güvenlik'te). Çember ekranında "Konumun" ve "Yerler" özetli birer satır, kendi ekranlarında. Bir ekrandan geri gelince Ben ya da Çemberler sayfası yeniden açılır, kaydırma yeri korunur |
| Test ve derleme              | `4421231`, `92bf609`                                             | Relay entegrasyon testi koordinatı bir zamanın saniyesinde ("13:16:41.008") bulup CI'ı kırdı, `225e8a0` bu yüzden staging'e gitmedi: artık yalnızca kendi başına duran koordinat sayılır. Önizleme APK'ları yalnızca arm64 (sahibin onayı)                                                                                                                                                                                                                                                                                                                    |

### QA turları

- QA 19 (dilim 1): P1–P5 düzeltildi ya da karara bağlandı.
- QA 20 (QA 19 düzeltmeleri, dilim 2a): orta ya da yüksek bulgu yok. P1b ve T-1 düzeltildi.
  A-1 (aşağıda) ve test botunun kodunun depoya alınması sonraya.
- QA 21 (P1b, T-1, 2c, 3a, buluşma): orta ya da yüksek bulgu yok. Düşük B-1…B-5 düzeltildi.

### Test sonuçları (son çalıştırma, `e8a07df`)

- Kendi kartın ve ayar ekranları (`9209d58`): mobil 530. Ben'de satırlar sırayla, her biri kendi
  ekranını açar, geri gelince Ben yeniden açılır; kendi kartın konumun kime gittiğini, pili ve
  hayaleti gösterir, dürtme ve buluşma yok, "Kimler görüyor" ve "Ayarlar" doğru ekrana; yeni ayar
  ekranları; çemberin paylaşım özeti. Yeni testlerin bazıları Linux'ta yine yerel modüller
  yüzünden açılamadı; push'tan önce yakalandı, taklitlerle düzeldi.
- Donma (`225e8a0`): yeni statik test `bc5f925`'in kodunda tam olarak o fonksiyonla kırılır,
  düzeltmeyle geçer. Çizim testleri baştan beri geçiyordu: Jest worklet'leri JS thread'de
  çalıştırır, orada hata çıkmaz. Telefonda doğrulandı (sahip, 21 Ekim): `e8a07df` kurulu, donma
  yok, arkadaşlar görünüyor; bot yeniden hareket ediyor.
- `225e8a0`'ın CI'ı API entegrasyonunda kırıldı (run 39606444369, rastlantı: relay testi
  koordinatı bir zaman damgasının saniyesinde buldu); staging `225e8a0`'a geçmedi. Düzeltme
  `4421231`: desen 8 örnekte denendi (zamanın saniyesi ve başka sayının içi sayılmaz; JSON değeri,
  dizi, virgüllü, tamsayı ve `lat=` sayılır); relay testi yerelde 7/7.
- `scripts/ci-linux.sh e8a07df` (`9209d58` dahil): push'tan önce geçti (mobil 530); CI ve Security
  yeşil (run 39610764826); staging `e8a07df`, sağlık ok, hata 0.

- UX düzeni: mobil 521. Kartta × kapatır, zil bildirimleri açar, sessizdeyken "Sessizde" ve çizili
  zil, çember düğmesinin adı (Arkadaşlık / Çember); Ben'de gruplar sırayla ve "Konum ve gizlilik"
  ilk, oradan /seers, /notifications ve "Hesap ve veri"; bildirim tercihlerinden sesi açma;
  reddedilmiş bildirimde telefon ayarları; "Seni görenler"den çembere; Ekle'de çember oluşturma;
  boş grup bölümü. Üç yeni test Linux'ta yerel modüller (bildirim, güvenli depo, cihaz kilidi, pil,
  expo-router) yüzünden açılamıyordu; push'tan önce yakalandı, taklitlerle düzeldi.
- `scripts/ci-linux.sh 8e965a2`: push'tan önce geçti (mobil 521); CI 5/5 yeşil (run 39595531390);
  staging `8e965a2`, sağlık ok, hata 0.

- B: mobil 510, API birim 93. Çizimler: adımda alttaki ayak hep yerde, koşan bir an havada,
  bacaklar ve kollar karşılıklı, bisikletlinin ayağı pedalda ve dizi önde; eşikler (119 araba, 120
  yarış, 200 tren, 300 uçak) ve kendi pinin sınırı; her çizim ve sesli adı; duran ya da eski
  konumda çizim yok; "az" ve "kapalı"da yeni çizimlerle de boşta 0 kare. Sıçrama: 250 km/sa tren
  her konumda, tünel çıkışı iki onayla, hızsız eski kural, yönü tutmayan ve ses hızı üstü tutulur.
  Uzun paylaşım: bir ay sonraki bitiş hemen değil tam zamanında (düzeltmesiz test kırılıyor).
  Uygulama yalnızca "1 saat" ve "bu akşama kadar" sunar; bu durum telefonun saati geri alınınca
  ya da ileride daha uzun süreler eklenince doğar.
  Bağlantılar: ağır ve bozuk yüzde kodlaması, sorgu, parça, uzunluk, başka şema, bilinmeyen ekran,
  kısa token ana sayfaya; kanca hiç fırlatmaz.
- `scripts/ci-linux.sh bc5f925`: push'tan önce geçti (mobil 510); CI 5/5 yeşil (run 39589016676);
  staging `bc5f925`, sağlık ok, hata 0.

- Mobil 489. Konum doğruluğu (ADR 0028): Filtre: eski, bayat, zayıf, kapalı alanda en iyisi
  doğruluğuyla, sıçrama ve iki onay, tek sapkın konum hiç kullanılmaz, otoyol hızı geçer. Motor: iki
  kaynakta pin geri gitmez, kapalı alan, kaba çembere giden hücre ham konumun hücresiyle birebir
  aynı, ölçüme hiçbir koordinat gitmez. Alıcı: geç gelen gösterilmez, aynı zaman yerine geçer, saati
  geri alınan gösterilir. Kayma: hedefini geçmez, tahmin en çok 1 sn, virajda, yavaşlarken, dururken
  ve zayıf konumda tahmin yok, geç gelende yerinde kalır, 30 sn ve 500 m'de atlar. Kendi pini:
  harita açıkken saniyede bir, harita kapanınca ve uygulama arka plana geçince hemen durur.
- Production paketi (`expo export`, bayraksız): ölçüm katmanının metinleri 0 kez; bayraklı
  (önizleme) pakette var.
- Buluşma kartı: sokak yakınlığında iki aday tek kartta, yakınlaşınca ya da şehrin öbür ucunda ayrı;
  zincirleme çakışanlar tek kart, buluşma en üstte; her satır kendi buluşmasını açar; 4'ten fazlası
  sayıyla.
- `scripts/ci-linux.sh`: `f9ffb32` ve `7f4d989` push'tan önce geçti (Linux'ta açılamayan kanca
  testi, expo-router yüzünden, push'tan önce yakalandı ve düzeltildi). CI iki push'ta da 5/5 yeşil;
  staging `7f4d989`, sağlık ok, hata 0.
- Birim (`5d64cb9`): mobil 447 (tema: "seni görüyor"un ikinci satırı her durumda doğru, hayalet
  düğmesinin noktası ve etiketi, ilçe adı haritanın etiketinden, dock'ta seçili sekme, yeşil canlı
  noktası yalnızca tazeyken; buluşma ekranı, haritadaki noktalar, kaba konumda "geldi" yok, bildirim
  metni, duraklamış çemberde "geç kalıyorum" yok, arkadaşlıkta iki kişi de buluşmayı yeniden
  mühürler; kısayollar: hayalet tek dokunuşla açılır ve onaysız kapanmaz, çipin sayıları kaba
  paylaşanı "yolda" saymaz, konfeti yalnızca tam konumla gelince ve bir kez; sade mod kuralları,
  titreşim "kapalı"da yok, harita görünmüyorken durur).
- Ölçüm (ADR 0027, `idle-frames.test.tsx`): dokunulmayan 10 saniyede istenen kare. "Az" ve
  "kapalı"da avatarların her etkinliği, ayak izleri, kısayollar ve çip: 0. "Tam"da kısayollar ve
  çip 0; avatar döngüleri canlı (sahibin isteği); hava 20 saniyeden sonra 0; harita görünmüyorken 0.
  Telefonda profil ölçümü yapılmadı (cihaz yok).
- API entegrasyon: 30 dosya, 230 test (buluşma: başlatma, tek buluşma, yetki, yabancı erişemez,
  bitiş saati, eski uygulamaya gitmez, işçinin silmesi, bildirim bir kez; QA 21: 30 aynı bildirim
  bir olur ve başkasının cihazına gitmez, aynı anda iki "Ebeveynime sor" 500 değil, veritabanı
  bayrağı kapalıyken 404, hesabı silinenin buluşması çembere haber verilerek gider, arkadaşlıkta
  iki kişi de bitirir).
- `scripts/ci-linux.sh`: her commit için push'tan önce 16/16 (`b989b93`: 141 sn). Makine meşgulken
  iki koşu zaman aşımıyla düştü (ölçüm testi, sonra ilgisiz ekran testleri); boşken geçti, ölçüm
  testi hafifletildi. Buluşma ekranı testi Windows'ta geçip
  Linux'ta açılamıyordu (güvenli depo yerel modülü); push'tan önce yakalandı (`dfd18e3`).
- Staging'de geri alınan bir işlem içinde P1b denendi: bayrak açıkken test planı yazılır ve
  sayılır, kapalıyken sayılmaz ve yazılamaz, 100 yıllık plan reddedilir.

### Staging

- `APP_ENV=staging`, `BILLING_TEST=on` (API, işçi ve migrate), `MIN_CLIENT_LEVEL` verilmedi (0),
  `ENTITLEMENT_SIGNING_KEY` ve `ENTITLEMENT_SIGNING_KID=stg-1` yalnızca sunucudaki `.env`'de.
- Sunucudaki `compose.yml` yedekleriyle güncellendi (deploy onu kopyalamaz).
- Test botu v13: istemci seviyesi 3 gönderir, giriş kodunu 4 haneli okur. Sahibin isteğiyle "tur"
  kipinde: 1–2 dakikada bir rastgele yürüyüş, koşu, bisiklet, araba, yarış arabası (140 km/sa),
  tren (230) ya da uçak (320) olur ve sahibin konumunun çevresinde döner (250 m – 2 km). Hareket
  yönü artık çemberin yönünde (v12'de 90° yanlıştı).

### Test arkadaşı v14, "Deniz" (bekliyor, 2026-10-21)

Sahibin isteği: bot, İstanbul'da yaşayan biri gibi davranan ve bir dil modelinin (EVREN) yönettiği
bir test arkadaşı olacak. Sahip "önce projeye odaklanalım" dedi; iş güvenli bir yerde durdu.

- Yapılan: botun kodu TypeScript'e taşındı (`tools/test-friend`, v13 ile aynı davranış), ayrı dalda
  `worktree-agent-a18b6198871923d2e` (`cda2ad0`, `190254e`). Ana dala girmedi. Tam iş tanımı o
  dalda `tools/test-friend/BRIEF.md`.
- Yarım: birim testleri (paket testsiz CI'ı kırar, dal bu yüzden birleştirilmez), yerler, gerçek
  yolların çıkarılması, hayat kipi, kurulum, ADR 0029.
- Kişi (taslak, sahip henüz onaylamadı): Deniz, 27 (önce "Elif" diye tasarlandı; sahip adı değiştirdi: uydurma, cinsiyetsiz); Kadıköy Caferağa'da kiralık ev; Levent'te uydurma
  bir şirkette UX tasarımcısı; beyaz Renault Clio (uydurma plaka, durum yazısında görünmez); spor
  salonu, market, kuaför; Ataşehir'de ailesi; hafta sonu Büyükada ya da Belgrad Ormanı. Evi, işi,
  spor salonu, market, benzinlik, kafe, aile evi ve otopark sahiple ortak çemberde kayıtlı yer olur;
  varış ve ayrılış bildirimleri gerçek gelir.
- Model: EVREN, OpenAI uyumlu (`https://evren-llmapi.ssyz.org.tr/v1`; resmi belgeden
  doğrulanamadı, bir habere göre 1 Kasım 2026'ya kadar ücretsiz). Günde en çok 150 çağrı (env'den).
  Model yalnız JSON döner, zod ile denetlenir. Koordinat seçemez, yalnız listedeki yer, ulaşım ve
  durum yazısı. Hata, zaman aşımı ya da tavan dolunca kurallı gün planı.
- Gizlilik: modele hiçbir gerçek kullanıcının konumu, adı ya da çözülmüş içeriği gitmez. Olaylar
  tür ve takma adla gider ("Arkadaş 1 seni dürttü"). İstem ve cevap loglanmaz. Model çember, davet
  ya da arkadaşlık kuramaz.
- Yollar: OpenStreetMap'ten bir kez çıkarılıp sadeleştirilmiş (5–10 m), ODbL atıflı küçük bir dosya;
  çalışırken yönlendirme servisi yok. Dışarıya yalnız Bargu API'si, EVREN ve api.open-meteo.com
  (kodda izin listesi).
- Çalışacağı yer: staging sunucusu (sahip, 2026-10-21; evdeki bilgisayar kararının yerine). Yük
  küçük: bugünkü bot ~170 MB bellek ve ~%2 işlemci kullanıyor; sunucuda 4 çekirdek ve 6 GB boş
  bellek var; model EVREN'de çalışır. Botun kendi köprü ağı olur, port açılmaz, rastamen'e
  dokunulmaz, önce yedek alınır. Kurulum sunucu değişikliği olduğu için sahibin doğrudan onayıyla.
  Tek Docker imajı ve tek betik; gerekirse bilgisayarda da yalnız ayar dosyalarıyla çalışır (şirket
  ağında FortiGate staging adresini araya girip imzaladığı için orada BT muafiyeti gerekir).
- Anahtar: sahip sunucuda kendi terminalinde gizli girişle botun ayar dosyasına yazar (`chmod 600`).
  Sohbete, depoya ve loga girmez.
- Bot durursa (sunucu yeniden başlarsa) Deniz yoktur; açılınca aradaki süre hesaplanır, tek konum
  sıçraması ve en çok bir model çağrısı olur.
- Sıra (PM): arka planda canlı konum ve süsler (3b) bittikten sonra ya da düşük öncelikte; önce
  testler, sonra yerler ve yollar, sonra hayat kipi.
- ADR 0029 kuralı (yazılacak): Deniz yalnız sahibin test arkadaşıdır. Gerçek kullanıcılara asla
  gerçek bir insan gibi gösterilmez, ürüne ve mağaza sürümüne girmez. Kapalı testten önce bot test
  kullanıcılarının çemberlerinden çıkarılır (Faz 10).
- Sonraki dilim: hafıza akışı, gece düşünme ve sabah planı, ruh hali, kendiliğinden ve hız sınırlı
  dürtme ya da buluşma, "Arkadaş 1" ile ilişki hafızası. Hayat durumu ve hafıza dosyaları buna
  göre genişletilebilir kurulacak.
- Devam ederken bakılacaklar: açık OSRM sunucusu yalnız araba profili sunuyor olabilir (yürüme ve
  bisiklet için başka sunucu gerekebilir, denenmedi); vapurla işe gidişte Beşiktaş iskelesi ile ofis
  arası bağlantı eksik; yol dosyasının çalışırken nereden okunacağı.
- Staging'deki eski bot (v13, tur kipi) yerinde kalır.

### Kalan açıklar

1. `MIN_CLIENT_LEVEL` hâlâ 0. 2'yi atlayıp bütün telefonlar buluşma APK'sına geçince doğrudan 3
   yapılacak, en geç 1 Kasım (denemeler bitmeden). Açmadan önce PM'e sorulur. Eski APK'lar 426'yı
   tanımaz, yalnızca genel hata gösterir.
2. Gerçek mağaza yok: fiyatlar tahmin, satın alma yalnızca test. Silip yeniden kaydolan yeni deneme
   alır (kabul; Faz 10'da mağazanın kendi denemesine taşınır).
3. A-1: çember duraklayınca yazılmış ama gönderilmemiş yerel geçmiş parçaları ilk sonraki konuma
   kadar telefonda durur (sunucuya gitmez).
4. "Hızımı göster" kapalıyken yön ve durma süresi gitmeye devam eder (PM kabul etti; ayar yalnızca
   hızı kapsar).
5. Süs: 3b yapılmadan hiçbir süs görünmez; staging'de paket test için satın alınabilir.
   Kabul edilen risk: iadeden sonra değiştirilmiş bir uygulama en çok 30 gün eski belgeyle süs
   gösterebilir.
6. Çalışan test botunun kodu ana dalda değil (sunucuda; TypeScript'e taşınmış hâli ayrı dalda, yukarıda). Betik
   sunucunun `/tmp` klasöründen bağlı (sunucu yeniden başlarsa bot kalkmaz) ve bot 24 saat sonra
   kendiliğinden durur (22 Ekim ~17:27).
7. `event-cleanups` entegrasyon testi makine çok yüklüyken bir kez kırıldı (QA 20), tekrar
   edilemedi.
8. Profil, `look` ve plan içerikleri esnek okunur; diğer içerik türleri hâlâ katı (yeni alan
   eklenirse önce okumayı esnetmek gerekir).
9. Buluşma: sunucu bir çemberde buluşma olduğunu, başlatanı ve bitiş saatini (saat + 3 sa,
   bir sonraki tam saate yuvarlanmış), dolayısıyla buluşmanın saatini bir saatlik aralıkla bilir;
   yer şifreli. Eski uygulamalar bitişi dakikasıyla gönderir, sunucu yine yuvarlayarak saklar.
10. Kısayol sütunu küçük ekranda ve en büyük yazıda telefonda denenmedi (çip yazısı iki satıra
    kadar kırılır, düğmeler sabit 48 pt).
11. "Tam"da avatar döngüleri (nefes, yürüyüş, yerleşik halka, düşük pil nabzı) bilerek sonsuz:
    sahip haritanın canlı olmasını istedi. Pil tasarrufunda ve %20 altında "az" gibi durur.
12. Hava kartındaki ad haritanın kendi etiketlerinden: sokak yakınlığında şehir etiketi çizilmediği
    için çoğu zaman "İstanbul" yerine ilçe adı ("Kadıköy") görünür; yakında etiket yoksa ad yok.
13. Harita zemininin (sokaklar, binalar) koyu renkleri tema dilimine girmedi; yeni temayla ton farkı
    olabilir.
14. Dilim 3'ün süs paketleri çıkartmaya göre tasarlanmıştı; 3b'de pine göre değişecek ("Halka
    desenleri", "Pin çerçeveleri"), wip/dilim-3b uyarlanacak.
15. Konum (ADR 0028): arkadaşın konumu 5 saniyede bir geliyorsa pin yeni yere 2 saniyede kayar ve
    bekler (tahmin yerine doğruluk). Akıcı hareket yalnızca canlı modda: arkadaşın uygulaması
    öndeyken. Arka planda canlı mod 3. adım, ayrı onayla (önce tek telefonda deneme, pil etkisi).
16. Filtrenin sayıları (2 dk, 100 m, 45 sn, 180 km/sa, iki onay) başlangıç değeri; ölçüm katmanıyla
    ayarlanacak. Kapalı alanda ilk 45 saniye yeni konum gitmez.
17. Harita açıkken 1 saniyelik GPS pil harcar; yalnızca ekran açık, uygulama önde ve harita
    görünürken. Ölçüm katmanı açıkken kare ölçer sürekli çalışır.
18. Ölçüm katmanındaki arkadaş gecikmesi iki telefonun saat farkını da içerir.
19. Production'da ölçüm katmanından boş bir dinleyici kancası, boş bir yuva ve menü satırının metin
    anahtarı kalır (kod değil, hiç çalışmaz).
20. decode-uri-component 0.2.2 (orta, expo-router → query-string): override yapılmadı. Yamalı 0.5.0
    yalnızca ESM; query-string 7 onu require ile alıyor, fonksiyon yerine nesne geliyor ve çağrı
    TypeError veriyor (denendi). Koruma: app/+native-intent.tsx'teki süzgeç. Expo güncellemesinde
    yeniden bakılacak.
21. uuid 7.0.3 ve 8.3.2 (orta): yalnızca prebuild aracı (xcode, @bacons/xcode) üzerinden, uygulamaya
    girmez; CI yalnızca yüksekte kırılır. İşlem yok.
22. Yeni çizimler telefonda ölçülmedi: 50 kişilik sürü (geliştirici menüsü) ile kare hızı test
    oturumunda bakılmalı. Araç gövdeleri sabit SVG, hareketli parçalar UI thread'de.
23. Hızdan tahmin: 200–300 km/sa her zaman tren, üstü uçak (telefon hangisi olduğunu bilmez). Hızı
    gizli olanın arkadaşları onu yine hareketsiz görür.
24. UX düzeni: sessize alma yalnızca bu telefonda; sunucu bilmez.
25. Donma testlerden kaçtı: Jest worklet'leri JS thread'de çalıştırır, emülatörde açılış ve haritada
    hareket denemesi (duman testi) yok (PM: Faz 10). Yeni statik test yalnızca animasyon
    kancalarının (useAnimatedStyle, useAnimatedProps, useDerivedValue, useFrameCallback) doğrudan
    ve dolaylı çağırdığı yerel fonksiyonlara bakar; dokunma hareketlerinin (gesture) işleyicileri, runOnUI ve başka paketlerden
    gelen fonksiyonlar kapsanmıyor.
26. Ben ya da Çemberler'e dönünce kaydırma yeri sayfa açılınca kaydedilen yere getirilir; içerik
    bu arada uzadıysa biraz kayabilir. Telefonda denenmedi.
27. Önizleme APK'ları yalnızca arm64: eski 32 bit telefonlara ve emülatöre kurulmaz; gerekirse
    `ABIS=…` ile hepsi derlenir. Mağaza derlemeleri (EAS) etkilenmez.

### Telefonda denenecekler (proje sahibi, 2c APK'sı)

APK (`b85ac9d`): <https://api.46-62-162-70.sslip.io/apk/bargu-b85ac9d-42157e9a2ed4e21d.apk>

1. Ben > Bargu+: TEST bandı, yıllık önde; satın alma ödeme istemeden çalışır, "yenilenir" yazar;
   iptal tek dokunuşla "… tarihinde biter" yapar.
2. Haritada hareket eden arkadaşın altında hız, duranın altında süre; Gizlilik > "Hızımı göster"
   kapatılınca arkadaşın telefonunda hız ve hareket simgesi kalkar.
3. 15–17 hesap ve bağlı ebeveyn: çocuk "Ebeveynime sor"a basar, ebeveyne bildirim gelir, ebeveyn
   ekranında "Bargu+ yıllık almak istiyor (₺799,99 / yıl)" çıkar; evet ile çocukta Bargu+ açılır,
   hayır ile "onay bekleniyor" yazısı kalkar. Bağlı ebeveyn yoksa "önce bir ebeveyninle bağlantı
   kur".
4. Deneme bitince ikili çember duraklar, biri Bargu+ alınca anında açılır.

Buluşma, APK (`e77be02`): <https://api.46-62-162-70.sslip.io/apk/bargu-e77be02-524fa0c7e6a22f37.apk>

5. `+` > "Buluşma başlat" > bir çember > yer ve saat > başlat. Diğer telefonda tek bildirim
   ("… buluşma başlattı: 17:30 · Ev"); uygulama açıksa kısa bir uyarı.
6. Haritada buluşma kayıtlı yerden farklı görünür (mercan, kesikli kenar, bayrak, saat); dokununca
   buluşma ekranı açılır. Evde buluşulsa da ev o sırada buluşma gibi çizilir.
7. Buluşma ekranında "Yol tarifi" yalnızca dokununca harita uygulamasını açar; "Geldim" diğer
   telefonda "geldi" yapar. Mahalle ya da şehir hassasiyetinde paylaşan "yolda" ya da "geldi"
   görünmez.
8. Grupta başlatmayan ve yönetici olmayan üye buluşmayı değiştiremez ve bitiremez; ikinci buluşma
   başlatılamaz ("Bu çemberde zaten bir buluşma var"). "Buluşmayı bitir" ile haritadan hemen kalkar.
   Arkadaşlıkta iki kişi de bitirebilir: sunucu hazır, öbür kişinin düğmesi bir sonraki APK'da.

Kısayollar ve sayaç, QA 21 ve ikili eşitlik, APK (`c3a9729`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-c3a9729-703c4b1241e99fb2.apk>

9. Haritanın sağında üç düğme: hayalet (tek dokunuşla açılır, kapatırken "Konumun yeniden
   paylaşılacak: N çember" sorar), buluşma başlat; haritayı kaydırınca "Konumuma dön" çıkar. Bir
   kişinin kartı açılınca düğmeler çekilir.
10. Bir buluşma başlatınca üstte çip: "🏠 Ev · 17:30"; son bir saatte "· 25 dk", son 10 dakikada
    renkli; saatinde "1/2 geldi". "Buluşma başlat" düğmesi çip varken kalkar; saatine 15 dakika
    kala "Geldim" düğmesi çıkar.
11. Mahalle hassasiyetinde paylaşan arkadaş "yolda" sayılmaz (toplamda kalır). İkiniz de tam
    konumla geldiğinizde bir kez konfeti.
12. Arkadaşlıkta (ikili) arkadaş da buluşmayı değiştirir ve "Buluşmayı bitir"i görür. Duraklamış
    çemberde "geç kalıyorum" gitmez.

Efektler ve sade mod, APK (`43ff254`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-43ff254-5ec235ef4e09675d.apk>

13. Harita ilk açılınca sağdaki düğmeler sırayla zıplayarak gelir; bir kart kapanınca sakince
    belirir. Hayalet açılınca simge birkaç kez süzülüp durur, kapanınca "pof"; "Konumuma dön"de
    halka yayılır; "Geldim" belirince 3 nabız atar.
14. Ben > Efektler: "Az" seçince arkadaşların avatarları yalnızca yeni konum gelince bir kez
    kıpırdar, hava durağan; "Kapalı"da hiçbir şey kıpırdamaz, titreşim yok.
15. Hava (yağmur, güneş, yıldız) harita açılınca yaklaşık 20 saniye oynar, sonra donar; haritaya
    dokununca ya da kaydırınca yeniden oynar. Pil tasarrufunu açınca "az" gibi davranır.

Tema ve pin, APK (`2c89424`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-2c89424-80efcb6d3c0db7e6.apk>

16. Koyu temada yüzeyler lacivert-mor; seçili seçenekler dolu mor ve hafif parlak. Ben sayfasında
    satırlar kartlarda, seçeneklerde simgeler, açıklamalarda ⓘ.
17. "Seni görüyor" iki satır: altta "Konumun şu an paylaşılıyor"; hayalet "Gizle"de "gizli",
    "Dondur"da "donduruldu", paylaşım kapalıysa "kimseyle paylaşılmıyor" yazar. Yanında hava kartı
    (sıcaklık ve ilçe adı).
18. Hayalet düğmesinde mor nokta konum paylaşılırken görünür; hayalet açılınca kalkar.
19. Kişiler pin: mor halkalı daire, aşağı uç, konum noktası, konumu tazeyken yeşil nokta; eski
    konumda gri ve "23 sa". Birlikte duran iki kişi tek ortak pinde.
20. Alttaki çubukta haritadayken "Çemberler", Ben açıkken "Ben" mor ve altı çizili.

Konum doğruluğu, buluşma kartı ve QA 23–24, APK (`7f4d989`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-7f4d989-844b6872707f2f20.apk>

21. Harita açıkken yürüyün: kendi pininiz saniyede bir akar; ekranı kapatıp açınca normale döner.
22. Araçta virajlı yolda arkadaşın pini yoldan çıkıp dümdüz gitmez; en çok bir saniye önde olur ve
    virajda hiç önde olmaz. Pin hiç geri sıçramaz.
23. Kapalı alanda (AVM, ev içi) bir süre sonra konum soluk bir daireyle görünür.
24. Uygulama yeni açılınca "seni görüyor" bir an "Kontrol ediliyor…" der; süreli paylaşım bittiği
    an yazı ve hayalet düğmesindeki nokta birlikte değişir.
25. Pil tasarrufu açıkken Ben > Efektler'de "Pil tasarrufu nedeniyle şu an Az" notu.
26. Ölçüm katmanı: Ben > (en altta, geliştirici satırları) "Geliştirici: ölçüm katmanı". Haritanın
    solunda küçük bir pano açılır; × ile kapanır, aynı satırla yeniden açılır.
    - "Örnek: servis 5,0 sn · canlı 1,0 sn": telefonun konumu ne sıklıkla aldığı (servis arka
      plan, canlı harita açıkken).
    - "Gecikme 0,4 sn · doğruluk ±8 m": son konumun ölçülmesiyle telefona ulaşması arası; ne kadar
      kesin olduğu.
    - "Gönderim: 5,0 sn (normal / canlı)": arkadaşlara ne sıklıkla gittiği; biri izliyorsa canlı.
    - "Atılan: eski · bayat · zayıf · sıçrama" ve "Kapalı alanda gönderilen": filtrenin yaptığı.
    - Her arkadaş için "gecikme · aralık · ±m · geç": konumunun kaç saniye geç ve kaç saniyede bir
      geldiği, doğruluğu ve sırası bozuk gelip gösterilmeyenler.
    - "Ekran: fps · en kötü kare": akıcılık.
      Yürürken ve araçta birkaç dakika açık tutup ekran görüntüsü yeterli.
27. Bir etkinliğin birbirine yakın iki adayı haritada tek kartta alt alta görünür; ikisine de ayrı
    ayrı dokunulabilir. Yakınlaşınca kendi etiketlerine ayrılırlar.

Hareket çizimleri (B), APK (`bc5f925`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-bc5f925-7cc5c5d5af18ee06.apk>

28. Yürürken ve koşarken pinin köşesindeki insanın dizi ve kolları bükülerek sallanır; gömleği
    kişinin renginde. Bisiklette bacaklar pedalı izler.
29. Araçta tekerlekler hıza göre döner; şehirde arkadan duman, yolda hava çizgileri. Rozet geniştir.
30. 120 km/sa üstünde (yalnızca "Hızımı göster" açık ve tam konumla) yarış arabası ve arkada düz
    çizgiler; 200 üstü tren, 300 üstü uçak. Kutlama, ses, rozet yok.
31. Kendi telefonunda "Hızımı göster"i kapatınca kendi pinin en fazla araba gösterir.
32. Ben > Efektler "Az": çizim her yeni konumda bir kez oynar; "Kapalı": hiç oynamaz.
33. Bozuk bir davet bağlantısı (ör. sonuna %E0%A4%A eklenmiş) uygulamayı dondurmaz, haritayı açar;
    doğru davet bağlantısı davet ekranını açar.

UX düzeni, APK (`8e965a2`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-8e965a2-713b98389b35f572.apk>

34. Ben: profilin hemen altında "Konum ve gizlilik" (hayalet, "Kimler konumumu görüyor", konum
    geçmişim); sonra Bildirimler, Görünüm ve harita, Güvenlik, Bargu+ ve hesap, Uygulama başlıkları.
35. Ben > Bildirim tercihleri: bildirim izni, telefon ayarları; sessize aldığın kişiler ve yerler,
    her birinde "Sesi aç".
36. Haritada birine dokun: kartın sağ üstünde zil ve ×. Zile basınca sessize alma; sessize alınca
    zil çizili ve adının altında "Sessizde". × kartı kapatır. Alttaki düğme "Arkadaşlık" ya da
    "Çember" yazar.
37. "Seni görenler"de her çemberin altında "Bu çemberin paylaşım ayarı" o çembere götürür.
38. Ortadaki + : başlığı "Ekle", içinde "Çember oluştur".
39. Çemberler: hiç grubun yoksa "Gruplar" başlığı altında açıklama ve "Çember oluştur".
40. Bir çemberin ekranında "Çemberden ayrıl" bir çizginin altında, ne anlama geldiğiyle.

Donma düzeltmesi, APK (`225e8a0`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-225e8a0-68780a3c6b1273ad.apk>

41. Yürürken ya da araçtayken (kendi pininde ya da arkadaşınkinde hareket çizimi oynarken)
    uygulama ve telefon donmaz.

Kendi kartın ve ayar ekranları, APK (`e8a07df`, öncekilerin yerine):
<https://api.46-62-162-70.sslip.io/apk/bargu-e8a07df-3b41aea49bec83d1.apk>

42. Haritada kendi pinine dokun: diğerlerindeki gibi kart açılır. Durumun, "Konumunu görenler: N"
    (kimse yoksa "Konumun şu an kimseye gitmiyor", hayalette "Hayalet açık: …"), "Pil %…" ve
    hayalet. Düğmeler: Kimler görüyor, Durum, Geçmiş, Ayarlar. Dürt ve buluşma yok.
43. Ben: profil, durum ve satırlar. Her satır kendi ekranını açar: Konum ve gizlilik, Bildirimler,
    Görünüm ve harita, Güvenlik, Bargu+, Hesap ve veri, Uygulama. Geri gelince Ben yeniden açılır,
    kaldığın yerde.
44. Çemberler'den bir çembere girip geri gelince Çemberler sayfası yeniden açılır.
45. Bir çemberin ekranında "Konumun" (ör. "Tam konum · sen kapatana kadar") ve "Yerler"
    ("Yerler: 2") birer satır; dokununca kendi ekranları açılır.

### Senden gerekenler

- Son APK'yı bütün telefonlara (kendi, şirket telefonu, Seko) kur; bitince söyle ki kapı
  (doğrudan seviye 3) açılabilsin.
- Dilim 3b ve sonrası için karar (durum analizinden sonra).

## Faz 9 — Güvenlik Özellikleri & Uyum (2026-10-16)

Kararlar: [ADR 0020](ADR/0020-circle-admins-and-planning-authority.md) (çember yöneticileri ve
planlama yetkisi), [ADR 0021](ADR/0021-safety-features.md) (güvenlik özellikleri, uzaktan iptal),
[ADR 0022](ADR/0022-account-deletion-export-consent.md) (hesap silme, dışa aktarma, KVKK rızası,
yayın sayfaları), [ADR 0023](ADR/0023-age-15-plus.md) (yaş 15+, 15–17 kuralları, ebeveyn araçları).
Faz altı dilimde yapıldı; her dilimden sonra test oturumu ayrı bir QA turu yaptı (rapor 6–17). Son
Android sürümü: yerel derleme `2d4178b`,
<https://api.46-62-162-70.sslip.io/apk/bargu-2d4178b-38982e0c43341dac.apk>. Sonraki tek sunucu
düzeltmesi (K2b-1) uygulamayı değiştirmez, staging'e kendiliğinden gider.

Proje sahibi fazı 2026-10-16'da onayladı ("Faz 9'u onaylıyorum; Faz 9B önerilen sırayla başlasın").
Rapordan sonra eklenenler: telefon denemesinden çıkan anahtar değişikliği düzeltmesi (`966b89b`,
`0211532`: kabul edilen anahtar bütün ortak çemberlere gider, güvenlik numarası taze anahtarla
hesaplanır ve tutmazsa nedenini söyler); proje sahibinin isteğiyle haritada çıkartma ve ada,
birlikte duranlar için ortak çerçeve (`5f1b18b`, `37a9e20`, `cd6e219`, `81a811a`). Son Android
sürümü `81a811a`.

### Bitiş şartları (DoD)

| Ölçüt                                                              | Durum                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OWASP MASVS-PRIVACY kontrol listesi                                | 2 karşılanıyor, 2 kısmen; kalanlar belge ve Faz 10 ([kontrol listesi](MASVS-PRIVACY-Faz9.md)). Karşılanan: veri azaltma, kullanıcı kontrolü. Kısmen: kimlik belirlemeyi önleme (sunucunun gördüğü sosyal grafik kabul edilmiş; G-2, S-1) ve şeffaflık (Play veri güvenliği belgesi eskimiş, gizlilik sayfasında boşluklar). Analitik, reklam, kilitlenme ya da izleme kitaplığı yok       |
| Hukuki görüş                                                       | Avukat ertelendi (proje sahibi kararı). Yerine ön araştırma ([yaş ve KVKK](arastirma/yas-siniri-ve-kvkk.md), [vergi](arastirma/bireysel-vergi.md)) ve ADR 0023. Avukata sorulacaklar araştırmanın 4. bölümünde                                                                                                                                                                            |
| Yaş ADR'si yazılı                                                  | ✅ ADR 0023. e-Devlet yaş belirteci için Cumhurbaşkanlığı'na mektup taslağı: [yazismalar/0001](yazismalar/0001-sgb-yas-dogrulama-kilavuzu.md). Belirteç gelene kadar kapalı test                                                                                                                                                                                                          |
| Rıza ekranları amaç başına ayrı (test)                             | ✅ ADR 0022: aydınlatma ile rıza ayrı, birleşik "okudum, kabul ediyorum" kutusu yok. Ana hizmet (canlı konum) sözleşmenin ifasına dayanır; açık rıza yalnızca konum geçmişi için: ayrı ekran, işaretli kutu yok, geri çekilebilir, sunucu rızasız parçayı reddeder. Arka planda konum ve bildirimler bağlam içinde ayrı izinlerle istenir. Ekran ve geri çekme testleri yeşil (QA 10, 11) |
| Faz 8 QA bulguları O2, O3, O4, O5, G2, G3 kapalı, senaryolar yeşil | ✅ QA 6 (O2, O3, O5, G2, G3) ve QA 7 (O4). G2'nin iOS eksiği (QA 6 B3) dilim 3a'da kapandı                                                                                                                                                                                                                                                                                                |
| iOS privacy manifest ve App Store etiketi                          | iOS sürümüne kaldı (Apple geliştirici hesabı yok)                                                                                                                                                                                                                                                                                                                                         |
| Play: arka planda konum beyanı, video, veri güvenliği formu        | Metinler hazır: [docs/play-store](play-store/KONTROL-LISTESI.md) (kontrol listesi, izinler, veri güvenliği, gizlilik politikası, mağaza metni). Video ve formlar Play hesabı açılınca                                                                                                                                                                                                     |

### Yapılanlar

1. **Gizlilik açıkları** (`206dbc1`, düzeltme `7a1ba92`): çemberden çıkınca geçmiş kapanır ve
   dönünce kapalı başlar (W4); etkinlik QR'ları iptal edilebilir (O2, O3); hatırlatıcılar temizlenir
   (O5); uygulama kapalıyken "artık geçmişini de görebilir" uyarısı (G2); geçmiş listeleme sınırı (G3);
   15 sn zaman aşımı ve yalnızca iki kez gitmesi güvenli isteklerde tek yeniden deneme; "Çember
   bulunamadı" yarışı; kişi kartı düğmeleri.
2. **Çember rolleri ve planlama yetkisi** (`544a8f9`, ADR 0020): grup ve etkinlik yöneticileri;
   buluşma ve oylamaları yalnızca yöneticiler kurar, sunucu denetler (O4); aynı QR ile kişi başına tek
   giriş (O6); buluşma noktaları haritada bayrak.
3. **Güvenlik özellikleri** (`296ae9b`, `59b313b`, ADR 0021): haftalık "kim görüyor" hatırlatması
   (geçmiş dahil), yeni izleyici bildirimi, "Tümünü durdur", biyometrik uygulama kilidi, güvenlik
   olayları listesi, kişi kartından "Buluş"; telefonu olmayan kişi için e-posta kodlu hesap sayfasından
   uzaktan cihaz iptali (`/hesap`).
4. **KVKK ve Play** (`1a9aba4`, düzeltme `ea2c25e`, ADR 0022): uygulamadan ve web sayfasından hesap
   silme (hemen kapanır, en geç 7 günde tamamen silinir), veri dışa aktarma, amaç başına ayrı rıza ve
   rızayı geri çekme (sunucudaki geçmiş de silinir), `/gizlilik` sayfası, güvenlik olaylarının 90
   günde silinmesi, Play metinleri.
5. **Yaş 15+** (ADR `0ec0cc4`; `c2bace0`, `4437080`, `cfe3c3b`, düzeltme `0ab70e8`; ADR 0023): hesap
   açarken yaş grubu; 15 yaşından küçük hesap açamaz; 15–17 için kapalı varsayılanlar (yeni çemberde
   konum kapalı, kullanıcı adıyla bulunamaz); "Kullanıcı adımla bulunabilirim" ayarı; yüz yüze, iki
   taraflı ebeveyn bağlantısı; ebeveyn araçları (yeni kişiye onay, grupta yeni biri bildirimi, günlük
   kullanım süresi). Ebeveyn konum, geçmiş ya da yer görmez; çocuk her şeyi görür.
6. **Ölçek ve küçükler** (`c885798`, `2d4178b`, K2b-1 düzeltmesi): çok etkinlik aynı anda bitince
   süpürme (O1), 50 kişilik etkinlik yük testi (O7: hepsi ~8 sn'de katıldı), "Şimdi bitir" hemen
   biter, D1–D10, G4–G10 (toplu katılımda tek bildirim, "Geçmişimi de sil" sunucudaki bütün parçaları
   siler, ağ hatası "veri yok" gibi görünmez), hayalet modunda yeni izleyici, geri sayım halkası pil
   dostu, hesap sayfasında "bu tarayıcıyı tanıt" e-postası (K2b).

### QA turları

| Rapor | Neyi denedi         | Sonuç                                                                                                                                                       |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6     | Dilim 1             | O2, O3, O5, G2, G3, W4 geçti. Orta: B1 (zaman aşımında çift işlem) ve B2 (tekrar kabulde hata) → `7a1ba92`                                                  |
| 7     | Dilim 2 + B1, B2    | Orta ya da yüksek bulgu yok                                                                                                                                 |
| 8     | Dilim 3a            | Orta: "Buluş" çift etkinlik açabiliyordu; düşük/orta: kilit ekranı döngüsü → 3b'de kapandı                                                                  |
| 9     | Dilim 3b            | Orta: başkası adresin kod haklarını bitirip sahibi kilitleyebiliyordu (N1) → dilim 4'te ağ başına sınırlar                                                  |
| 10    | Dilim 4             | Orta: çok ağdan kilitleme (K2); orta/düşük: rıza geri çekilince sunucu kopyası kalıyordu (K3) → `ea2c25e`                                                   |
| 11    | Dilim 4 düzeltmesi  | Ürün hatası yok. IPv6 kovası (K2a) ve ilk kez gelen sahip (K2b) açık nokta → 6a ve 6b'de kapandı                                                            |
| 12    | Dilim 5a            | Orta/düşük: kullanıcı adı müsaitliğinden 15–17 sezilebiliyordu (Y2) → 5b'de "bulunabilirim" ayarı                                                           |
| 13    | Dilim 5b            | Orta/düşük: ebeveyn üçüncü kişilerin kullanıcı adını görüyordu (G-1) → yalnız görünen ad                                                                    |
| 14    | Dilim 5c            | Orta: çocuğun kendi davetleri onaysızdı (F-2); orta/düşük: kurallar yalnız bellekteydi (F-1); düşük: geçersiz tarihte 500 (F-3) → `0ab70e8`                 |
| 15    | 5b ve 5c düzeltmesi | Orta/düşük: başka üyenin koduyla gelen onaysız giriyordu (S-2) → PM kararı: ebeveyne bildirim (6a). S-1 kabul edilen risk                                   |
| 16    | Dilim 6a            | Orta ya da yüksek bulgu yok. Düşük: S-4, Y1b (6b'de kapandı), G-5                                                                                           |
| 17    | Dilim 6b            | Orta ya da yüksek bulgu yok. Düşük: K2b-1 (bu raporla birlikte kapandı). Entegrasyon 3 kez, mobil 4 kez üst üste yeşil; 0024'ten 0027'ye yükseltme sorunsuz |

### Test sonuçları

| Paket              | Test | Not                                                                                                                          |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/crypto`  | 160  | + hesap sayfası "tarayıcıyı tanıt" bağlantısının sırrı; + 1 başarım testi                                                    |
| `packages/schemas` | 90   | + roller, güvenlik olayları, silme, dışa aktarma, rıza, yaş, ebeveyn, hesap sayfası                                          |
| Swift (CryptoKit)  | CI   | + yeni bildirim türleri (ebeveyn bildirimleri, iOS eklentisi)                                                                |
| API entegrasyon    | 202  | + roller, uzaktan iptal, hesap sayfası sınırları, silme (her yerden), dışa aktarma, rıza, yaş, ebeveyn, 50 kişilik yük testi |
| API birim          | 88   | + e-posta içerikleri, ortam ayarları                                                                                         |
| Mobil              | 373  | + kilit, hatırlatma, yeni izleyici, tümünü durdur, rıza ekranları, yaş, ebeveyn araçları, günlük süre, yeniden deneme        |

Biçim, gizli karakter, tip ve lint kontrolleri temiz. Faz 8 sonunda: crypto 155, API entegrasyon 142,
API birim 81, mobil 318.

### Kalan açıklar

**Faz 10 iş listesi:**

1. **S-4:** Çok sayıda yabancı hesap, bir çocuğun 20'lik ebeveyn onayı kuyruğunu doldurursa gerçek
   bir yeni gelen ebeveyn yanıtlayana ya da 7 gün dolana kadar giremez. Çözüm: çocuğun zaten arkadaşı
   olan kişi sınıra takılmasın (yeni migration).
2. **O5 kalanı:** Uygulama kapalıyken biten etkinliğin buluşma hatırlatıcısı, uygulama bir sonraki
   açılışa kadar telefonda kalabilir.
3. **Kilitli uygulamada bildirim hedefi:** Kilit açılınca uygulama haritadan başlar; kilitliyken
   dokunulan bildirimin ya da davet bağlantısının hedefi kaybolabilir.
4. **Ağ yakalaması (MASVS):** Telefonda ilk açılış, harita, bildirim ve paylaşım sırasında yalnızca
   kendi API'mize ve FCM'ye gidildiğini ağ yakalamasıyla doğrulamak (NetInfo dahil).
5. **Üretim paketi (MASVS):** Üretim derlemesinde geliştirici başlatıcısının (`expo-dev-client`)
   bulunmadığını doğrulamak; isteğe bağlı CycloneDX SBOM çıktısı.
6. **Play veri güvenliği belgesi** (`docs/play-store/VERI-GUVENLIGI.md`) eskimiş: yeni veri türleri
   (yaş grubu, rıza kayıtları, ebeveyn bağlantısı, kullanım dakikaları, güvenlik olayları) ve hesap
   silme eksik. Play hazırlık oturumu güncelliyor.

**Kabul edilen riskler (ADR'lerde yazılı):**

1. **Yaş beyana dayalı (Y3):** Hesabı silip yeniden açarak ya da "18+" seçerek atlatılabilir.
   e-Devlet yaş belirteciyle kapanacak; o zamana kadar kapalı test.
2. **S-1:** Gözetimli çocuğun kodunu tarayan kişi "ebeveyn onayı gerekiyor" cevabından kodun
   sahibinin çocuk olduğunu sezebilir (kodun sahibini zaten görmüştür).
3. **S-2 kararı:** Çocuğun grubuna başka bir üyenin koduyla gelen kişi beklemeden girer; ebeveyne
   "grupta yeni biri" bildirimi gider.
4. **G-2:** Yetişkinler varsayılan olarak bulunabilir olduğu için "kullanıcı adı alınmış ama
   bulunmuyor" durumu yine de 15–17'ye işaret edebilir (olasılıksal).
5. **F-1 kalanı:** Günlük süre sınırı telefonun saatini geri alarak ya da uygulama verisini silerek
   atlatılabilir; kural hiç almamış yeni bir kurulum çevrimdışıyken sınırsızdır. Sınır bir güvenlik
   değil, ebeveynin koyduğu bir kuraldır.
6. **Ebeveyn görünümü:** Ebeveyn çocuğun çemberlerindeki kişilerin yalnız görünen adını görür; konum,
   geçmiş ya da yer görmez. Çocuk 7 gün sonra bağlantıyı bitirmeyi isteyebilir.
7. **Çocuğun ayarına başkası dokunursa 404** (kaynağı gizlemek için, 403 değil).
8. **Etkinlik QR'ı:** Kodu yapan ayrılınca ya da yöneticilikten çıkınca kodu çalışmaz (D7, bilinçli);
   migration 0013'ten önce açılmış etkinlik kodları bir kez daha kullanılabilir (N1, etkinlikler en
   çok bir hafta).
9. **Hesap sayfası e-postası:** Biri bir adrese günde en çok 50 kod ve 1 "tarayıcıyı tanıt" e-postası
   gönderdirebilir (tavan).
10. **Oturum yenileme** zaman aşımında yeniden denenmez; zayıf ağda bir kez başarısız olabilir, oturum
    düşmez.
11. **Geçmiş silme ölçütü:** Bir parça sunucuda 14 gün 25 dakikaya kadar kalabilir (G10).
12. **Test altyapısı (G-5):** Aynı test veritabanına aynı anda tek entegrasyon süreci bağlanmalı.

### Telefonda denenecekler (proje sahibi)

Hepsi kodda ve testlerde geçti; cihazda denenmedi. **iPhone hiç denenmedi** (Apple hesabı yok).

1. Yeni hesap: yaş sorusu; "15–17" seçince yeni bir çemberde konum kapalı başlasın.
2. Ebeveyn: iki telefonla yüz yüze bağlantı kur; ebeveynde çocuğun çemberleri, yeni kişiye onay,
   günlük süre sınırı (uçak modunda açınca da).
3. Kilit: Ben → Güvenlik'ten aç; 1 dakikadan uzun arka planda kalınca sorsun, "Vazgeç"te takılmasın;
   kilitliyken konum paylaşımı sürsün.
4. "Tümünü durdur" ve "Paylaşmaya devam et"; hayalet modunda biri katılınca "katıldı", hayalet kalkınca
   "artık konumunu görebilir".
5. Geçmiş: rıza ekranı, açma, "Geçmişimi de sil" (diğer telefonda iz gitsin), hassasiyeti düşürünce
   kapanması, uçak modunda "yüklenemedi".
6. Hesap: "Verilerimi indir", bilgisayardan `/hesap` sayfasıyla telefonu çıkarma (eski telefon kendini
   kapatsın), bir test hesabıyla hesap silme.
7. Etkinlik: kişi kartından "Buluş", haritada buluşma bayrağı, "Şimdi bitir", çevrimdışı "Geç
   kalacağım".
8. Kilit ekranında bildirim metinleri (yeni izleyici, ebeveyn bildirimleri).

### Senden gerekenler

1. Yukarıdaki listeyi telefonda dene (botla da olur).
2. Gizlilik sayfasındaki boşluklar için bilgiler: ad soyad, adres, destek ve güvenlik e-postası,
   e-posta servisi. Gelince doldururum.
3. Cumhurbaşkanlığı'na yaş belirteci mektubu ([taslak](yazismalar/0001-sgb-yas-dogrulama-kilavuzu.md)):
   göndermek sende.
4. Uygunsa Faz 9'u onayla. Sonraki fazın sırasını PM belirler.

## Faz 8 — Etkinlik Çemberleri (2026-10-15)

Kararlar: [ADR 0017](ADR/0017-event-circles.md) (etkinlik çemberleri),
[ADR 0018](ADR/0018-event-planning.md) (etkinlik planlama, proje sahibinin isteği),
[ADR 0019](ADR/0019-location-history.md) (çember geçmişi, proje sahibinin isteği; kuralları
BARGU_PLAN `62a33a7`). Commit'ler: `8621727` (etkinlik), `33c7d5f` (planlama), `846bd20`
(geçmiş); QA düzeltmeleri `127245c` (Y1, Y2), `b72235d` ve `2913e7f` (G1, G6). Android: yerel derleme
`2913e7f`, <https://api.46-62-162-70.sslip.io/apk/bargu-2913e7f-d3235c27d4a846cf.apk> (tüm CI yeşil,
staging'de).

Proje sahibi fazı 2026-10-15'te onayladı. Telefonda test arkadaşıyla denendi: etkinlik daveti,
buluşma kartı, oylama, "Kim ne zaman orada?", otomatik ve elle "geç kalacak", geçmiş, etkinliği
bitirince her şeyin silinmesi (sunucuda da kontrol edildi). Denemede çıkan iki hata ve iki istek
("Çember bulunamadı" yarışı, kabulde 15 sn gecikme, buluşma noktalarının haritada ayrı görünmesi,
çember rolleri) BARGU_PLAN Faz 9'da.

### DoD

| Ölçüt                                                    | Durum                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Süre dolunca sunucuda çembere ait hiçbir kayıt kalmaz    | ✅ Entegrasyon testi: etkinliğe anahtar, konum, durum, profil, yer, buluşma, geçmiş parçası, dürtme, davet, bekleyen bildirim ve olay akışı kaydı yazılır; süre dolup temizlik çalışınca veritabanının bütün tablolarında, iş kuyruğunda ve Redis'in bütün anahtar ve değerlerinde çemberin kimliği hiç geçmez |
| Telefon bitişte çemberi ve anahtarlarını kendisi siler   | ✅ Kodda var (bitiş saatinde ve uygulama öne gelince). Birim testi yalnızca bitiş saatini hesaplayan yardımcılarda; zamanlayıcının kendisi testsiz (QA #2, Faz 9)                                                                                                                                              |
| Geçmiş kapalı başlar; açılmadan hiçbir parça gitmez      | ✅ Telefon testi                                                                                                                                                                                                                                                                                               |
| Katılmadan öncesi okunamaz; çıkarılan yeniyi açamaz      | ✅ Sunucu (satır güvenliği) ve telefon (anahtar) testleri                                                                                                                                                                                                                                                      |
| "Kimler görüyor" doğru; yeni izleyici bildirimi          | ✅ Telefon testi                                                                                                                                                                                                                                                                                               |
| Kapatınca sunucudan silinir; 14 günden eskisi kalmaz     | ✅ Telefon (çevrimdışıysa bağlanınca) ve sunucu (işçi) testleri                                                                                                                                                                                                                                                |
| Sunucuda, log'da, Redis'te düz koordinat yok (geçmiş de) | ✅ Mevcut otomatik test geçmiş parçasını da kapsıyor (koordinatın iki biçimi de aranıyor)                                                                                                                                                                                                                      |

### Yapılanlar — etkinlik çemberleri

- Yeni çember türü **Etkinlik**: ad ve bitiş (1 saat, 3 saat, bu gece, yarın gece, 1 hafta).
  Oluşturunca QR doğrudan açılır; QR / link etkinlik bitene kadar 50 kişiye kadar geçerli
  (gruplarınki tek kullanımlık, 24 saat). Okutan önizlemede bitişi ve "bitince her şey silinir"i
  görür, "Katıl"a kendisi basar.
- **Geri sayım halkası** çember listesinde ve çember ekranında; "Bitiş: 22:00 · 2 sa 14 dk kaldı".
  Sahibi "Etkinliği şimdi bitir" diyebilir.
- **Bitişte silme**: sunucuda işçi yarım dakikada bir siler (anahtarlar, üyeler, yerler,
  buluşma, geçmiş, davetler, Redis, olay akışları, bekleyen bildirimler); telefon da bitiş saatinde
  çemberi ve anahtarlarını kendisi atar.

### Yapılanlar — etkinlik planlama (proje sahibinin isteği)

- **Buluşma**: etkinlik ekranında saat (çeyrek saat adımlarla) ve yer (etkinliğin yerlerinden biri;
  "Yeni yer ekle"). Yer olduğu için oraya varınca herkese "vardı" bildirimi kendiliğinden gelir.
  Saat ve yer şifreli; sunucu göremez.
- **Oylama**: saat ya da yer için 2–4 seçenek; herkes uyanları işaretler (birden çok). Başlatan ya
  da etkinliğin sahibi bitirir; en çok oyu alan buluşmaya işlenir. Herkesin her oylamada tek oyu var,
  kimse başkası adına oy veremez.
- **"Kim ne zaman orada?"**: buluşmadan 90 dk önce ile 30 dk sonrası arasında herkes için "Orada",
  "~19:12" ya da "~19:40 · 15 dk geç". Tahmini her telefon kendisi yapar ve konumunun içinde şifreli
  gönderir (yalnızca tam konumda).
- **Tahmin nasıl yapılıyor** (proje sahibinin sorusu: Google mı?): Google'a sormak kişinin tam
  konumunu ve gideceği yeri Google'a vermek olurdu, yapılmadı. Yola çıkmadan önce mesafe ve nasıl
  gelindiği (yürüyerek / bisiklet / araç; kişi seçebilir), yolda ise kişinin son 10 dakikada
  gerçekte ne hızla yaklaştığı: trafikte yavaşlarsa tahmin kendiliğinden uzar.
- **"Geç kalacak"**: tahmin buluşmayı 10 dakikadan fazla aşar ve bu 3 dakika sürerse diğerlerine
  kendiliğinden şifreli bildirim gider ("Ali yaklaşık 15 dk gecikecek"); gecikme büyürse yeniden.
  Kişi "Geç kalacağım" deyip 10 / 20 / 30 / 45 dk seçerek kendisi de bildirebilir.
- **Çıkış hatırlatıcısı**: yola çıkılması gereken zamandan 15 dk önce telefonun kendi bildirimi
  ("Buluşmaya yetişmek için 15 dk içinde çıkmalısın"); kişi yola çıkınca geri alınır, kapatılabilir.
  Yeni bildirim kanalı: "Buluşmalar".

### Yapılanlar — çember geçmişi (proje sahibinin isteği)

- Kişi kartında ve basılı tutma menüsünde **Geçmiş**: seçilen günün rotası haritada çizgi,
  duraklar nokta; altta "🏠 Ev · 22:10 – 08:35", "Araçla · 12,4 km · 08:35 – 09:05" gibi zaman
  akışı; son 14 gün.
- **Kapalı başlar** (plan, `62a33a7`): çember ekranındaki "Konum geçmişi (14 gün)" açılmadıkça
  hiçbir iz yazılmaz ve gönderilmez. Yalnızca tam konum paylaşılırken yazılır.
- Açıkken altında kimlerin görebildiği yazar; **"Geçmişini kimler görüyor"** ekranı (profil
  sayfasında "Konum geçmişim") bütün çemberleri ve kişileri listeler. Çembere yeni biri girince
  "Artık X de … geçmişini görebilir" bildirimi.
- **Tek dokunuşla kapanır**, kapatınca sunucudaki parçalar da silinir.
- İz telefonda şifrelenir; sunucu konumu göremez, 14 gün sonra siler. Sonradan katılan öncesini
  göremez; ayrılanın izi o çemberden silinir.

### Test sonuçları

| Paket              | Test | Not                                                                                                |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------- |
| `packages/crypto`  | 155  | + belge zarfı, oy kimliği, geçmiş anahtarı ve zarfı (canlı mesajla karışmaz); %100 kapsam          |
| `packages/schemas` | 90   | + etkinlik, buluşma, oylama, oy, geç kalma, geçmiş                                                 |
| Swift (CryptoKit)  | CI   | + "geç kalacak" bildirim gövdesi (iOS eklentisi de yazıyor)                                        |
| API entegrasyon    | 142  | + etkinlik (DoD dahil), belgeler (ortak/kişisel kuralları), geçmiş (katılım öncesi, silme, 14 gün) |
| API birim          | 81   | —                                                                                                  |
| Mobil              | 318  | + geri sayım, planlama modeli, tahmin, gecikme, hatırlatıcı, belge saklama, geçmiş, kimler görüyor |

### Açık riskler

1. **Telefonda denenmedi**: yeni sürüm `846bd20` ile denenmeli (aşağıda).
2. **Tahmin kaba olabilir** (trafik verisi yok): yolda gerçek ilerleme bunu büyük ölçüde düzeltir.
   Uzaktayken (3 km+) yürüme hızında ilerleme tipik tahminle karşılanır; ağır trafikte gecikme
   geç fark edilebilir. Elle "Geç kalacağım" her zaman var.
3. Android'de zamanlanmış hatırlatıcı birkaç dakika kayabilir (tam zamanlı alarm izni istenmedi).
4. Konumu kimseyle paylaşmayan telefon kendi konumunu almaz: hatırlatıcı, otomatik gecikme ve
   geçmiş çalışmaz (elle bildirim çalışır).
5. Geçmiş: sunucu kimin hangi çeyrek saatlerde izi olduğunu ve parça boyutunu görür (konumu değil).
   Partner takibi riski: kapalı başlama, kimler görüyor ekranı, yeni izleyici bildirimi ve tek
   dokunuşla kapatma bunun için. 7 günlük paylaşım hatırlatmasında geçmiş Faz 9'da yazacak.
6. Geçmiş: telefonu değişen kişinin eski izi doğrulanamadığı için gösterilmez; iki anahtar
   yenilemesinden uzun çevrimdışı kalan telefonun o arası gönderilemez.
7. Geçmişte "son 14 gün" Bargu+ özelliği; ödeme Faz 9B'de. O zamana kadar herkes deneme sayılıyor.
8. Etkinlikte sunucudaki silme ile telefondaki silme arasında en çok yarım dakika fark olabilir.
9. iPhone denenmedi (Apple hesabı).

### Senden gerekenler

1. Yeni sürümü kur, birkaç şey dene: etkinlik oluştur (QR açılır), buluşma saati ve yeri seç,
   saat ya da yer oylaması başlat ve oy ver, "Geç kalacağım"; bir çemberde "Konum geçmişi"ni aç,
   biraz dolaş, "Geçmişimi gör" ve "Kimler görüyor?"a bak.
2. **Geçmişin varsayılanı**: bana önce "açık başlasın" demiştin; plan (`62a33a7`) "kapalı
   başlar" diyor, plana göre kapalı yaptım. Böyle kalsın mı?
3. Uygunsa Faz 8'i onayla; sonraki faz Faz 9 (güvenlik özellikleri ve uyum).

## Faz 7 — Yerler & Bildirimler (2026-10-14)

Kararlar: [ADR 0015](ADR/0015-encrypted-places-and-arrivals.md) (şifreli yerler, varışı telefon
algılar), [ADR 0016](ADR/0016-sealed-push-notifications.md) (bildirimler uçtan uca şifreli; ADR
0010'un yerine). Android: yerel derleme `a84a014` (staging'den indirilir; tüm CI yeşil:
Swift/CryptoKit ve iOS eklentisi dahil).

Proje sahibi fazı 2026-10-15'te onayladı; telefondaki denemeler (yer ekleme, uygulama kapalıyken
"vardı" bildirimi, sessize alma, yeniden kurulumda fotoğrafın dönmesi) sona bırakıldı (aşağıdaki
tabloda).

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
  şifreli bildirim gider), `leave` (ayrılır); dürtmeleri artık şifreli bildirimli. Eski epoch'ta
  kalan yerleri yeniden mühürler, arkadaşının fotoğraf anahtarını saklar ve telefonu değişince geri
  verir (gerçek bir arkadaş telefonu gibi).
- **Yeniden kurulum / yeni telefon** (proje sahibinin gözlemi, 2026-10-15): fotoğraf her yeniden
  kurulumda kayboluyordu. Artık çember arkadaşlarının telefonları anahtarı şifreli olarak geri
  verir; fotoğraf kendiliğinden döner (ADR 0014 eki). Gizlilik ayarları da yalnızca eski kurulumda
  kaldığı için yeni kurulum artık **hiçbir çembere konum göndermeden** başlar; haritada "Hepsiyle
  paylaş" ya da "Çemberleri tek tek seç" kartı çıkar (önceden sessizce herkese tam konum gidiyordu).

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

| Test                                                                   | Ne zaman              |
| ---------------------------------------------------------------------- | --------------------- |
| Ekran kilitliyken 10 dk sonra konum gidiyor mu                         | Uygun ilk denemede    |
| Uçak modu aç/kapa, Wi-Fi ↔ mobil veri sonrası kendiliğinden güncel     | Uygun ilk denemede    |
| 8 saatlik pil raporu (marka ve model ile)                              | Faz 10 öncesi         |
| İki gerçek telefonla uçtan uca p95                                     | İkinci telefon olunca |
| iOS kilitli ekran                                                      | Apple hesabı gelince  |
| Yer ekle; test arkadaşı `arrive` / `leave`: kapalı uygulamada bildirim | Uygun ilk denemede    |
| Kişi ve yer sessize alma                                               | Uygun ilk denemede    |
| Yeniden kurulum: fotoğraf geri geliyor, paylaşım kartı çıkıyor         | Uygun ilk denemede    |
| iPhone bildirim eklentisi (şifreli bildirimi açıyor mu)                | Apple hesabı gelince  |

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
- **2026-11-01**: 15 yaş altı sosyal ağ yönetmeliği yürürlükte; Bargu kapsamda varsayılıyor (ön araştırma
  `docs/arastirma/yas-siniri-ve-kvkk.md`, avukat ertelendi). Yaş sınırı 15+; yaş doğrulama ve 15–18 kuralları
  Faz 9'da ADR ile. Mevcut hesaplar için son tarih 2027-03-31.
