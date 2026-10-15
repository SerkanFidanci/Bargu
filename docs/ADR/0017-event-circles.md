# 0017. Etkinlik çemberleri: süreli, QR ile katılım, bitince iz kalmaz

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

Faz 8: konser, gezi, maç gibi kısa süreli buluşmalar için süreli çember. Plan şartı: süre dolunca
sunucuda çembere ait hiçbir kayıt kalmaz; telefonlar anahtarları atar.

## Karar

- **Tür ve süre**: `event` türü (veritabanında baştan vardı) ve bitiş zamanı; en az 15 dakika, en
  çok 7 gün sonra. Hem API hem satır güvenliği (RLS) zorlar; diğer çemberlerin bitişi olamaz.
  Uygulama "1 saat, 3 saat, bu gece, yarın gece, 1 hafta" sunar.
- **QR ile katılım**: etkinliğin QR kodu / linki etkinlik bitene kadar 50 kişiye kadar geçerli
  (gruplarınki değişmedi: tek kullanımlık, 24 saat). Okutan kişi önizlemede etkinliği, bitiş saatini
  ve "bitince her şey silinir"i görür, "Katıl"a kendisi basar (kabul edilmeden hiçbir şey
  paylaşılmaz kuralı aynen). "Yenile" eski kodu iptal eder. Etkinlik oluşturulunca QR doğrudan açılır.
- **Geri sayım halkası**: çember listesinde ve çember ekranında, etkinliğin kalan payı kadar dolu
  halka; bitişe kadar UI thread'de boşalır (Reduce Motion'da durur, saatle güncellenir). Yanında
  "Bitiş: 22:00 · 2 sa 14 dk kaldı".
- **Bitişte silme (sunucu)**: işçi 30 saniyede bir `app.expire_event_circles()` çağırır; çember
  silinir ve onunla birlikte üyelikler, anahtar dağıtımları, davetler, yerler (veritabanı
  `ON DELETE CASCADE`). Ardından API'nin başka yerlerde tuttukları temizlenir: Redis'teki son
  konum / durum / profil zarfları ve çemberi anan bütün anahtarlar (hız sınırı sayaçları), üyelerin
  olay akışlarında çemberi anan kayıtlar, kuyrukta bekleyen bildirimler. Üyelere çember adı geçmeyen
  bir "çember listeni yenile" olayı gider (silinen çember yeniden bir yere yazılmasın diye).
- **Bitişte silme (telefon)**: telefon bitiş saatinde çemberi kendisi siler ve anahtarlarını atar
  (sunucudan haber gelmese, telefon çevrimdışı olsa bile; açılınca).
- **Erken bitirme**: sahibi "Etkinliği şimdi bitir" der; aynı silme hemen çalışır.
- **Log'lar**: istek log'ları zaten adres kalıbını yazar (`/v1/circles/:id`), çember kimliği yok.

## Sonuçlar

- DoD testi: etkinlikte anahtar, konum, durum, profil, yer, dürtme, davet, bekleyen bildirim ve olay
  akışı kayıtları oluşturulur; süre dolup temizlik çalışınca veritabanının bütün tablolarında, iş
  kuyruğunda ve Redis'in bütün anahtar ve değerlerinde çemberin kimliği hiç geçmez.
- Sunucu bir etkinliğin var olduğunu, kaç kişi olduğunu ve ne zaman bittiğini bilir (metadata);
  bitince bunlar da silinir.
- Etkinlik QR'ı ele geçerse yabancı biri katılabilir: sahibi kişiyi çıkarabilir, QR'ı yenileyebilir;
  etkinlik bitince her şey gider. QR ekranında ekran görüntüsü engeli var.
- Sunucudaki silmeyle telefonun silmesi arasında en çok yarım dakika fark olabilir.

## Ek (2026-10-15, QA bulguları Y1, Y2)

- Silinen her çember, dışarıdaki izi (Redis, olay akışları, iş kuyruğu) temizlenene kadar
  `app.event_cleanups`ta kaydı tutulur (çemberin silindiği işlemde yazılır). Temizlik yarıda kalırsa
  (Redis kesintisi, işçinin yeniden başlaması) bir sonraki süpürme onu tamamlar; temizlik tekrar
  çalıştırılabilir. Sahibin "şimdi bitir"i de bu yüzden temizlik beklemeden başarılı döner.
- Kalıcı hatayla biten bildirimlerin ölü kuyruktaki kopyaları (`push.send.dead`) da silinir.
- DoD testi iki durumu da kapsıyor: bildirim kalıcı olarak başarısız olmuş etkinlik, ve temizliği
  bir kez hata veren etkinlik.

## Ek (2026-10-15, Faz 9 dilim 1, QA O2, O3, O5)

- Etkinliğin sahibi, kim üretmiş olursa olsun etkinliğin bütün QR kodlarını tek düğmeyle iptal
  eder ("Bütün QR kodlarını iptal et"; `POST /v1/circles/:id/invites/revoke`, migration 0012 sahibe davetleri
  görme ve iptal etme izni verir). Sahip olmayan için çember yokmuş gibi 404 döner.
- "Yeni kod" eski kodu iptal edemezse yeni kod üretmez, "Eski kod iptal edilemedi; hâlâ çalışıyor" uyarısı
  gösterir.
- Etkinlik bitince ya da kişi ayrılınca telefondaki buluşma kayıtları (hatırlatıcı, yol izi,
  gecikme bilgisi, seçimler) silinir ve kurulmuş hatırlatma bildirimi iptal edilir; çıkışta
  bütün buluşma hatırlatmaları iptal edilir.
