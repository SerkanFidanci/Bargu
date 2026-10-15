# 0020. Çember yöneticileri ve planlama yetkisi

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

- Proje sahibi telefon denemesinde istedi: çemberlerde WhatsApp grupları gibi temel roller olsun;
  yönetici olmayan üye oylama ve etkinlik başlatamasın, sunucu da bunu denetlesin.
- QA Faz 8 O4: etkinlik belgelerinin (buluşma, oylama, oy) kurallarını yalnızca telefonlar
  tutuyordu. Değiştirilmiş bir uygulama başkasının oylamasını değiştirebilir, var olmayan bir
  oylamaya oy yazabilirdi. Sunucu belgenin türünü bilmiyordu.
- QA Faz 8 O6: bir etkinliğin QR'ı 50 kişiye kadar çalışır. Aynı kişi aynı QR ile girip çıkarak her
  seferinde herkes için yeni bir anahtar dönemi (epoch) başlatabiliyordu.
- Veritabanında her çemberin zaten `owner` rolü vardı. Sahip; çemberin adını değiştirir, üye
  çıkarır, etkinliği erken bitirir, bütün QR'ları iptal eder. Sahip ayrılırsa en eski üye sahip
  olur.

Proje sahibinin kararları (PM üzerinden, 2026-10-15): dört soruda da öneri seçildi.

## Karar

- **Yönetici:** veritabanındaki `owner` rolü arayüzde "Yönetici" diye geçer. Bir çemberde birden
  çok yönetici olabilir. Yönetici bir üyeyi yönetici yapar ya da başka bir yöneticinin
  yöneticiliğini geri alır. İki kural var: kişi kendi yöneticiliğini bırakamaz ve çemberi kuranın
  (`circles.created_by`) yöneticiliği alınamaz. Arkadaşlıkta (iki kişilik çember) rol yoktur.
  Yönetici çıkarılamaz; önce yöneticiliği alınır. Son yönetici ayrılırsa en eski üye yönetici olur
  (değişmedi). Rol değişince anahtarlar değişmez (yeni epoch yok); üyeler `circle.changed` alır.
  - API: `POST /v1/circles/:id/members/:userId/role`, gövde `{ role: "owner" | "member" }`.
    Kurucudan almaya çalışınca `CREATOR_ADMIN` döner.
  - Veritabanı da aynı kuralı tutar (üyelik geçiş tetikleyicisi, `app.may_lose_admin`).
- **Etkinlikte yalnızca yönetici:**
  - buluşmayı (saat ve yer) belirler ya da değiştirir;
  - oylama başlatır, kapatır ve siler;
  - QR üretir ve isimle davet eder;
  - bütün QR'ları iptal eder ve etkinliği erken bitirir.

  Üye oy verir, "geç kalacağım" der ve yer ekler (buluşma yeri bu yerlerden seçilir). Bir etkinlikte
  yöneticiliği alınan kişinin o etkinlik için ürettiği QR'lar aynı anda iptal edilir. Aile ve
  arkadaş çemberinde herkes davet etmeye devam eder. "Herkes / yalnızca yöneticiler" ayar anahtarı
  yok, kurallar sabit.

- **Sunucunun belge yetkisi (O4):** sunucu her belgenin türünü (`plan`, `poll`, `vote`) ve bir oyun
  hangi oylamaya ait olduğunu bilir. İçerik (saat, yer, seçenekler, seçimler) yine şifreli kalır.
  Kurallar satır güvenliğinde ve serviste:
  - buluşma yalnızca etkinliğin kendi kimliğinde durur;
  - oy, oy verenin o oylama için kimliğinde (`voteId`) ve yalnızca o etkinliğin bir oylamasında
    durur;
  - buluşmayı ve oylamaları yalnızca yöneticiler ekler, değiştirir ve siler; oyu yalnızca sahibi
    değiştirir;
  - oylama silinince oyları da gider;
  - bir üye bir etkinlikte en çok 20 oylama başlatır; etkinlik başına 300 belge sınırı aynı kaldı.

  İstek biçimi `{ envelope, version, kind, pollId }` oldu. `shared` bayrağını sunucu artık türden
  çıkarıyor.

- **Yeniden şifreleme:** yeni epoch'ta buluşmayı ve oylamaları yalnızca bir yöneticinin telefonu
  yeni anahtarla yeniden kaydeder. Oyları sahibi kaydeder.
- **QR ile gir-çık döngüsü (O6):**
  - Bir kişi aynı QR ile yalnızca bir kez katılır (`app.invite_uses`). Ayrılıp dönmek için yeni kod
    gerekir ve uygulama "Bu kodla bir kez katıldın" der.
  - Bir çembere saatte en çok 100 kişi katılır; her katılım yeni bir epoch başlatır. 50 kişilik
    dolu bir etkinlik bu sınıra iki kez sığar.
  - Ayrılma ve çıkarma hiçbir zaman sınırlanmaz.
- **Haritada buluşma noktası:** buluşma yeri belli olan her etkinlik için mercan renkli bir bayrak
  gösterilir: etkinliğin adı ve buluşma saati yazar. Dokununca etkinlik ekranı açılır. O yerin
  sıradan etiketi gösterilmez, yerin dairesi kalır. Hiçbir şey sunucuya sorulmaz; telefon elindeki
  belgelerden çıkarır.

## Sonuçlar

- **Yeni meta veri:** sunucu artık hangi belgenin buluşma, oylama ya da oy olduğunu ve oyun hangi
  oylamaya ait olduğunu görür. Yani kimin hangi oylamada oy verdiğini bilir, neye oy verdiğini
  bilmez. Kimin yönetici olduğunu da bilir; yetki için bunu bilmek zorunda. THREAT_MODEL'in kabul
  edilen sızıntılar tablosuna yazıldı.
- **Yeni katılanın beklemesi:** yeni katılan kişi buluşmayı ve oylamaları ancak bir yöneticinin
  telefonu yeni anahtarla yeniden kaydedince görür. QR'ı yönetici gösterdiği için pratikte hemen
  olur. Yönetici çevrimdışıysa uygulaması açılınca olur.
- **Eski sürümler:** eski uygulama sürümleri buluşma ve oy kaydedemez, çünkü istek biçimi değişti.
  Okumada sorun yok. Çemberin sunucu cevabına bilerek yeni alan eklenmedi, eski sürümler çember
  listesini okumaya devam etsin. Bu yüzden telefon kurucuyu bilmez: kurucunun yöneticiliğini almak
  istenince sunucu reddeder, uygulama "Çemberi kuranın yöneticiliği alınamaz" der.
- **Silinen oylar:** migration sırasında önceden verilmiş oylar silindi, çünkü hangi oylamaya ait
  oldukları bilinmiyordu. Etkinlikler en çok bir hafta sürer, kişiler yeniden oy verir.
- **Migration'lar:**
  - 0013: kişi başına tek giriş;
  - 0014: belge türleri ve belge yetkisi;
  - 0015: yöneticiler ve etkinlik davetleri;
  - 0016: kabul tekrarlanabilir; aynı kodla yeniden gelen istek aynı çemberi döndürür (QA B2, ADR 0009
    eki).
