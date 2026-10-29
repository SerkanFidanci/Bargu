# 0040. Etkinlik yoklaması: "Herkes yerinde mi?"

- Durum: Kabul edildi (PM, 2026-10-30), PM şartlarıyla; önerildi (kodlama oturumu, 2026-10-30)
- Tarih: 2026-10-30
- İlgili: BARGU_PLAN Faz 9C paket C (N4), [ADR 0037](0037-nearby-invite.md) (Ö8, küçük şifreli
  öğe), [ADR 0035](0035-messages-and-moments.md) (öğeler, bildirim), [ADR 0017](0017-event-circles.md)
  (etkinlik çemberi), [ADR 0020](0020-circle-admins-and-planning-authority.md) (yöneticiler, etkinlik belgeleri),
  [ADR 0023](0023-age-15-plus.md) (15–17)

## Bağlam

Okul gezisi, kamp, konser: sorumlu kişi "herkes burada mı?" diye sormak ister. Bugün bunu haritaya
bakarak yapıyor; konumunu kaba paylaşan ya da paylaşmayan biri için harita cevap vermez. N4,
tek dokunuşla yoklama: sahip sorar, üyeler tek dokunuşla "Buradayım" der, 10 dakikada kapanır.

Yoklama konum sormaz. "Buradayım" kişinin kendi beyanıdır; içinde konum yoktur.

## Karar

### 1. Kim, nerede

- **Yalnız etkinlik çemberinde** (`kind = 'event'`).
- **Yalnız çemberin sahibi** başlatır. "Sahip", rolü `owner` olan **bütün yöneticilerdir** (ADR 0020:
  bir etkinlikte birden çok yönetici olabilir; PM kararı, 2026-10-30). Aynı anda yine tek yoklama olur.
  Bu belgede "sahip" bu rolü anlatır.
- Bir çemberde **aynı anda tek yoklama** olur. Yoklama **10 dakikada** kapanır; sahip daha önce
  "Bitir" diyebilir.
- Aynı çemberde saatte en çok 6 yoklama (sahibin üyeleri bildirime boğmaması için).

### 2. Şifreli küçük öğeler

Ö8 gibi: yoklama da cevaplar da çemberin sohbet anahtarıyla şifreli küçük öğelerdir (`encryptChat`,
ADR 0035 §2). Yeni primitive yok.

| Öğe        | İçi (şifreli)          | Not                                 |
| ---------- | ---------------------- | ----------------------------------- |
| `rollcall` | `id`, `closesAt`, `ts` | Metin yok; ekranda sabit soru yazar |
| `here`     | `rollcallId`, `ts`     | **Konum yok**                       |

Ö8'den farkı: sunucu türü **görür**. Kuralları (yalnız sahip, tek yoklama, 10 dakika, kimin cevap
verebileceği) sunucu denetlemeli; bunun için yoklamanın ve cevapların var olduğunu bilmek zorunda.
Bu yüzden öğeler sohbetin genel ucundan değil, kendi uçlarından gider. PM şartı da bunu kabul eder:
sunucu kimin hangi yoklamaya ne zaman cevap verdiğini görür (bkz. Sonuçlar).

### 3. Sunucu

Tablolar (RLS ile; yalnız çemberin etkin üyeleri okur):

- `app.rollcalls(id, circle_id, started_by, started_at, closes_at, closed_at, eligible uuid[], envelope)`;
- `app.rollcall_answers(rollcall_id, user_id, answered_at, envelope)`, (yoklama, kişi) başına tek satır.

Uç noktalar (hepsi zod doğrulamalı, cihaz imzalı istek, yetki kontrollü ve "başka kullanıcı
erişemez" testli):

| Uç nokta                                     | Kim             | Ne yapar                                                                                           |
| -------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `POST /v1/circles/:id/rollcalls`             | Sahip           | Etkinlik çemberi mi, açık yoklama yok mu, saatlik sınır; `closesAt` = şimdi + 10 dk (sunucu yazar) |
| `POST /v1/circles/:id/rollcalls/:rid/answer` | Katılabilen üye | Yoklama açık mı, kişi katılabilenler arasında mı; ikinci cevap ilkinin yerine geçmez, "tamam" der  |
| `POST /v1/circles/:id/rollcalls/:rid/close`  | Sahip           | Erken bitirir                                                                                      |
| `GET /v1/circles/:id/rollcalls/current`      | Çember üyesi    | Açık ya da son yoklama, cevaplar (zarflar) ve katılabilenlerin sayısı                              |

- **Canlı olaylar:** `rollcall.started`, `rollcall.answered` (kim), `rollcall.closed`. Telefon
  önbelleği olaydan güncellenir; yenileme düğmesi ya da yoklama (polling) yok.
- **Kapanış:** pg-boss işi `rollcall.close`, `startAfter = closesAt`, yükü yalnız yoklamanın
  kimliği. İş `closed_at`'ı yazar ve `rollcall.closed` yayınlar. Kapanmış yoklamaya cevap reddedilir.
- **Silme:** yoklama ve cevapları **24 saat sonra**, etkinlik bitince (ADR 0017) ya da hesap silinince
  (cevaplar) silinir; hangisi önce gelirse.

### 4. Kimler katılır

Yoklama başlarken sunucu **katılabilenleri** bir kez hesaplar ve satıra yazar (`eligible`). Sonradan
katılan üye bu yoklamaya girmez. Katılamayanlar:

- sahibin kendisi;
- uygulaması bu türü bilmeyenler (istemci seviyesi);
- "Etkinlik yoklamaları" ayarını kapatanlar (bkz. 6);
- **15–17 yaştakiler, çember 8 üyeden büyükse** (PM şartı).

Sahibin ekranı yalnız şunu söyler: "Yoklamada olmayan: 2 kişi." **Neden söylenmez.** Dürüst olmak
gerekirse sahip, cevap verenlerle verebilecekleri üye listesiyle karşılaştırıp **kimin** yoklamada
olmadığını adlardan çıkarabilir; **nedenini** göremez: o kişi eski uygulamalı, ayarı kapatmış ya da
15–17 olabilir (ADR 0023'teki "bulunabilirlik" ayarıyla aynı yol: herkesin açıp kapatabildiği bir
ayar, 15–17 için kilitli). Bu, THREAT_MODEL'e de böyle yazılır (PM şartı).

### 5. Ekran

- **Sahip:** etkinlik ekranında "Herkes yerinde mi?" düğmesi. Açık yoklamada sayaç ve liste:
  "12/15 burada · 9 dk kaldı". Altında "Cevap vermeyenler: Ali, Can, Ece" ve "Yoklamada olmayan: 2
  kişi". Kapanınca "Yoklama bitti: 14/15".
- **Üye:** bildirim ve etkinlik ekranında büyük **"Buradayım"** düğmesi. Bildirimdeki düğmeyle
  uygulamayı açmadan cevap verilebilir (Ö8'in hızlı cevabı gibi).
- **Kim görür:** cevaplar çemberin sohbet anahtarıyla şifreli olduğu için çemberdeki herkes kimin
  "Buradayım" dediğini görür. Grup için yararlı ("kim eksik?"). (PM sorusu 1.)
- "Buradayım" konum değildir. Sahibin haritasında kişinin pini her zamanki paylaşım kurallarıyla
  görünür; yoklama bunu değiştirmez.
- Sade modda sayaç animasyonsuz; ekran okuyucu etiketleri; tr ve en metinler.

### 6. Ayar: "Etkinlik yoklamaları"

- Ayarlar → Bildirimler altında, herkes için açık başlar. Kapatan kişi yoklamalara katılmaz ve
  bildirim almaz.
- 15–17 için 8 üyeden büyük çemberlerde kilitli kapalıdır (ayar ekranında genel bir metin: "Büyük
  etkinliklerde kapalı"). Küçük çemberlerde genç açıp kapatabilir.
- Ayar sunucuda tutulur (yoklamada katılabilenleri hesaplamak için); başka kullanıcıya gösterilmez.

### 7. Bildirim

- Sahibin cihazıyla imzalı, alıcı cihaza mühürlü üye bildirimi (ADR 0016): tür `rollcall`, çember
  ve yoklama kimliği. **Metin yok**; telefon "Etkinlik adı: Herkes yerinde mi?" yazar.
- Sosyal sınıfta: çember sessize alındıysa susar. Güvendeyim gibi susturulamaz değildir; bir
  organizatörün aracıdır.
- Kapanınca, cevap vermemiş üyenin bildirimi kaldırılır.

### 8. 15–17

- 15–17 yaştakiler yalnız **en çok 8 üyeli** etkinlik çemberlerinde katılır (PM şartı); büyük
  çemberde yoklamayı görmez, bildirim almaz, sayılmaz (bkz. 4: neden söylenmez).
- 15–17 bir etkinlik çemberinin sahibi olabiliyorsa (bugünkü kurallar) yoklama başlatabilir; aynı
  8 üye sınırı yalnız gençlerin katılımı içindir. (PM sorusu 2.)
- Ebeveyn araçlarında değişiklik yok.

## Sonuçlar

**Sunucunun gördükleri:** bir çemberde yoklama olduğu, kimin başlattığı, başlama ve kapanış
zamanı, kimlerin katılabildiği, **kimin hangi yoklamaya ne zaman cevap verdiği**, kimin "Etkinlik
yoklamaları" ayarını kapattığı. "Buradayım" konum taşımaz; sunucu konumla ilgili yeni bir şey
öğrenmez.

**Belgeler (PM kararı):** THREAT_MODEL ve N2'yi kodlama oturumu, **kodla aynı commit'te** günceller
(N2 testi THREAT_MODEL'i okur). Gizlilik politikası ve Play belgelerini PM, paketin APK'sı çıkmadan
önce günceller. Değişecek satırlar:

- THREAT_MODEL, "Kabul edilen sızıntılar": yeni satır **"Etkinlik yoklamaları"**: yukarıdaki liste;
  azaltma: konum yok, içerik şifreli, 24 saatte ya da etkinlik bitince silinir. "Etkinlik belgeleri"
  satırının yanına konur. Satır dürüstçe şunu da yazar: sahip adlardan kimin yoklamada olmadığını
  çıkarabilir, nedenini göremez (eski uygulama, ayar kapalı ya da 15–17).
- THREAT_MODEL, "Saldırganlar ve önlemler": "Etkinliği bozan üye" satırına: yoklamayı yalnız sahip
  başlatır, tek yoklama, saatte 6, 10 dakika.
- N2 "Sunucu ne biliyor?" ekranı: yeni satır "olay zamanları" ya da çember grubuna bağlanır (eşleme
  testi THREAT_MODEL'i okur).
- Gizlilik politikası: etkinlik bölümüne yoklama; saklama 24 saat; ayar.
- Play veri güvenliği formu: yeni veri türü yok ("uygulama etkinliği" kapsamında, PM kontrol eder).

**Testler (kod aşamasında):** yalnız etkinlik çemberi ve yalnız sahip; ikinci açık yoklama reddedilir;
saatte 6; 10 dakikada kapanır ve sonra cevap reddedilir; katılamayan cevap veremez; sonradan katılan
girmez; 15–17 büyük çemberde katılamaz ve sahibe nedeni gitmez; "başka kullanıcı erişemez" (başka
çemberin yoklaması okunamaz, cevaplanamaz); `here` öğesinde konum alanı yok (şema katı); 24 saat
silme; hesap silme.

**Riskler:** sahip "kim cevap vermedi" listesini görür; bu, etkinliğin amacı. Ayarı kapatan kişi
listede adıyla değil sayıyla görünür.

## PM soruları (karara bağlandı, PM 2026-10-30: hepsinde öneri geçerli; "sahip" bütün yöneticiler)

1. Cevapları **çemberdeki herkes** mi görsün (öneri: evet, "kim eksik?" gruba da yarar), yoksa yalnız
   sahip mi (o zaman cevaplar sahibe kişisel öğe olarak gider)?
2. 15–17 bir **sahip** olarak yoklama başlatabilsin mi (öneri: evet; 8 üye sınırı yalnız katılım
   için)?
3. "Etkinlik yoklamaları" ayarı **herkes için** olsun mu (öneri: evet; hem kişinin seçimi hem de
   15–17'nin neden katılmadığını gizler)?
4. "Sahip" **bütün yöneticiler** mi (öneri; ADR 0020'de etkinlikte birden çok yönetici olabilir), yoksa
   yalnız çemberi kuran kişi mi?
