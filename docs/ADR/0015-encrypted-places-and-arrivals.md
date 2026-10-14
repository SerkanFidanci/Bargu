# 0015. Şifreli yerler, varış ve ayrılışı telefonun kendisi algılar

- Durum: Kabul edildi
- Tarih: 2026-10-14

## Bağlam

Faz 7 çembere ait yerler (ev, okul, iş) ve "Ali eve vardı" bildirimleri ister. Plan, yerlerin
şifreli saklanmasını ve giriş/çıkışın işletim sisteminin geofence özelliğiyle algılanmasını
öneriyor. İki sorun var:

- Bir yer, konumun ta kendisidir (ev adresi). Sunucu adını ve yerini görmemeli; çembere sonradan
  katılan üye de açabilmeli; ayrılan üye yeni hâlini görmemeli.
- İşletim sistemi geofence'i Android'de ve iOS'ta **"her zaman" konum izni** ister. Faz 5'te
  bilerek yalnızca "kullanırken" izniyle ve görünür bildirimli konum servisiyle çalıştık (ADR 0011).
  Ayrıca geofence, kişi çembere paylaşımı kapatmış ya da hayalet moddayken de tetiklenir.

## Karar

- **Yer = şifreli mesaj**: yeni içerik türü `place` (ad ≤ 40, simge, merkez, yarıçap 50–1000 m,
  `ts`). Kaydeden üyenin o epoch'taki gönderen anahtarıyla şifrelenir ve imzalanır; sunucu
  `app.places` tablosunda (zorunlu RLS: yalnızca aktif üyeler) zarfı ve bir sürüm numarası tutar.
  Yer adı, konumu, yarıçapı sunucuda yoktur.
- **Kaydetme karşılaştır-ve-yaz**: telefon okuduğu sürümle kaydeder; arada biri değiştirdiyse
  reddedilir ve telefon son hâli gösterir. Çember başına en çok 30 yer. Her değişiklik diğer
  üyelere yalnızca çember kimliğiyle `places.changed` olayı olarak gider.
- **Yalnızca güncel epoch**: sunucu eski epoch'la mühürlenmiş yeri kabul etmez (yeni üye açamaz).
  Epoch ilerleyince (üye girişi/çıkışı, günlük rekey) yeri açabilen bir üyenin telefonu, telefona
  özgü kısa bir beklemeden sonra yeri kendi yeni anahtarıyla yeniden mühürler; aynı anda yapan
  olursa sürüm kuralı birini kabul eder.
- **Geri dönüş yok**: yerin `ts`'i yalnızca büyür; telefon elindekinden eski bir sürümü ve sildiği
  bir yeri sunucu tekrar gösterse de almaz. Bu yüzden saklanan yerler tekrar penceresine bakılmadan
  açılır (`decryptStoredMessage`, yalnızca `place`).
- **Algılama konum motorunda**: işletim sistemi geofence'i yerine, motorun zaten aldığı her konumla
  karşılaştırılır. Varış: konum dairenin içinde. Ayrılış: doğruluk dairesinin yakın kenarı bile
  "yarıçap + pay"ın (en az 30 m, yarıçapın %20'si) dışında (kenarda gidip gelen biri "vardı,
  ayrıldı, vardı" demez). Yarıçaptan belirsiz konum hiçbir şey söylemez. Bir yer için ilk konum
  yalnızca kaydedilir (zaten orada olmak "vardı" değildir).
- **Yalnızca tam konum paylaşılan çembere**: "Okula vardı" mahalle/şehir hassasiyetinden daha
  çok şey söyler; bu yüzden varış/ayrılış yalnızca o çembere tam konum paylaşılırken gider.
  Paylaşım kapanınca, hayalet modda ya da kaba hassasiyette telefon o çemberin yerlerinde nerede
  olduğunu unutur; yeniden açınca bayat bir "ayrıldı" gönderilmez.
- **Varış/ayrılış mesajı**: `place_enter` / `place_exit` (yalnızca yer kimliği), konum gibi şifreli;
  sunucu saklamaz, çevrimiçi üyelere anında iletir (cihaz ve çember başına 10 dakikada 20). Çevrimdışı
  üyelere telefonun her cihaz için mühürlediği bildirim gider (ADR 0016).
- **Arayüz**: çember ekranında "Yerler"; ekleme/düzenleme ekranında harita ve ortada daire.
  Haritayı kaydırmak yeri taşır, dairenin kenarındaki tutamak 100 / 250 / 500 m'ye titreşimle
  oturur (UI thread'de). Ana haritada yerler soluk daire ve simgeyle çizilir.

## Sonuçlar

- "Her zaman" konum izni yine istenmiyor. Bedeli: konum servisi çalışmıyorsa (paylaşım kapalı)
  varış da yok; bu zaten istenen davranış.
- Sunucu bir çemberde kaç yer olduğunu ve ne zaman değiştiğini görür; varış/ayrılışın zamanını
  görür ama hangi yer, hangisi olduğunu göremez (THREAT_MODEL).
- Kötü niyetli sunucu bir yeri silip gösterilmemesini sağlayabilir ya da çember yeni üyesine eski
  bir sürümü verebilir (o üyenin karşılaştıracak eski kaydı yoktur); var olan üyeleri geri
  götüremez.
- Yeniden mühürleme, epoch değişiminde çevrimiçi bir üyeye bağlıdır: herkes uzun süre kapalıysa
  yeni üye yerleri biri açana kadar göremez.
