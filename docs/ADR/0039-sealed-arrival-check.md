# 0039. Eve vardım kontrolü ("mühürlü emanet") ve pil bitmeden son konum

- Durum: Kabul edildi (PM, 2026-10-30), PM şartlarıyla (aşağıda "PM şartı 1–4"); önerildi (kodlama
  oturumu, 2026-10-30)
- Tarih: 2026-10-30
- İlgili: BARGU_PLAN Faz 9C paket C (Ö5, N1), [sektör analizi](../arastirma/sektor-analizi-2026-10-29.md),
  [ADR 0029](0029-safe-check-in.md) (Güvendeyim), [ADR 0035](0035-messages-and-moments.md) (kişisel
  öğe, Engelle), [ADR 0036](0036-battery-background-location.md) (arka planda konum),
  [ADR 0028](0028-location-accuracy-and-glide.md) ("Neden eski?"), [ADR 0023](0023-age-15-plus.md)
  (15–17), [ADR 0016](0016-sealed-push-notifications.md) (mühürlü bildirim, sunucu haberi)

## Bağlam

"Eve vardım / varmadı" Life360, Snap ve Google'da son bir yılda çıktı. Apple'da da "Check In" var.
Artık beklenen bir özellik. Hepsinde sunucu kişinin nereye gittiğini ve nerede olduğunu görür.
Bargu'nun farkı: sunucu bunu da göremez.

Zor kısım şu: kişinin telefonu yolda kapanırsa (pil biter, telefon kırılır, alınır) uyarıyı telefon
gönderemez. Uyarıyı sunucu göndermeli, ama içeriğini görmeden. Önerilen yol "mühürlü emanet":
telefon uyarıyı baştan, yalnız seçilen kişilerin açabileceği şekilde şifreler ve sunucuya bir açılma
saatiyle bırakır. Kişi varırsa ya da "iyiyim" derse emanet silinir. Varmazsa ve cevap vermezse sunucu,
açamadığı emaneti saatinde iletir.

N1 aynı pakette: pil çok düşünce telefon son konumunu bir kez gönderir, çemberde "pili bitmek
üzereydi" yazar. Ö5 de bu son konumu kullanır.

PM şartları (2026-10-30) bu ADR'nin içine işlendi; her biri ilgili bölümde.

## Karar

### 1. Kişinin gördüğü akış

1. **+ menüsü → "Eve vardım kontrolü"** (ya da bir yerin kartından "Buraya varınca haber ver").
2. Kişi seçer:
   - **Nereye:** kayıtlı bir yer (ADR 0015) ya da haritada bir nokta. Varış noktası **telefonda
     kalır**; koordinatı hiçbir yere gitmez (şifreli metne de girmez, bkz. 3).
   - **En geç ne zaman** (T): saat seçici. Bugünden en çok 23 saat sonrası (bkz. 5).
   - **Kime:** 1–5 kişi. Yalnız kişiyle ortak bir çemberde olan, engelli olmayan kişiler listelenir
     (bkz. 8).
   - **Ek süre** (G): 5, 10 ya da 15 dk; varsayılan 10.
   - İsteğe bağlı kısa not (en çok 140 karakter): "Taksideyim, plaka 34 ABC 123".
   - **Tek seferlik** ya da **tekrarlı** (bkz. 2).
3. Özet ekranı ve onay: "23:30'a kadar Ev'e varmazsan ve cevap vermezsen Ayşe ve Can'a haber gider.
   Haber giderse son konumunu, pilini ve notunu görürler." Altında sabit metin: **"Bargu acil servis
   değildir. Acil durumda 112'yi ara."** ve iki kısayol: **112'yi ara** (`tel:112`) ve **KADES**
   (KADES uygulamasını açar; yüklü değilse mağaza sayfasını).
4. Kontrol açıkken Android'in kalıcı bildiriminde yazar: "Eve vardım kontrolü açık · 23:30 · Ayşe,
   Can". Gizli bir kontrol olmaz (bkz. 11, zorlama tehdidi).
5. **Varınca** telefon kontrolü kendisi kapatır (bkz. 6) ve kişiye "Vardın, Ayşe ve Can'a haber
   verildi" der. Kişi istediği an **"Vardım / İyiyim"** düğmesiyle de kapatabilir.
6. **T anında** varılmadıysa kişiye "iyi misin?" bildirimi gelir (bkz. 7); ek süre başlar.
7. **T + G** anında hâlâ kapanmadıysa sunucu emaneti iletir.

### 2. Tek seferlik ve tekrarlı (rakiplerden ders)

- **Tek seferlik:** bir kez çalışır. Kurulduktan en geç **24 saat** sonra kendiliğinden kapanır (açılma
  saati en çok 23 saat sonrası olabilir, iletim de bir saat içinde biter; bkz. 5).
- **Tekrarlı:** "hafta içi her gün 23:30'a kadar Ev". **Tekrar planı yalnız telefonda durur**;
  sunucu plan bilmez, yalnız o günün emanetini görür.
  - Telefon her tekrarın emanetini, açılma saatinden en çok 23 saat önce, **ilk fırsatta kendisi
    kurar**: uygulama açılınca, arka plandaki konum görevi uyanınca (ADR 0036) ya da günlük arka plan
    işiyle. Böylece emanet yoldan önce sunucudadır; telefon yolda kapansa da uyarı gider.
  - Kişi o günkünü "Bugün atla" ile kapatabilir.
  - Telefon gün boyu hiç çalışmadıysa o günün emaneti kurulamaz ve uyarı gitmez. Tekrarlı kontrolün
    ekranı bunu açıkça yazar: "Tekrarlı kontrol, telefonunun o gün en az bir kez açık olmasını
    ister." Uygulama sonra açılınca "Dünkü kontrol kurulamadı" der.

### 3. Emanetin içi (şifreli)

Uyarı **telefonda** yazılır ve **yalnız seçilen kişilere** şifrelenir. Her alıcının cihazı için ayrı
bir kutu yapılır. Yeni primitive yok: `packages/crypto`'daki **kişisel öğe** yolu (`sealDirect` /
`openDirect`, ADR 0035 §3) kullanılır. Bu yol zaten şunları yapar:

- her kutu için taze X25519 anahtarı;
- gönderen cihazın Ed25519 imzası (sunucu ya da başka biri uyarı uyduramaz);
- anahtar bağlılığı ve dolgu;
- yaş kuralı (eski kutu açılmaz; `checkin` için değeri aşağıda, PM şartı 1).

`packages/schemas`'a yalnız yeni bir öğe türü eklenir, `checkin`:

| Alan         | Ne                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------- |
| `id`         | Emanetin rastgele kimliği (sunucudaki kimlikle aynı)                                        |
| `due`        | T: kişinin seçtiği "en geç" saati                                                           |
| `grace`      | G, dakika                                                                                   |
| `place`      | Hedefin **adı** ve emojisi ("🏠 Ev"); haritada seçilen noktada "seçilen yer". Koordinat yok |
| `last`       | Son konum: `lat`, `lng`, `acc`, `ts` (konumun alındığı an); hiç yoksa yok                   |
| `bat`, `chg` | Pil yüzdesi ve şarjda mı                                                                    |
| `note`       | İsteğe bağlı not                                                                            |
| `seq`, `ts`  | Yenileme sayacı ve kutunun yapıldığı an                                                     |

- **Gidilen yer, konum ve not sunucuya gitmez.** Sunucu yalnız kutuyu taşır.
- Son konum **tam hassasiyette** gider: kişi alıcıları bu iş için kendisi seçti ve alıcılar onu ancak
  uyarı giderse görür. Kurulum ekranı bunu yazar (bkz. 1.3). (PM sorusu 1.)
- `due` ve `grace` imzalı metnin içindedir. Alıcının telefonu uyarının **erken** gelip gelmediğini
  bundan anlar (bkz. 10).
- **Açılma süresi (PM şartı 1, en önemlisi):** `checkin` kutusunun yaşı kutunun `ts`'inden değil,
  imzalı `due + grace`'ten sayılır. Alıcı uyarıyı **`due + grace + 24 sa`'e kadar** açabilir; kutunun
  `ts`'i `due`'dan en çok 23 sa önce olabilir. Daha eski kutu ve sınırı geçen uyarı açılmaz. Böylece
  kişi kontrolü 23 saat sonrasına kurup telefonu hemen kapansa, alıcı da ilk saatlerde çevrimdışı olsa,
  uyarı iletildikten sonra en az 24 saat açılabilir. Bu, `packages/crypto`'daki yaş kuralının bu türe
  özel değeridir; yeni primitive değil. Test: geç açılan uyarı açılır, sınırı geçen açılmaz.

### 4. Yol boyunca yenileme

- Telefon emaneti son konumla **aynı kimlikle** yeniler: kutuların hepsi yenileriyle değişir, eskisi
  sunucuda kalmaz.
- Sıklık: hareket hâlinde en çok 5 dakikada bir, dururken 15 dakikada bir. Pil çok düşünce bir kez
  hemen (N1, bkz. 9). Sunucu emanet başına **2 dakikada en çok 1** yenilemeyi kabul eder.
- **Yenileme açılma saatini uzatmaz.** Sunucu yenilemede açılma saatini değiştirmez; alıcı listesi de
  değişmez.
- **Uzatmayı yalnız kişi yapar** (bkz. 7): ayrı bir istekle, kendi cihazının imzasıyla, yeni `due` ile
  baştan mühürlenmiş kutularla.
- Kontrol açıkken konum servisi çalışır (kalıcı bildirimle). Kişi çemberlere karşı hayalet modda
  olsa da çalışır, çünkü bu konum çemberlere gitmez, yalnız emanete girer. Hayalet ekranı bunu yazar:
  "Eve vardım kontrolün açık; çemberlerin seni görmez, uyarı giderse Ayşe ve Can görür." (PM sorusu 2.)
- Konum izni yoksa kontrol yine kurulur ama son konum boş gider ve varış kendiliğinden anlaşılamaz.
  Ekran bunu söyler: "Konum izni kapalı: varınca 'Vardım'a dokun."

### 5. Sunucu

Tablolar (RLS ile; yalnız sahibi ve uyarı gittikten sonra kendi kutusu için alıcı erişir):

- `app.checkins(id, owner_id, open_at, created_at, updated_at, fired_at)`;
- `app.checkin_boxes(checkin_id, recipient_id, device_id, box)`.

Uç noktalar (hepsi zod doğrulamalı, cihaz imzalı istek, yetki kontrollü, her biri için "başka
kullanıcı erişemez" testi):

| Uç nokta                       | Kim   | Ne yapar                                                                                                         |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `POST /v1/checkins`            | Sahip | `{ id, openAt, boxes[] }`. `openAt` = T + G; şimdiden en az 5 dk, en çok 23 sa sonra. Alıcı kuralları (bkz. 8)   |
| `PUT /v1/checkins/:id/boxes`   | Sahip | Yenileme: aynı alıcıların kutularını değiştirir. `openAt` değişmez. 2 dk'da 1                                    |
| `POST /v1/checkins/:id/extend` | Sahip | Yeni `openAt` (eskisinden ileri, kuruluştan en çok 23 sa) ve baştan mühürlü kutular. Kontrol başına en çok 5 kez |
| `DELETE /v1/checkins/:id`      | Sahip | İptal. Satır ve kutular **hemen, kalıcı olarak** silinir (yumuşak silme yok). Tekrar silmek de "tamam" der       |
| `GET /v1/checkins`             | Sahip | Kendi açık kontrolleri (kimlik ve saat): yeniden kurulumdan sonra iptal edebilsin diye                           |
| `GET /v1/checkins/inbox`       | Alıcı | Yalnız **iletilmiş** ve kendisine ait kutular                                                                    |
| `POST /v1/checkins/:id/ack`    | Alıcı | "Gördüm": kendi kutusu hemen silinir                                                                             |

- **Sınırlar:** bir kişinin aynı anda en çok **3 etkin** emaneti olur; günde en çok 10 yeni emanet;
  emanet başına 1–5 alıcı.
- **Zamanlayıcı:** pg-boss kuyruğu `checkin.fire`. İş `startAfter = openAt` ile kurulur, yükü
  **yalnız emanetin kimliğidir** (kişi, alıcı, kutu yok). İş çalışınca satırı okur: satır yoksa
  (iptal) biter; `openAt` ileri alındıysa (uzatma) o saate yeniden kurulur.
- **İletim:** iş, alıcı kurallarını (bkz. 8) bir daha denetler, `fired_at`'ı yazar ve:
  - çevrimiçi alıcılara canlı olay `checkin.fired` (`{ checkinId }`);
  - her alıcının güncel cihazına **içeriksiz** bir sunucu haberi (ADR 0016 Ek, sunucunun haber
    anahtarıyla imzalı, cihaza mühürlü): `{ kind: 'checkin', checkinId, ownerId }`. İçinde konum, not,
    yer, saat yok. Telefon haberi alınca kutuyu `inbox`'tan çeker.
  - İş başarısız olursa yeniden denenir. Sunucu kapalı kaldıysa açılınca gecikmiş işleri hemen
    çalıştırır. Gecikse de alıcı uyarıyı `due + grace + 24 sa`'e kadar açabilir (bkz. 3, PM şartı 1).
- **Silme kuralları:**
  - iptal edilen emanet hemen silinir;
  - iletilen emanetin kutusu alıcı "gördüm" deyince ya da **en geç 24 saat sonra** silinir; son kutu
    gidince satır da gider;
  - hesap silinince kişinin emanetleri ve ona gelen kutular silinir (ADR 0022 silme işine eklenir);
  - alıcı artık uygun değilse (bkz. 8) iletimde onun kutusu iletilmeden silinir.
- **Bildirim sınıfı (PM şartı 4):** Güvendeyim gibi sessize almayla **susturulmaz**; ayrı bir Android
  kanalı ("Güvenlik uyarıları"), yüksek öncelik, sesli. **Yeni izin yok:** `USE_FULL_SCREEN_INTENT`
  ve "Rahatsız etme"yi aşma izni istenmez; Play ikisini de kısıtlıyor. Telefon "Rahatsız etme"
  modundaysa sistemin kuralı geçerlidir. Tam ekran görünüm bildirime dokununca açılır (bkz. 8).

### 6. Varış telefonda anlaşılır

- Telefon, hedefin yarıçapı içinde (kayıtlı yerde yerin yarıçapı, haritadaki noktada 150 m) **taze**
  (en çok 2 dk) ve **iyi doğrulukta** (100 m'den iyi) bir konum görünce varılmış sayar. Buluşmadaki
  "geldi" kuralının aynısı (ADR 0026).
- Varınca ya da kişi "Vardım / İyiyim" deyince emanet iptal edilir (`DELETE`); sunucu şifreli metni
  hemen kalıcı olarak siler.
- Varış anlaşılamazsa (konum yok, kaba konum) telefon **"varmadı" demez**; yalnız kontrol açık kalır
  ve T'de kişiye sorar.
- **Çevrimdışı varış (PM şartı 2):** kişi vardığında telefon çevrimdışıysa iptal (`DELETE`) sıraya
  girer ve bağlantı gelince yeniden denenir (Güvendeyim kuyruğu gibi, ADR 0029 §6). Uyarı o arada
  gittiyse ve varış T + G'den önce anlaşılmışsa telefon alıcılara kendiliğinden `checkin-ok` gönderir:
  "Ali vardı, haber geç ulaştı".

### 7. "İyi misin?" ve ek süre (rakiplerden ders)

- T anında kişinin telefonu **yerel bildirim** gösterir (önceden kurulur, internet istemez): "Ev'e
  vardın mı? 10 dk içinde cevap vermezsen Ayşe ve Can'a haber gider." Düğmeler: **İyiyim** (iptal),
  **15 dk uzat** (bkz. 5, `extend`).
- G dakikası dolunca (T + G) sunucu iletir. Sunucu ayrıca hatırlatma göndermez; yerel bildirim
  telefon çevrimdışıyken de çalışır. (PM sorusu 3.)
- Uyarı gittikten sonra kişinin telefonu açılırsa "Uyarı Ayşe ve Can'a gitti" der ve **"İyiyim, haber
  ver"** düğmesi sunar: aynı alıcılara kişisel bir öğe (`checkin-ok`, `id` ile) gider.

### 8. Alıcı kuralları

Sunucu her kurulumda, yenilemede ve iletimde denetler:

- alıcı, kişiyle **ortak bir etkin çemberde**;
- iki taraftan biri ötekini **engellemiş değil**;
- alıcının hesabı etkin ve uygulaması bu türü biliyor (istemci seviyesi, bkz. 12).

Uymayan alıcı için kurulumda tek, genel bir cevap döner: "Bu kişiye uyarı gönderilemiyor." Neden
(engel, ortak çember yok, eski uygulama) söylenmez. Sessizce kabul edip iletmemek (ADR 0035'teki
kişisel öğe kuralı) burada uygulanmaz, çünkü kişi güvenliğini o alıcıya bırakıyor ve yanılmamalı.
(PM sorusu 4.)

Alıcının görmesi:

- **Kurulunca:** alıcıya kişisel bir öğe gider: "Ali seni eve vardım kontrolüne ekledi · en geç 23:30."
  Yer ve konum yok. **Tekrarlı kontrolde** bu haber yalnız plan kurulunca ya da değişince gider,
  planın metniyle ("hafta içi 23:30"); günlük kurulumlarda gitmez (PM şartı 3).
- **Varınca / iptalde:** "Ali vardı ✓" (kişisel öğe, `id` ile). Bu, sunucunun iptal edilmiş bir emaneti
  sonradan iletmesine karşı da korur (bkz. 10). **Ses ya da bildirim çıkarmaz**, yalnız alıcının
  telefonundaki durumu günceller (PM şartı 3).
- **Uyarı gelince** "Güvenlik uyarıları" kanalında yüksek öncelikli bir bildirim gelir; **tam ekran
  görünüm bildirime dokununca** (ya da uygulama açıkken hemen) açılır, tam ekran niyet izni istenmez
  (PM şartı 4). Görünüm: "Ali, 23:30'daki eve vardım kontrolüne cevap vermedi." Altında:
  - hedefin adı;
  - haritada son konum ve **tazeliği**: "son konum 7 dk önce" (bkz. 9);
  - pil: "%3, şarjda değil";
  - not;
  - **112'yi ara**, **KADES**, **Mesaj yaz** ve sabit metin "Bargu acil servis değildir."
  - Kişiyle bir çemberde konum paylaşılıyorsa canlı pini de görünür (sıradan paylaşım, değişiklik
    yok).
- Uyarı **"varmadı" demez, "cevap vermedi" der.** Eski konuma bakıp sonuç çıkarılmaz.

### 9. Tazelik ve N1: pil bitmeden son konum

**Tazelik etiketi yalnız telefonda hesaplanır:** konumun kendi `ts`'inden, alıcının saatine göre. Ö5
uyarısında ve haritada aynı biçim: "3 dk önce", "1 sa önce". Eskiyince var olan "Neden eski?" (ADR
0028 Ek) nedeni yanında yazar.

**N1 kuralı:**

- Pil **%5 ve altına** inince ve şarjda değilken telefon son konumunu **bir kez** gönderir. Pil %15'in
  üstüne çıkana kadar bir daha göndermez.
- Bu **sıradan bir `loc` mesajıdır**: konum, `bat` ve `chg` alanları zaten şifreli metnin içinde
  (PROTOCOL §5). **Yeni alan yok, açık alan yok**; sunucu sıradan bir konum mesajı görür ve yeni bir
  şey öğrenmez. Eski uygulamalar da aynı mesajı okur.
- Yalnız şu an paylaşım açık olan çemberlere, her birinin kendi hassasiyetinde gider. Hayalet,
  duraklamış çember, süresi dolmuş ya da dondurulmuş paylaşım: gitmez (kurallar değişmedi).
- Açık bir eve vardım kontrolü varsa emanet de hemen yenilenir (bkz. 4).
- **Alan telefonda:** kişinin son konumu eskidiyse (10 dk, var olan sınır) ve o konumda pil %5 ve
  altı, şarjda değilse: "**Pili bitmek üzereydi** · son konum 23 dk önce". Bu, "Neden eski?" tahmininin
  yerine geçer.
- Sınır: telefonda konum servisi çalışmıyorsa (paylaşım kapalı, kontrol yok, uygulama kapalı)
  Android uygulamayı uyandırmaz; o zaman hiçbir şey gitmez. Yeni izin istenmez.

### 10. Tehditler (açıkça)

| Tehdit                                                 | Ne olur                                                               | Önlem                                                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu uyarıyı **erken** iletir                        | Alıcılar ancak kişinin zaten seçtiği şeyi görür (son konum, pil, not) | Alıcının telefonu imzalı `due + grace` ile karşılaştırır; erkense ekranda "Bu uyarı beklenenden erken geldi (23:40 bekleniyordu)" yazar. 2 dk saat farkı payı                                                           |
| Sunucu uyarıyı **tutar, hiç iletmez** ya da geciktirir | Kimseye haber gitmez                                                  | Önlenemez; açıkça yazılır. Kurulum ve uyarı ekranında 112 ve KADES kısayolu ile "Bargu acil servis değildir"                                                                                                            |
| Sunucu **iptal edilmiş** ya da eski bir emaneti iletir | Alıcı yanlış alarm görür                                              | Sunucu iptal edileni hemen siler (güven); alıcı telefon gördüğü `id`'leri 48 saat tutar, "vardı ✓" aldığı `id`'yi gösterme yerine "Ali bu kontrolde varmıştı" der; yaş kuralı (`due + grace + 24 sa`) eski kutuyu açmaz |
| Sunucu ya da üye **sahte uyarı** uydurur               | —                                                                     | Kutu kişinin cihazıyla imzalı; imzasız ya da tanınmayan cihazdan gelen atılır. Sunucu haberi tek başına bir şey göstermez, kutu açılmazsa "uyarı açılamadı" yazar                                                       |
| Kişiyi **zorla** kontrol kurdurmak (alıcı: zorlayan)   | Zorlayan, uyarı giderse konumu görür                                  | Gizli kontrol yok: kalıcı bildirim alıcıları yazar; "Seni görenler" ekranı açık kontrolleri ve alıcılarını listeler; kişi tek dokunuşla kapatır                                                                         |
| Uyarıyla **taciz** (birine sürekli alarm)              | Alıcı rahatsız olur                                                   | Ortak çember şartı, 3 etkin ve günde 10 sınırı; Engelle hemen keser (yeni kurulum reddedilir, iletimde kutu silinir)                                                                                                    |
| Alıcının telefonu yeni cihaz oldu                      | Eski cihaza mühürlü kutu açılamaz                                     | Kişinin telefonu anahtar değişikliğini görünce sonraki yenilemede yeni cihaza mühürler; uyarı o arada giderse alıcıya "Ali'den bir güvenlik uyarısı geldi ama açılamadı; Ali'ye ulaş" yazar                             |
| Saat hatası                                            | Erken ya da geç kurulum                                               | Sunucu `openAt` sınırlarını kendi saatiyle denetler; alıcının "erken" denetimi 2 dk pay bırakır                                                                                                                         |

### 11. 15–17

- 15–17 yaştakiler kontrol **kurabilir** ve **alıcı olabilir**. Güvenlik özelliğidir; Güvendeyim gibi.
- Alıcı kuralları aynıdır (ortak çember). 15–17'nin çemberleri zaten yalnız karşılıklı onayla
  eklenmiş kişilerdir (ADR 0023).
- **Ebeveyn bağlantısı kendiliğinden alıcı yapmaz** ve ebeveyn gencin kontrollerini görmez. Genç,
  ebeveyniyle ortak bir çemberdeyse onu alıcı olarak seçebilir. Ebeveyn genç adına kontrol kuramaz.
- Ebeveyn araçlarında yeni bir şey yok; ebeveyn onayı gerekmez.

### 12. Ücret, eski uygulamalar, iOS

- **Hep bedava**, Bargu+ gerekmez; duraklamış çemberdeki kişiler de alıcı olabilir (Güvendeyim gibi,
  ADR 0029 §7). (PM sorusu 6.)
- Yeni istemci seviyesi (6). Seviyesi düşük alıcı seçilemez (bkz. 8). Eski uygulama `checkin` öğesini
  tanımaz ve atar.
- iPhone eklentisi (Swift) yeni haber türünü iOS yayınına kadar bilmez; bilinmeyen tür atlanır.

## Sonuçlar

**Sunucunun gördükleri** (PM şartı): bir emanetin var olduğu, sahibi, alıcıları, açılma saati,
kutuların boyutu (dolgulu), kurulma, yenilenme, uzatılma, iptal ve iletilme anları, alıcının "gördüm"
dediği an. Gidilen yer, konum, pil, not ve tekrar planı **gitmez**.

**Belgeler (PM kararı):** THREAT_MODEL ve N2'yi kodlama oturumu, **kodla aynı commit'te** günceller
(N2 testi THREAT_MODEL'i okur). Gizlilik politikası ve Play belgelerini PM, paketin APK'sı çıkmadan
önce günceller. Değişecek satırlar:

- THREAT_MODEL, "Saldırganlar ve önlemler":
  - yeni satır "Sunucunun eve vardım uyarısını erken, geç iletmesi ya da hiç iletmemesi" (bkz. 10);
  - yeni satır "Eve vardım kontrolüyle zorlama ve taciz";
  - "Kontrolcü partner" satırına: açık kontroller "Seni görenler"de.
- THREAT_MODEL, "Kabul edilen sızıntılar": yeni satır **"Eve vardım kontrolleri"**: yukarıdaki liste;
  azaltma: içerik ve yer şifreli, iptal edilen hemen silinir, iletilen en geç 24 saatte. N1 için yeni
  satır gerekmez ("Gönderim zamanları ve sıklığı" satırı kapsar).
- N2 "Sunucu ne biliyor?" ekranı: yeni satır yeni bir gruba ya da "olay zamanları" grubuna bağlanır
  (`server-knows.ts` eşlemesi ve testi THREAT_MODEL'i okur; satır eklenince test bunu ister).
- Gizlilik politikası: yeni amaç "eve vardım kontrolü"; saklama: iptalde hemen, iletilen en geç 24
  saat, hesap silinince; sunucunun içeriği göremediği. 15–17 kısa bölümü: genç kurabilir, ebeveyn
  görmez.
- Play veri güvenliği formu: yeni veri türü yok (konum zaten uçtan uca şifreli gidiyor). Konum
  satırının amaç açıklamasına "güvenlik uyarısı" eklenmeli mi, PM kontrol eder.

**Testler (kod aşamasında):**

- `packages/schemas`: `checkin` öğe şeması; eski uygulama türü atar.
- `packages/crypto`: kişisel öğe yoluyla `checkin` mühürleme ve açma; başka cihaz açamaz; imza
  bozulursa reddedilir; geç açılan uyarı `due + grace + 24 sa`'e kadar açılır, sınırı geçen ya da
  `ts`'i `due`'dan 23 saatten eski kutu açılmaz (PM şartı 1).
- API: her uç nokta için zod, yetki ve "başka kullanıcı erişemez"; yenileme `openAt`'ı değiştiremez;
  uzatmayı yalnız sahip yapar; 3 etkin sınırı; engelli ve ortak çembersiz alıcı tek genel cevap alır;
  iptal satırı kalıcı siler; iş yükünde yalnız kimlik var; iletimde alıcı yeniden denetlenir; 24 saat
  ve "gördüm" silmesi; hesap silme.
- Telefon: varış yalnız taze ve iyi konumla; "varmadı" yazısı yok; erken uyarı etiketi; çevrimdışı
  iptal sıraya girer, uyarı gittiyse "haber geç ulaştı" gider; tekrarlı kontrolde kurulum haberi yalnız
  plan değişince; "vardı ✓" sessiz; N1 bir kez gönderir ve şarjla yeniden kurulur; hayalette N1
  gitmez; yeni izin yok (manifest testi).

**Riskler:**

- Uyarı sunucuya bağlıdır; sunucu hiç iletmezse kimse bilmez. Ekrandaki 112 / KADES metni bu yüzden
  şart.
- Kontrol açıkken konum servisi çalışır; pil maliyeti ADR 0036'daki gibi.
- Tekrarlı kontrol, telefon o gün hiç çalışmazsa kurulmaz.

## PM soruları (karara bağlandı, PM 2026-10-30: hepsinde öneri geçerli)

1. Emanetteki son konum **tam hassasiyette** mi gitsin (öneri), yoksa alıcının çemberindeki
   hassasiyette mi?
2. Kontrol **hayalet modda da** çalışsın mı (öneri: evet, ekran yazar)?
3. T anındaki "iyi misin?" yalnız **yerel bildirim** mi (öneri), yoksa sunucu da içeriksiz bir
   hatırlatma göndersin mi (yeni üst veri: hatırlatma saati)?
4. Uygun olmayan alıcıya **tek genel cevap** (öneri) mi, yoksa ADR 0035'teki gibi sessizce kabul mü?
5. Alıcıya **kurulunca ve varınca** kısa haber gitsin mi (öneri: evet; hem beklenti hem eski emanetin
   tekrarına karşı koruma)? Hayırsa 10'daki "iptal edileni iletme" önlemi zayıflar.
6. **Hep bedava** ve duraklamış çemberde de çalışsın mı (öneri: evet)?

## Uygulama notları (kodlama oturumu, 2026-10-30)

Kod bu ADR'yi ve PM şartlarını izler. Metinden ayrıldığı ya da metni netleştirdiği yerler:

1. **İletim bir akış olayıdır.** İşçi, kontrol ateşlenince alıcılara ve sahibe kalıcı `checkin.fired`
   olayı yayınlar (yalnız kontrolün ve sahibin kimliği). Böylece telefonu kapalı olan da geri
   gelince duyar. Canlı `checkin.fired` mesajı yerine bu seçildi: işçi canlı mesaj yollayamıyor.
2. **Kurallar veritabanında.** Migration 0045'teki `SECURITY DEFINER` işlevleri kuralları uygular:
   `create_checkin`, `refresh_checkin`, `extend_checkin`, `cancel_checkin`, `ack_checkin`,
   `fire_checkin`. Kutuyu yalnız alıcısı, yalnız ateşlendikten sonra okur. Sahip kutuları okuyamaz;
   alıcılarını ayrı bir işlevle görür.
3. **Kaçırılan iş.** İşçi kapalıyken zamanı geçen kontrolleri her dakika yoklayıp ateşler. Alıcı
   uyarıyı `due + grace` anından itibaren 24 saat açabilir (PM şartı 1; geç ateşleme bu süreyi
   kısaltmaz).
4. **Eski uygulama.** Sunucu üyelerin uygulama sürümünü saklamıyor (ADR 0040 notu gibi). Bu yüzden
   §8'deki "uygulaması bu türü biliyor" şartı kurulumda denetlenemez. Seviyesi 8'den eski uygulama
   gelen kutusunu çekemez (426); onun telefonu uyarıyı gösteremez. C APK'sından sonra kapalı test
   grubunun hepsi seviye 8'de olacak.
5. **Alıcının ekranı.** Bildirim, "Güvenlik uyarıları" kanalında yüksek öncelikli gelir ve
   dokununca uyarı ekranı açılır (tam ekran izni yok, PM şartı 4). Son konum, Güvendeyim'in harita
   noktasıyla gösterilir. Açılamayan uyarı için "açılamadı, kendisine ulaş" yazar.
6. **KADES kısayolu.** Uygulamanın paket adı tahmin edilmedi; Play'de KADES araması açılır.
7. **N1.** Pil %5 ve altına inip şarjda değilken son konum bir kez gider. Kısa bir şarj tekrar
   kurmaz; yalnız %15'in üstü kurar. Alan telefon "Pili bitmek üzereydi" yazar.
8. **Tekrarlı kontrol.** Hafta içi her gün, seçilen saat. "Dünkü kontrol kurulamadı" uyarısı bu
   pakette yok (sonraki adım).

## QA-44 düzeltmeleri (kodlama oturumu, 2026-11-02)

1. **Alıcılar görünür.** Konum servisinin kalıcı bildirimi alıcıların adlarını yazar: "Eve vardım
   kontrolü açık · 23:30 · Ayşe, Can". "Seni görenler"de adlar ekranda yazar; "çemberlerin seni
   görmez" yalnız hayalette.
2. **Konum izni yokken.** Kurulum ekranı "Konum izni kapalı: varınca Vardım'a dokun" der ve "varınca
   kendiliğinden kapanır" demez. İzin yokken konum servisi çalışamaz, bu yüzden açık kontrol için
   kendi kalıcı bildirimi çıkar (aynı satır, aynı uyarı); dokununca kontroller açılır.
3. **Yetim kontrol yok.** Kimlik gönderimden önce üretilip saklanır; cevap gelmezse aynı kimlikle
   iki kez daha sorulur (sunucu aynı sahibin aynı kimliğine "tamam" der). Cevabı hiç gelmeyen
   kimlik "belirsiz" olarak saati gelene kadar tutulur. Tekrarlı planda günün kimliği bir kez
   üretilip planda durur. Uygulama açılınca, ön plana gelince ve bağlantı gelince telefon
   `GET /v1/checkins` ile karşılaştırır; tanımadığı, ateşlenmemiş kontrolü iptal eder.
4. **Sunucu bir gün kimlik tutar** (migration 0046, `app.checkin_setups`): yalnız kimlik, sahip ve
   kurulma anı. Günlük 10 sınırı bunları sayar, açık satırları değil; iptal edilen bir kimlik bir
   gün içinde yeniden kurulamaz (gecikmiş bir isteğin kopyası hayalet kontrol kuramaz). Uygulamanın
   rolü tabloyu okuyamaz; yalnız işlevler kullanır. Süpürme bir günü geçenleri siler.
5. **Çıkış.** Önce açık kontroller sunucuda iptal edilir. Sunucuya ulaşılamazsa sorulur: "Açık bir
   eve vardım kontrolün var; çıkarsan uyarı gidebilir. Yine de çık / Vazgeç".
6. **Hayalette pil.** Bütün çemberlere hayaletken de pil %5'e inince açık kontroller hemen yenilenir.
7. **"İyi misin?" gecikmesi.** Yeni izin yok (SCHEDULE_EXACT_ALARM ve USE_EXACT_ALARM istenmez).
   Sahip gecikmeyi telefonda ölçecek; 3 dakikadan fazlaysa hatırlatma erkene alınır (PM).

## Ek 1 — Kimlik saklama süresi (PM, 2026-11-05)

QA-45'teki "iptal edilen kimlik 24 saat yeniden kullanılamaz" cümlesinin başlangıcı netleştirildi:
**24 saat, kontrolün kurulum anından (`checkin_setups.created_at`) başlar; iptal anından başlamaz.**
İptalden itibaren ayrı bir süre uygulamak için `cancelled_at` veya başka yeni metadata tutulmaz.

Neden: gecikmiş kurulum isteğinin kopyası iptal edilmiş kontrolü yeniden kuramasın ve günlük 10
kurulum sınırı aşılmasın diye yalnız kimlik, sahip ve kurulum anı yeterli. Sunucuda yeni bir olay
zamanı saklamamak veri minimizasyonunu korur. Migration 0046'daki mevcut davranış aynen kalır.
