# 0019. Çember geçmişi: uçtan uca şifreli, kapalı başlar, 14 gün

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

Proje sahibi Life360'taki gibi geçmiş istedi: kişinin son günlerde nereden nereye, nasıl gittiğini
görmek. Kurallar BARGU_PLAN "Ek iş — Çember Geçmişi"nde (commit 62a33a7): kapalı başlar, kimin
gördüğü görünür, tek dokunuşla kapanır ve silinir, Bargu+ ile son 14 gün. Sunucu konum görmez
(CLAUDE.md); sunucu yalnızca son konumu tutar, ara konumlar hiçbir yerde birikmez.

Seçenekler:

- **İzleyenin telefonunda kayıt:** izleyen telefon aldığı konumları saklar. Uygulama kapalıyken
  konum gelmediği için geçmiş delik deşik olur. Elendi.
- **Paylaşanın telefonunda kayıt, şifreli parça olarak sunucuda:** seçildi.

## Karar

- **Kayıt (paylaşanın telefonu):** her konum, 25 m ya da 5 dakikada bir nokta olarak, geçmişi açık
  her çember için ayrı çeyrek saatlik parçaya yazılır (nokta: saniye, enlem/boylam ~1 m, doğruluk).
  Çeyrek saat bitince parça o çember için mühürlenip gönderilir; çevrimdışıyken kasada bekler.
- **Şifreleme:** parça, çeyreğin başladığı epoch'un gönderen anahtarından türetilen **geçmiş
  anahtarıyla** (`HMAC-SHA256(senderKey, "bargu/v1/hist-key" ‖ circleId ‖ epoch ‖ senderDeviceId)`)
  ve kendi etiketleriyle (`bargu/v1/hist`, `bargu/v1/hist-sig`) şifrelenip imzalanır. Üç boydan
  birine dolgulanır (512 / 2048 / 8192 bayt: durağan, yürüyüş, araç); boyut, sunucunun zaten
  gördüğü gönderim sıklığından fazlasını söylemez.
- **Anahtar saklama:** üyeler gönderen anahtarını protokolün kabul ettiği iki epoch'tan sonra
  silmeye devam eder (canlı konum ileri gizli kalır). Yalnızca türetilmiş geçmiş anahtarı, epoch
  bittikten sonra 15 gün daha tutulur; o anahtar canlı konumu açamaz.
- **Kim görür:** parçayı yalnızca o epoch'ta çemberde olanlar açabilir. Sonradan katılan öncesini
  açamaz (anahtarı yok); sunucu da üyeye yalnızca katıldığı andan sonraki parçaları verir (satır
  güvenliği). Çıkarılan üye yeni parçaları açamaz (yeni epoch). Ayrılan üyenin kendi parçaları
  silinir.
- **Kapalı başlar:** paylaşan kişi o çember için açıkça açmadıkça hiçbir iz yazılmaz ve gönderilmez;
  çembere katılmak onay sayılmaz. Yalnızca tam konum paylaşılırken yazılır (hayalet modda,
  paylaşım kapalıyken, mahalle/şehir hassasiyetinde yazılmaz). Hayalete geçince, paylaşım durunca ya
  da hassasiyet düşünce o ana kadar yazılmış ama henüz gönderilmemiş parça da atılır: hayalet = hiçbir
  şey gitmez (proje sahibinin kararı, QA G6).
- **Kimin gördüğünü görür:** "Geçmişini kimler görüyor" ekranı (profil sayfasından ve her çemberin
  ekranından) geçmişin açık olduğu çemberleri ve onu görebilen kişileri listeler. Çembere yeni biri
  girince telefon "Artık X de … geçmişini görebilir" der (uygulama açıkken satır, arka plandayken
  telefonun kendi bildirimi). Uygulama tamamen kapalıyken sunucunun "yeni biri katıldı"
  bildirimi, geçmişin açık olduğu çemberde "artık o da konum geçmişini görebilir" diye yazar (Faz 9,
  QA G2). 7 günlük paylaşım hatırlatması da Faz 9'da; geçmiş orada da yazacak.
- **Tek dokunuşla kapanır:** kapatınca yazma durur, bekleyen parçalar atılır, sunucudaki parçalar
  silinir; çevrimdışıysa silme bağlantı gelince tekrar denenir. Kapatma anında gönderilmekte olan
  bir parça varsa silme ondan sonra gider; kapatmadan sonra hiçbir parça gönderilmeye başlamaz (QA G1).
- **14 gün, Bargu+:** sunucu parçaları 14 gün tutar (işçi 10 dakikada bir siler). Plana göre son 14
  gün Bargu+ özelliği; ödeme Faz 9B'de geldiğinde ödeyeni olmayan çember zaten durur. Faz 9B'ye
  kadar herkes deneme sayılır: 14 gün herkese açık. Abonelik kontrolü Faz 9B'de bu kurala eklenir.
- **Görüntüleme:** kişi kartında ve kişi menüsünde "Geçmiş"; seçilen günün rotası haritada çizgi,
  duraklar nokta; altta duraklar (çemberin yerleriyle adlandırılır), yolculuklar (mesafe, yürüyüş /
  bisiklet / araç) ve bilinmeyen aralıklar. Hiçbir harita ya da adres servisine sorulmaz. Yeni parça
  gelince açık ekran WS ile yenilenir.

## Sonuçlar

- Sunucu, kimin hangi çeyrek saatlerde izi olduğunu ve parça boyutunu (üç boydan biri) görür;
  konumu göremez. Bu, partner takibine kapı aralayan bir özellik: kapalı başlaması, kimin gördüğü
  ekranı, yeni izleyici bildirimi ve tek dokunuşla kapatma bunun için.
- Telefon değişince (yeniden kurulum) eski telefonla yazılmış parçalar artık doğrulanamaz ve
  gösterilmez; kişinin kendi geçmişi yeni telefonda baştan başlar.
- Epoch, çeyrek saat bitmeden değişirse parça başladığı epoch'la mühürlenir; o anahtar telefonda
  artık yoksa (iki epoch'tan eski) parça atılır.

## Ek (2026-10-15, Faz 9 dilim 1)

- Çemberden ayrılınca, çıkarılınca ya da etkinlik bitince telefon o çember için tuttuğu paylaşım
  seçimlerini siler: aynı çembere yeniden katılan kişinin geçmişi yine kapalı başlar, katılmak onay
  sayılmaz (QA W4).
- Kapalı uygulamadaki yeni izleyici uyarısı yukarıda (QA G2); iOS bildirim uzantısı geçmişin açık
  olduğu çemberlerin kimliklerini paylaşılan alandan okur (çember kimlikleri orada zaten vardı).
- Parça listesi isteği kişi başına dakikada 30 ile ve tek istekte en çok 2 günlük aralıkla sınırlı
  (QA G3); bir günün görüntülenmesi tek istektir.

## Ek (2026-10-16, Faz 9 dilim 6b)

- **Hassasiyet ve geçmiş (QA Faz 8 G4):** Geçmiş yalnızca tam konumla yazılır. Bir çemberin
  hassasiyeti "mahalle" ya da "şehir"e çekilince o çemberin geçmiş anahtarı da kapanır ve kısa bir
  uyarı çıkar. Önceden anahtar açık görünüyor ama hiçbir şey yazılmıyordu.
- **Bütün geçmişi silmek (QA Faz 8 G5):** "Geçmişimi de sil" sunucudan kişinin bütün parçalarını her
  çemberde siler (`DELETE /v1/me/history`). Uygulamanın artık bilmediği parçalar (yeniden
  kurulumdan önce yazılmış) da gider. Her çemberin diğer üyelerine `history` olayı gider; telefonları
  ellerindekini atar. Uç nokta kişinin yalnızca kendi parçalarına dokunur.
- **Yüklenemeyen gün (QA Faz 8 G8):** Bir gün yüklenemezse ekran "geçmiş yok" değil "yüklenemedi"
  der ve bağlantı gelince kendiliğinden yeniden dener (yenile düğmesi yok).
- **Yeni izleyiciler:** Toplu katılımda tek bildirim ve hayalet modu (QA G9, 3a-B5) ADR 0021'in
  dilim 6b ekinde.
- **Silme ölçütü (QA Faz 8 G10, bilgi):** Süpürme, çeyreğin başlangıcına bakar: bir çeyreğin son
  noktası sunucuda 14 gün 15 dakikaya, süpürme aralığıyla en çok 14 gün 25 dakikaya kadar kalabilir.
  "İki hafta" bu yuvarlamayla okunmalı.

## Ek (2026-10-22): telefondaki kendi iz

- **Bulgu (kodlama oturumu, kod taraması):** Telefon kendi izini kasada tutar
  (`history:mine:<çeyrek saat>`); çemberdeki "Geçmişimi gör" ve dışa aktarma bunu okur. Bu iz rıza
  geri çekilince ve son çemberde geçmiş kapanınca silinmiyordu. Ekran ise "Rızan geri çekildi;
  geçmiş kapatıldı ve silindi" diyordu. 14 günlük budama da yalnız kayıt sürerken çalışıyordu;
  kayıt durunca eski iz çıkışa kadar telefonda kalıyordu (şifreli kasada, hiçbir yere gitmeden).
- **Düzeltme (`8c8e0c7`, seviye 5 APK'sı):**
  - Rıza geri çekilince ("Geçmişimi de sil") kendi iz tümüyle silinir.
  - Bir çemberde geçmiş kapanınca, o an kayıt yapan başka çember kalmadıysa kendi iz silinir.
  - Kayıt olmasa da 14 günden eski çeyrekler kasa açılınca ve her paylaşım değişikliğinde budanır.
  - Testler düzeltmesiz kırılır (mutasyonla denendi).
- **Sınır:** "Kayıt yapan çember", o an kayıt yapanlara bakar. Geçmişi açık ama o an hayalette olan
  bir çember sayılmaz; o yüzden başka bir çemberde geçmiş kapanınca iz yine silinir. Gizlilik
  yönünde bir yan etki.
- **Kendi konum geçmişi** (yalnız telefonda, 30 gün ya da 1 yıl) ayrı bir özelliktir ve ayrı bir
  depoda tutulur: [ADR 0030](0030-own-location-history.md). Bu ekin kuralları yalnız çember
  geçmişinin yerel aynası içindir.
