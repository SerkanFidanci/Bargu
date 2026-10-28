# 0036. Pil: uygulama kapalıyken konum, GPS'i dinlendirerek

- Durum: Önerildi (kodlama oturumu, 2026-10-28). Sahibin isteği; PM'in onayını bekliyor.
- Tarih: 2026-10-28
- İlgili: BARGU_PLAN §3.3 (sıklık tablosu, PM günceller), [ADR 0028](0028-location-accuracy-and-glide.md)
  (arka planda canlı konum), `apps/mobile/src/features/location/tracker.ts`

## Bağlam

Sahip, 2026-10-28: "çok fazla şarj tüketiyor. Açık değilken bile uygulama arkaplanda çalışırken
bile." Ve: "uygulama kapalıykende aktif konumun gösterilmesi lazım … life360 yapıyordu çok şarj
tüketmeden."

Ölçülen durum (kod):

- Konum servisi, en az bir çember tam konumu aldığı sürece GPS'i yüksek doğrulukla **her 5 saniyede**
  çalıştırıyordu. Mesafe filtresi yok, otomatik duraklama yok. Telefon masada dururken bile GPS hiç
  dinlenmiyordu.
- Uygulama kapalıyken her konum uygulamayı uyandırıyordu: dakikada 12 kez. Hareket hâlinde her 5
  saniyede bir ağ üzerinden gönderim oluyordu; radyo da hiç uyumuyordu.
- Gizli modda servis duruyor; canlı bağlantı (soket) arka planda kapanıyor; arka planda canlı konum
  saatte en çok 15 dakika ve düşük pilde, pil tasarrufunda kapalı. Bunlar doğru, değişmiyor.

Kısıt: Android, uygulama arka plandayken konum servisini başlatmaya da ayarını değiştirmeye de izin
vermiyor (`ForegroundServiceStartNotAllowedException`). Yani "durunca yavaşla, yürüyünce hızlan"
ayarı uygulama kapalıyken yapılamaz. Coğrafi çit (geofence) ise "her zaman konum" iznini ister; bu
Play'de ayrı bir beyan ve inceleme demek, bu ADR'nin konusu değil.

## Karar

Life360'ın yaptığı gibi: konum uygulama kapalıyken de paylaşılır ama GPS sürekli açık kalmaz.

1. **GPS 30 saniyede bir** (tam konum), Wi-Fi ve baz istasyonu **60 saniyede bir** (yalnız kaba
   konum). Arada GPS dinlenir.
2. **Uygulama kapalıyken toplu teslim:** sistem konumları biriktirir ve uygulamayı **dakikada en çok
   bir kez** uyandırır (`deferredUpdatesInterval`, Android ve iOS; uygulama ekrandayken uygulanmaz).
   Hareket hâlinde gönderim dakikada en çok bir kez. Duran telefon her 5 dakikada "buradayım" der
   (değişmedi).
3. **Biri bakınca canlı:** arkadaş haritayı açınca telefon 2 dakika boyunca saniyede bir gönderir
   (ADR 0028, saatte en çok 15 dakika). Haritası açık olan kendi telefonunda da saniyede bir
   (değişmedi). "Uygulama kapalıyken aktif konum" bu ikisiyle sağlanır: genelde en çok bir dakikalık,
   bakılınca canlı.
4. Eski konum sınırı (10 dakika, "Neden eski?") ve konum süzgeci (2 dakikaya kadar eski konumu kabul
   eder) bu sıklıkla çalışır; değişmedi.

## Sonuçlar ve riskler

- Beklenen: GPS'in açık kaldığı süre ve uyanma sayısı birkaç kat azalır (dakikada 12 uyanmadan 1'e).
  Gerçek fark sahibin telefonunda ölçülür: aynı gün, aynı kullanım, saatte yüzde kaç.
- Uygulama kapalıyken hareket eden birinin pini en çok yaklaşık bir dakika geriden gelir; biri
  bakınca canlıya döner.
- Daha fazlası (v2): durunca GPS'i tamamen kapatıp hareket algılayınca açmak. Bu ya yerel (native)
  bir modül ya da "her zaman konum" izni ister; PM kararı.
- Testler: `tracker.test.ts` bu ayarları sabitler; 5 saniyeye geri dönüş testten geçmez.
