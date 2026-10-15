# 0018. Etkinlik planlama: buluşma, oylama, varış tahmini, geç kalma

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

Faz 8 sırasında istendi: etkinlikte buluşma saati ve yeri için oylama; buluşmaya az kala herkesin
ne zaman orada olacağını görmek; "yetişmek için 15 dk içinde çıkmalısın" hatırlatıcısı; "geç
kalacak" bildirimi. Kullanıcının isteği: varış ve gecikmeyi **sistem kendisi bilsin**, kişi isterse
kendisi de söyleyebilsin. Konum hiçbir zaman düz metin olarak sunucuya ya da başka bir servise
gitmez (CLAUDE.md).

## Karar

- **Belgeler (uçtan uca şifreli):** etkinliğin buluşması (`plan`: saat ve etkinliğin yerlerinden
  biri), oylamalar (`poll`: saat ya da yer, 2–4 seçenek, başlatan ve sonuç) ve oylar (`vote`: kişinin
  uygun bulduğu seçenekler). Her biri, yerler gibi (ADR 0015), son kaydeden üyenin gönderen
  anahtarıyla şifrelenip imzalanmış bir belge olarak sunucuda durur. Belgeler mesajlardan daha büyük
  sabit boyutlu bir zarfa sığar (1024 bayt dolgu; dört uzun yer adlı oylama 512'ye sığmıyor). Boyut
  iki türü ayırır: bir mesaj belge, bir belge mesaj yerine geçemez; içerik türleri de ayrıdır.
- **Sunucu:** yalnızca etkinlik çemberlerinde, yalnızca etkin üyeler için; imza (çağıranın cihazı),
  güncel epoch, sürüm üzerinden karşılaştırmalı kayıt, etkinlik başına en çok 300 belge. Buluşma ve
  oylamalar **ortak** (her üye değiştirir), oy yalnızca **sahibinin**; silme sahibine ve etkinliğin
  sahibine açık. Üye ayrılınca ya da çıkarılınca oyları silinir; etkinlik bitince her şey (ADR 0017).
  Her değişiklik diğer üyelere `docs.changed` olayı olarak gider; telefonlar yalnızca olayla
  güncellenir.
- **Oy kimliği:** `voteId = UUIDv8(SHA-256("bargu/v1/vote-id\0" ‖ pollId ‖ userId))`. Kişinin her
  oylamada tek oyu olur; yeni telefonu eski oyunun yerine yazar. Telefonlar bir oyun, imzalayan
  kişinin kimliğiyle dosyalandığını denetler: kimse başkası adına oy veremez.
- **Varış tahmini (telefonda, harita servisi yok):** Google gibi bir yol tarifi servisine sormak
  kişinin tam konumunu ve gideceği yeri o servise göndermek demek; bu yüzden yapılmadı. Tahmini
  telefon kendisi yapar:
  - yola çıkmadan önce: kuş uçuşu mesafe × 1,35 dolanma payı, nasıl gelindiğine göre ortalama hız
    (yürüyerek ~4,5, bisikletle ~14, araçla ~23 km/s; kişi seçebilir, seçmezse telefon
    hareketinden ve mesafeden karar verir);
  - yoldayken: kişinin son 10 dakikada yere **gerçekte ne hızla yaklaştığı** (trafik, otobüs,
    dolambaçlı yol kendiliğinden yansır), en az 3 dakikalık eğilim varsa; tipik tahminin 0,5–3 katı
    ile sınırlı. Yürüme hızındaki eğilime yalnızca yere 3 km'den yakınken güvenilir (uzaktaysa kişi
    büyük ihtimalle durağa ya da araca yürüyordur).
- **"Kim ne zaman orada?":** buluşmadan 90 dakika önce ile 30 dakika sonrası arasında, tam konum
  paylaşan her telefon tahminini konum mesajının içinde (`loc.eta`, şifreli) gönderir. Mahalle ya
  da şehir hassasiyetinde tahmin de atılır (konumdan fazlasını söylemesin). Pano: orada olanlar,
  geliyor olanlar (saatiyle, geç kalıyorsa kaç dakika), bilinmeyenler.
- **"Geç kalacak" (otomatik):** tahmin buluşma saatini 10 dakikadan fazla aşar ve bu en az 3 dakika
  sürerse telefon etkinliğe `late` mesajı (çevrimiçi üyelere) ve mühürlü bildirim (diğerlerine,
  ADR 0016) gönderir: "Ali yaklaşık 15 dk gecikecek". Gecikme 10 dakika daha büyürse yeniden. Yalnızca
  etkinliğe tam konum paylaşılırken. Kişi "Geç kalacağım" deyip 10/20/30/45 dakika seçerek kendisi de
  bildirebilir; panoda kendi sözü, telefonunun tahmininden geçse o görünür.
- **Çıkış hatırlatıcısı:** yola çıkılması gereken zamandan (buluşma − 5 dk pay − yol süresi) 15
  dakika önce telefonun kendi kurduğu yerel bildirim. Sunucu ya da bildirim servisi bilmez. Kişi yola
  çıkınca (yere belirgin biçimde yaklaşınca) geri alınır; kişi kapatabilir. Saat geçmişse ve hâlâ
  vakit varsa hemen "X dk içinde çıkmalısın" der.
- **Yeni bildirim kanalı (Android):** "Buluşmalar".

## Sonuçlar

- Sunucu etkinliğin kaç belgesi olduğunu, her birini kimin oluşturduğunu, ortak mı kişisel mi
  olduğunu ve ne zaman değiştiğini görür; saati, yeri, seçenekleri ve oyları göremez. Oy veren
  sayısı belge sayısından kabaca anlaşılır.
- Tahmin kaba olabilir (trafik verisi yok); yoldayken gerçek ilerleme bunu büyük ölçüde düzeltir.
  Ani trafik sıkışmasında araç yavaş ilerlerse ve yer 3 km'den uzaksa tipik tahmin kullanılır
  (yanlış alarm yerine sessiz kalmak tercih edildi); kişi elle bildirebilir.
- Android'de zamanlanmış yerel bildirim birkaç dakika kayabilir (tam zamanlı alarm izni istenmiyor).
- Konumu hiç paylaşmayan telefon kendi konumunu almadığı için hatırlatıcı ve otomatik gecikme
  çalışmaz; elle bildirim çalışır.

## Ek (2026-10-15, Faz 9 dilim 2)

Kimin neyi değiştirebileceği ADR 0020 ile değişti. Buluşmayı ve oylamaları artık yalnızca
etkinliğin yöneticileri belirler, değiştirir ve siler; üyeler oy verir. Sunucu belgenin türünü
(buluşma, oylama, oy) ve oyun hangi oylamaya ait olduğunu bilir ve kuralları kendisi denetler.
Yukarıdaki "Buluşma ve oylamalar ortak (her üye değiştirir)" cümlesi bu yüzden geçerli değil.

## Ek (2026-10-16, Faz 9 dilim 6b)

- **Gecikme bildirimi yeniden denemesi (QA Faz 8 D10):** Otomatik "geç kalacağım" gönderilemezse
  telefon onu her yeni konumda değil, 1 dakika sonra, sonra 2, 4… en çok 10 dakika arayla yeniden
  dener (sunucu sınırı 10 dakikada 20). Gönderilince sayaç sıfırlanır; elle bildirme bundan
  etkilenmez.
- **Bitişte bayrak (QA dilim 2 N4, bilgi):** Buluşma bayrağı etkinlik bitince haritanın yeniden
  çizilmesiyle kalkar. Biten etkinlik canlı bir olayla telefonlara ulaşır (ADR 0017 dilim 6a ekinde,
  QA D2) ve ekranın saati yarım dakikada bir ilerler; bayrak en geç bu kadar gecikir.
