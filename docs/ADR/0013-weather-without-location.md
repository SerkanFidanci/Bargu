# 0013. Konumu vermeden hava durumu, haritada Skia efektleri

- Durum: Kabul edildi
- Tarih: 2026-10-14

## Bağlam

Proje sahibi haritada, kullanıcının bulunduğu yerdeki hava durumuna göre animasyon istedi
(yağmur, kar, güneş…). Hava durumu bir dış servisten gelir; konumu o servise ya da düz hâliyle
bizim sunucumuza göndermek kurallarımıza aykırı (BARGU_PLAN §1, §6).

## Karar

- **Herkese aynı ızgara**: işçi (worker, internete çıkabilen tek süreç) yarım saatte bir Türkiye'nin
  tamamı için 1°'lik ızgaranın (7 × 20 = 140 nokta) anlık hava durumunu Open-Meteo'dan çeker,
  Redis'e yazar ve Redis kanalıyla API'ye haber verir. Dışarı giden tek şey sabit ızgara
  noktalarıdır; hiçbir kullanıcının konumu yoktur.
- **Telefon kendi hücresini kendisi bulur**: `GET /v1/weather` herkese aynı dosyayı verir (~5 KB);
  telefon en yakın hücreyi yerelde seçer. Ne servis ne sunucu kimin nerede olduğunu öğrenir.
- **Yenileme yok**: yeni ızgara gelince API bağlı telefonlara `weather` canlı mesajı yayınlar;
  telefon bağlandığında ve bu mesajla dosyayı çeker.
- **Efektler Skia ile**: tek tuval, her kare UI thread'de hesaplanır; yağmur/çisenti (rüzgârla
  eğilen çizgiler), kar (salınan taneler), sis ve bulut (yavaş kayan bulanık şekiller), fırtınada
  şimşek, açık günde köşede yumuşak güneş, açık gecede yıldızlar. Sayılar ve süreler `motion.ts`
  `weatherFx` tokenlarında. Dokunuşu hiç almaz; "Hareketi azalt" açıksa çizilmez. Yanında
  "☀️ 24°" göstergesi.
- **Skia bağımlılığı** (`@shopify/react-native-skia` 2.6.2, Expo SDK 57'nin önerdiği sürüm,
  Shopify tarafından bakılıyor): sonraki adımlardaki sıvı kümeleme ve buluşma efekti için de
  gerekli. Kurulum betiği yalnızca kendi `react-native-skia-android` / `-apple-*` paketlerindeki
  hazır kütüphaneleri kopyalar (incelendi; ağ yok, komut yok) ve `allowBuilds`'a gerekçesiyle
  eklendi.

## Sonuçlar

- Çözünürlük ~100 km: yerel sağanakları kaçırabilir; ortam efekti için yeterli.
- Türkiye dışında hava efekti yok (ızgara dışı).
- **Open-Meteo ücretsiz katmanı ticari olmayan kullanım içindir** (günde 10.000 çağrı; ızgara
  günde ~6.700 çağrı). Yayından önce ticari plan ya da kendi Open-Meteo sunucumuz (açık kaynak)
  gerekir. Veri CC BY 4.0: atıf "Ben" panelindeki harita verisi satırında.
- Sunucu, telefonun hava dosyasını ne zaman indirdiğini görür (bağlantı zamanı kadar bilgi;
  içerik herkes için aynı).
