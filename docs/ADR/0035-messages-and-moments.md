# 0035. Mesajlar ve anlık fotoğraf: 24 saatlik, uçtan uca şifreli tek modül

- Durum: Kabul edildi (PM, 2026-10-27), beş ekle: anahtar bağlılığı (§2–§4, §9), etkinlik
  çemberleri (§7, §8), gönderme ekranı (§1), sunucu kurulumu (§10, §15), engelleme ekranı (§6).
  Kod dilimler hâlinde başladı (M0). Sıradaki APK bu modülün hepsi bitince çıkar (sahip,
  2026-10-27: "hepsini tamamlamadan yeni sürüm çıkmasın").
- Tarih: 2026-10-27
- Yerine geçtiği: [ADR 0032](0032-messaging.md) (mesajlaşma) ve [ADR 0033](0033-stories.md)
  (hikaye). İkisi de "Yerine geçti" olur.
- İlgili: [PROTOCOL §4–§6, §8, §9](../PROTOCOL.md), [ADR 0016](0016-sealed-push-notifications.md)
  (mühürlü bildirim), [ADR 0023](0023-age-15-plus.md) (15–17),
  [ADR 0024 §10](0024-entitlements-and-test-billing.md) (istemci seviyesi),
  [ADR 0034](0034-domain-and-closed-test-server.md) (ortak sunucu, yedek).

## Bağlam

Sahip, 2026-10-27, aynen: "hikaye de olsun anlık paylaşım foto sadece o şekilde paylaşılabilsin
hikayeyei birine de paylaşabilirisn herkesede instada da öyleydi bi süre. farklı modül yapmaya gerek
yok ani. 24 satte de silinsin mesajlar. diğer tüm detayları belirle sen işte."

Kuralları PM belirledi (BARGU_PLAN, Açık Kararlar, "Mesajlaşma ve anlık hikaye"):

- tek modül: yazı ve anlık fotoğraf aynı yerde;
- fotoğraf yalnız uygulamanın kamerasıyla o an çekilir; galeri ve video yok;
- yalnız çember üyeleri arasında;
- her şey 24 saatte sunucudan ve telefonlardan silinir;
- uçtan uca şifreli; bildirimde içerik yok;
- her öğede Bildir ve kişiyi Engelle.

Bu ADR bu kuralların nasıl yapılacağını yazar.

## Karar

### 1. Ne var, ne yok

| Var                                                                                 | Yok (v1)                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Bir kişiye yazı ya da fotoğraf                                                      | Galeriden fotoğraf, video, ses, dosya, konum eki |
| Bir çembere yazı ya da fotoğraf (ikili çember = kişiye yazmak)                      | Yazıyor göstergesi, okundu bilgisi, tepki        |
| Hikaye: bir fotoğraf, bütün çemberlerine ya da seçtiklerine; pinin çevresinde halka | Hikayenin kimin gördüğü listesi                  |
| Hikayeye yanıt: hikayeyi gönderene kişisel yazı                                     | Yabancıya yazmak, keşfet, herkese açık akış      |
| Gönderenin "herkesten sil"i, 24 saat dolmadan                                       | 24 saatten uzun saklama, dışa aktarma            |
| Ekran görüntüsü haberi (Android 14+), Bildir, Engelle                               | Ekran görüntüsünü engellemek                     |

Kişiye yazmak için ortak bir çember yeter, arkadaş (ikili çember) olmak gerekmez. Bir kişiyle ikili
çember varsa, o çemberin sohbeti o kişiyle yapılan kişisel sohbettir; ayrı bir sohbet açılmaz.

Mesaj ve hikaye duraklamış çemberde de çalışır ve bedavadır (iletişim temel hizmet).

**Gönderme ekranı (PM eki 3).** Fotoğraf çekildikten sonra tek ekranda üç seçenek çıkar. Sahibin
"birine de herkese de" isteği budur:

- **Hikaye (bütün çemberlerim):** etkinlik çemberleri hariç bütün çemberler (§8);
- **Çember seç:** bir ya da birkaç çember; etkinlik çemberleri de burada seçilebilir;
- **Bir kişi:** ortak çemberi olan biri; kişisel öğe olarak gider (§3).

### 2. Kripto: çembere giden öğe (sohbet zarfı)

Çemberin mevcut gönderen anahtarları ve epoch'ları kullanılır. Yeni anahtar dağıtımı yok. Ama
sohbet, konumla aynı anahtarı **kullanmaz**. Geçmişte olduğu gibi (PROTOCOL §6, `historyKey`)
gönderen anahtarından ayrı bir sohbet anahtarı türetilir:

```
chatKey    = HMAC-SHA256(senderKey, "bargu/v1/chat-key\0" ‖ circleId(16) ‖ epoch(4) ‖ senderDeviceId(16))
base       = 0x01 ‖ circleId(16) ‖ epoch(4) ‖ senderDeviceId(16) ‖ itemId(16) ‖ salt(16)   // 69 bayt
key, nonce = HKDF(chatKey, salt, "bargu/v1/chat\0", base)
commit     = SHA-256("bargu/v1/chat-commit\0" ‖ key ‖ nonce)                              // 32 bayt
header     = base ‖ commit                                                                // 101 bayt
ct         = ChaCha20-Poly1305(key, nonce, aad = header, pt = pad(JSON(payload), 1024 | 8192))
sig        = Ed25519.sign(sender.identity, "bargu/v1/chat-sig\0" ‖ header ‖ ct)
```

- **Ayrı anahtar, ayrı etiket, ayrı başlık boyu.** Sohbet zarfı konum mesajının, belgenin ya da
  geçmişin yerine geçemez; tersi de olmaz.
- **Anahtar bağlılığı (`commit`, PM eki 1).** ChaCha20-Poly1305 bir şifreli metni tek bir anahtara
  bağlamaz: aynı şifreli metnin başka bir anahtarla da açıldığı durumlar kurulabilir. Bildirme
  (§9) "şu anahtar bu öğenin anahtarıdır" kanıtına dayandığı için bu bağ açıkça kurulur:
  - Gönderen, öğenin anahtarının ve nonce'unun SHA-256 özetini başlığa koyar. Başlık hem AEAD'in
    ek verisidir hem de imzanın içindedir.
  - Anahtar, bağlılığı içermeyen 69 baytlık temel başlıktan türetilir. Bağlılık anahtarın
    kendisinden hesaplandığı için onu anahtarın türetildiği girdiye koymak döngü olurdu.
  - **Alıcı** çözmeden önce bağlılığı denetler, uymayanı atar. Böylece hiçbir gönderen alıcıların
    görüp sunucunun doğrulayamayacağı bir öğe gönderemez.
  - **Sunucu** bildirimde aynı denetimi yapar (§9). Kanıt imzaya ve SHA-256'nın çarpışma
    direncine dayanır, Poly1305'in özelliklerine değil.
  - Nonce da özete girer; bildiren ikisini birlikte verir. Bedeli öğe başına 32 bayt.
- **`itemId`:** her öğe için 16 rastgele bayt, başlıkta açık. Sunucu onu birincil anahtar yapar
  (aynı öğe ikinci kez yazılamaz). Silme ve bildirme de onu gösterir. `seq` yok; konumun tekrar
  penceresine dokunulmaz.
- **Dolgu:** düz metin 1024 ya da 8192 bayttan sığan en küçüğüne tamamlanır. Yalnız "kısa ya da
  uzun" belli olur. Yazı en çok 1000 karakterdir; en kötü hâli de 8192'ye sığar.
- **Tekrar koruması (alıcıda):**
  - öğenin `ts`'i son 24 saatin içinde olmalı ve en çok 5 dakika ileride olabilir;
  - aynı `(circleId, itemId)` 25 saat içinde bir kez gösterilir.

  Konumdaki epoch tabanı (N−2 reddi) sohbete uygulanmaz. Onun yerine 24 saat kuralı vardır: sunucu
  eski bir öğeyi yeniden gönderse bile 24 saati geçmişse düşer, geçmemişse kimlik ile tekrar
  yakalanır.

- **Anahtar saklama:** alıcı bir epoch'un sohbet anahtarını, o epoch bittikten sonra 25 saat daha
  tutar. Gönderen anahtarı bugünkü gibi iki epoch sonra silinir. Böylece 23 saat kapalı kalan
  telefon, araya iki epoch girmiş olsa da mesajları açar. Epoch'lar en geç 24 saatte yenilendiği
  için (PROTOCOL §4) bir sohbet anahtarı en çok ~49 saat yaşar.
- Çıkarılan üye yeni epoch'u alamaz, ayrıldıktan sonraki öğeleri açamaz (bugünkü kanıt geçerli).
  Ayrılmadan önce aldıklarını zaten görmüştü.

### 3. Kripto: kişiye giden öğe (kişisel zarf)

Kişinin tek etkin cihazına mühürlenir. Gönderen anahtarı dağıtımıyla (PROTOCOL §4) aynı yapı:

```
base       = 0x01 ‖ senderDeviceId(16) ‖ recipientDeviceId(16) ‖ itemId(16) ‖ ephPub(32)   // 81 bayt
shared     = X25519(ephSecret, recipient.dhPub)                                          // her öğede taze
key, nonce = HKDF(shared, salt = ephPub ‖ recipient.dhPub, "bargu/v1/dm\0", base)
commit     = SHA-256("bargu/v1/dm-commit\0" ‖ key ‖ nonce)                                // 32 bayt
header     = base ‖ commit                                                                // 113 bayt
ct         = ChaCha20-Poly1305(key, nonce, aad = header, pt = pad(JSON(payload), 1024 | 8192))
sig        = Ed25519.sign(sender.identity, "bargu/v1/dm-sig\0" ‖ header ‖ ct)
```

- İlk bayt, bütün başlıklar gibi sürümdür (`0x01`, PROTOCOL §11). Sohbet zarfından (101 bayt) ayrı
  etiketleri ve boyu (113 bayt) ayırır; JSON'da da biri çemberini, öteki alıcı cihazını adlandırır.
- Anahtar bağlılığı sohbet zarfındakiyle aynı gerekçeyle ve aynı kuralla vardır (§2), kendi
  etiketiyle.
- Alıcı sırası: biçim → alıcı bu cihaz mı → gönderen cihaz, ortak çemberi olan bir kişinin güvenilen
  cihazı mı (güven kaydı, PROTOCOL §8) → imza → X25519 (düşük mertebe reddi) → bağlılık → çözme →
  dolgu → şema → 24 saat ve tekrar kuralı (§2).
- Gönderen kendi kopyasını telefonunda tutar; sunucuya kendine giden kopya gönderilmez.
- Kişi telefonunu değiştirirse eski cihazına mühürlenmiş öğeleri yeni cihaz açamaz. 24 saatlik
  ömür içinde bu kabul edilir; gönderen "teslim edilemedi" görür.
- Geçici anahtar her öğede tazedir. Gönderenin uzun ömürlü anahtarı çalınsa bile geçmiş öğeler
  açılmaz; alıcınınki çalınırsa açılır. Bugünkü anahtar dağıtımıyla aynı sınır.

### 4. Kripto: fotoğraf dosyası

Telefonda sıra:

1. Kamera (`expo-camera`, kurulu) o an çeker. EXIF istenmez.
2. `expo-image-manipulator` (kurulu) uzun kenarı 1600 piksele indirir ve JPEG'e yeniden yazar.
   Yeniden yazılan dosyada EXIF ve GPS yoktur. 500 KB'ı aşarsa kalite düşürülüp yeniden denenir.
3. Rastgele 32 baytlık `blobKey` ve 12 baytlık nonce ile şifrelenir:

   ```
   commit = SHA-256("bargu/v1/blob-commit\0" ‖ blobKey ‖ nonce)
   head   = 0x01 ‖ nonce(12) ‖ commit(32)                                   // 45 bayt
   blob   = head ‖ ChaCha20-Poly1305(blobKey, nonce, aad = "bargu/v1/blob\0" ‖ blobId(16) ‖ head, pt = jpeg)
   ```

4. Sunucuya yüklenir (en çok 600 KB). Sunucu yalnız şifreli baytı görür.
5. Anahtar, `photo` içeriğiyle, sohbet ya da kişisel zarfta gider (§5). Hikaye birden çok çembere
   giderse dosya bir kez yüklenir, anahtar her çemberin zarfında ayrı gider.

- `blobKey` tek kullanımlıktır; aynı anahtar başka bir dosyada kullanılmaz.
- Dosyanın kendi anahtar bağlılığı vardır (PM eki 1). Açan, çözmeden önce onu denetler.
- `photo` içeriği dosyanın tamamının SHA-256 özetini (`hash`) taşır. İçerik imzalı ve bağlı
  zarfın içinde olduğu için dosya, anahtarı ve göndereni birbirine bağlanır: sunucu bildirimde
  önce özeti, sonra dosyanın bağlılığını denetler, sonra çözer (§9).
- `blobId` ek veride olduğu için bir dosya başka bir dosyanın yerine konamaz.

### 5. İçerik türleri (PROTOCOL §6'ya, yalnız bu iki zarfta)

| `kind`  | Alanlar                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------- |
| `text`  | `id, text (1–1000 karakter), replyTo? (öğe kimliği ya da hikaye kimliği), ts`                         |
| `photo` | `id, blobId, key, size, hash (dosyanın SHA-256'sı), w, h, caption? (≤ 200), story (true / false), ts` |
| `del`   | `id, target, ts`: gönderen kendi öğesini (`target`) herkesten siler                                   |
| `shot`  | `id, target, ts`: alıcı o fotoğrafın (`target`) ekran görüntüsünü aldı (Android 14+)                  |

- `id` her türde başlıktaki `itemId`'ye eşit olmalıdır.
- `del` ve `shot` yalnız ilgili öğeyi gören kişiler arasında gider. `del` yalnız `target` öğeyi
  gönderen kişinin cihazından gelirse uygulanır; alıcı bunu denetler.
- Bu türler konum yollarından gelirse ya da konum türleri bu zarflardan gelirse reddedilir (alıcı
  türü yola bağlar, bugünkü kural).

### 6. Sunucu

**Tablolar (yalnız ekleyen migration'lar, ADR 0034 §5b):**

- `app.chat_items` (migration 0040): kimlik, çember ya da alıcı kişi (ikisi birden değil),
  gönderen, zarf, dosya kimliği (varsa), oluşturma ve bitiş zamanı. RLS:
  - gönderen kendi öğesini görür;
  - çember öğesini, gönderildiği an orada olan ve hâlâ orada olan üyeler görür;
  - kişisel öğeyi o kişi görür;
  - kimse engellediği birinin öğesini görmez.
- `app.media_blobs`: şifreli fotoğrafın kendisi **veritabanında** (profil fotoğrafları gibi),
  boyutu, oluşturma ve bitiş zamanı. Uygulamada değişti: ADR'nin ilk hâli `/srv/bargu-media`
  klasörü ve ayrı bir erişim tablosu diyordu. Veritabanında durunca:
  - ortak sunucuda klasör ya da bağlama gerekmez;
  - kim alabilir sorusunu RLS cevaplar: dosyayı, onu paylaşan bir öğeyi okuyabilen alır;
  - dosya satırıyla birlikte gider;
  - gece yedeği onu dışarıda bırakır.
- `app.blocks(blocker_id, blocked_id, created_at)`: yalnız engelleyen görür.
- `app.reports` (migration 0041): §9.

**Uç noktalar** (hepsi zod doğrulamalı, cihaz imzalı, "başka kullanıcı erişemez" testli):

- `POST /v1/chat/circles/:id`: sohbet zarfı. Sunucu imzayı, gönderenin çemberin etkin üyesi
  olduğunu ve epoch'un güncel olduğunu denetler.
- `POST /v1/chat/people/:userId`: kişisel zarf. Sunucu ortak bir etkin çember olduğunu ve
  alıcının gönderenin engellemediğini denetler.
- `GET /v1/chat?after=<imleç>`: son 24 saatin, bana görünen öğeleri. Uygulama açılınca ve canlı
  bağlantı yeniden kurulunca bir kez çağrılır; yoklama değildir.
- `DELETE /v1/chat/:itemId`: yalnız gönderen.
- `POST /v1/media`, `GET /v1/media/:blobId`: yükleme ve indirme. İndirme yalnız dosyayı paylaşan
  bir öğeyi okuyabilen kişiye açıktır. Bu iki yol ve `POST /v1/reports` 900 KB'lık gövde alır,
  öteki her yol 64 KB.
- `PUT /v1/blocks/:userId`, `DELETE /v1/blocks/:userId`, `POST /v1/reports`.

**Canlı olaylar:** `chat` (öğenin kaydı, zarfıyla), `chat.gone` (gönderen geri aldı). Durum
değişikliği olaydır; listeyi yenileme düğmesi yoktur.

**Engelleme:**

- Engellenen kişi bana kişisel öğe gönderirse sunucu `{ ok: true }` der ama iletmez
  (engellendiğini öğrenmez).
- Ortak çemberlerdeki öğeleri ve hikayeleri bana gösterilmez: sunucu bana iletmez, telefon da
  süzer.
- Engellemek çembere ya da konuma dokunmaz. Engelleme ekranı bunu açıkça yazar (PM eki 5):
  "Engellemek konumunu gizlemez. Konumunu gizlemek için çemberden ayrıl." Hemen altında o kişiyle
  ortak çemberlerden ayrılma düğmesi vardır; yöneticiye ayrıca "Çemberden çıkar" önerilir.

### 7. Silme: 24 saat

**Sunucuda:**

- Her satırın `expires_at = created_at + 24 saat`. Okumalar süresi dolmuşu hiç döndürmez.
- İşçide 5 dakikada bir çalışan süpürücü (`MessagesSweeper`, konum geçmişininki gibi, Redis
  kilidiyle) süresi dolan satırları ve hiçbir öğenin paylaşmadığı dosyaları siler. Süpürücü
  gecikse de okuma süzgeci süresi dolanı göstermez. Telefonlar kendi saatleriyle sildikleri için
  süre dolunca olay gönderilmez.
- Gönderen silince satır ve dosya hemen gider.
- Üye çemberden ayrılınca ya da çıkarılınca o çemberdeki öğeleri ve oraya paylaştığı hikayeler
  silinir ("çemberden çıkmak iz bırakmaz").
- Hesap silinince bütün öğeleri ve dosyaları gider.
- **Etkinlik bitince** (PM eki 2) çember silinir; içindeki bütün öğeler ve yalnız oraya
  paylaşılmış dosyalar da 24 saati beklemeden gider. Başka çemberlere de paylaşılmış bir hikayenin
  dosyası kalır, yalnız o çemberin erişimi silinir.
- Bildirilen öğenin açık kopyası ayrı tutulur (§9); 24 saat kuralı ona uygulanmaz.
- Gece yedeği (ADR 0034) bu tabloları **almaz**: 24 saatlik veri 14 günlük yedekte durmamalı.
  Yedek betiği bu tabloları dışarıda bırakır, geri yükleme denemesi de bunu denetler.

**Telefonda:**

- Öğeler şifreli kasada (MMKV) durur, çözülmüş fotoğraf yalnız gösterilirken bellekte.
  Şifreli dosya önbellekte en çok 24 saat durur.
- Uygulama açılınca, öne gelince ve bir sonraki sona eriş anına kurulan tek bir zamanlayıcıyla
  süresi dolanı siler. Yoklama yok.
- Çıkış yapınca ve hesap silinince hepsi gider.

### 8. Kim neyi görür; kişiyi unutmak

- **Çember öğesi ve hikaye:** gönderildiği an o çemberde olan ve hâlâ orada olan üyeler. Sonradan
  katılan göremez: katılınca epoch yenilenir, eski sohbet anahtarı ona gitmez. Sunucu da dosyayı
  ona vermez.
- **Hikayenin varsayılan kitlesi** (PM eki 2): etkinlik çemberleri hariç bütün çemberler. Etkinlik
  çemberinde bir kez görülen insanlar olabilir; etkinlik çemberi ancak "Çember seç"te elle seçilirse
  hikayeyi görür.
- **Kişisel öğe:** yalnız gönderen ve alıcı. Ortak çember kalmazsa yeni öğe gönderilemez.
- **Hikaye halkası:** bir kişinin bana görünen, süresi dolmamış hikayesi varsa haritadaki pininin
  çevresinde ince, renk geçişli bir dış halka çıkar. Süs halkasının (ADR 0025) dışında durur, onunla
  karışmaz; açılınca griye döner. Sade modda hareket etmez.
- **Kişiyi unutmak (PROTOCOL §8):** son ortak çember gidince o kişinin bütün öğeleri, hikayeleri,
  önbellekteki dosyaları, kişisel sohbeti, sohbet anahtarları ve tekrar kayıtları telefondan
  silinir. Engelleme kaydı, sessize alma gibi kalır: kullanıcının kendi korumasıdır.

### 9. Bildirme ve saklama

**Bildirim akışı:**

1. Her öğenin menüsünde ve her kişi kartında "Bildir". Kullanıcı bir neden seçer: istenmeyen,
   taciz, cinsel içerik, çocuğa yönelik istismar, şiddet, diğer.
2. Ekran açıkça söyler: "Bu mesajın açık hâli Bargu'ya gönderilecek."
3. Telefon `POST /v1/reports` ile şunları gönderir:
   - öğenin şifreli zarfı;
   - o tek öğenin çözme anahtarı (`key`, `nonce`; çemberin ya da kişinin anahtarı değil);
   - fotoğrafsa dosya da (sunucuda yoksa).
4. Sunucu sırayla denetler:
   - zarfın imzası, gönderen cihazın kimlik anahtarıyla;
   - verilen anahtar ve nonce'un özeti, başlıktaki bağlılıkla (§2, §3);
   - çözme (AEAD) ve içeriğin şeması; içerikteki `id` başlıktaki kimlikle aynı mı;
   - fotoğrafta: dosyanın özeti içerikteki `hash` ile, dosyanın kendi bağlılığı içerikteki anahtarla
     (§4), sonra dosyayı çözer.

   Biri tutmazsa bildirim "doğrulanamadı" olarak kaydedilir, içerik saklanmaz.

5. Böylece bildirilen içeriğin o kişiden geldiği kanıtlıdır. İmza, başlıktaki bağlılığı da
   kapsadığı için bildiren başka bir anahtar uyduramaz: uyan bir anahtar bulmak SHA-256'da çarpışma
   bulmak demektir. Bildiren, o tek öğenin anahtarından başka hiçbir şey vermez; çemberin ya da
   kişinin anahtarı açığa çıkmaz.
6. Sahibe e-postayla haber verilir (`OPS_EMAIL`, support@otenus.com). E-posta yalnız şunu yazar:
   "Yeni bildirim var, neden: X, kimlik: Y". İçerik, kişi adı ya da e-posta adresi yok. Staging'de
   gönderim hazır değilse aynı bilgiyle içeriksiz bir günlük satırı yazılır.
7. İnceleme sunucudaki bir komutla yapılır (`bargu-reports`); yönetim web sayfası yok.

**Saklama ve sonuç:**

- Açık içerik sunucunun saklama anahtarıyla şifreli tutulur (`sealAtRest`) ve **90 gün** sonra
  silinir (gizlilik politikası).
- **Çocuğa yönelik istismar** bildiriminde içerik ve hesap bilgileri saklanır, hesap kapatılır ve
  yetkililere bildirilir. Süre ve kime bildirileceği avukata sorulur.
- Gerisinde sahip karar verir: uyarı, hesabı kapatma ya da bir şey yapmama. Bildiren kişi sonucu
  ayrıntısız bir haberle öğrenir.
- İçerik taranmaz (uçtan uca şifreleme). Denetim bildirime dayanır.

**Topluluk kuralları (PM eki, 2026-10-27; Play'in kullanıcı içeriği şartı, K14):**

- İlk mesajdan, fotoğraftan ya da hikayeden önce bir kez kısa kurallar penceresi çıkar. Pencerede
  "Kuralların tamamı" bağlantısı (`https://www.otenus.com/bargu/kurallar`) ve "Kabul ediyorum" düğmesi
  vardır. Metin `docs/play-store/TOPLULUK-KURALLARI.md`'deki "Uygulama içi kısa metin"dir.
- Kabul, sürümüyle `app.consents`'e yeni bir amaç olarak yazılır (`rules`, migration 0042).
  `GET` ve `PUT /v1/me/rules` yalnız kişinin kendi kaydını okur ve yazar.
- Sunucu kabul olmadan sohbet öğesini ve fotoğraf yüklemesini `403 RULES_REQUIRED` ile reddeder.
  Telefon bunu görünce kaydı unutur ve pencereyi yeniden gösterir. Sürüm
  (`COMMUNITY_RULES_VERSION`) artarsa da pencere yeniden çıkar.

### 10. Sınırlar, kota ve disk alarmı

- Kişi başına günde en çok **500 öğe** ve **50 fotoğraf** (Redis sayacı, gece yarısı UTC). Bir
  hikaye kaç çembere giderse gitsin bir fotoğraf sayılır.
- Gönderen ve çember başına dakikada en çok 30 öğe. Aşınca `RATE_LIMITED`.
- Fotoğraf dosyası en çok 600 KB.
- **Disk:** canlı dosyaların toplam boyu `MEDIA_MAX_BYTES` ile sınırlı; staging'de **2 GB** (PM).
  Toplam, veritabanındaki `size` alanlarından hesaplanır.
  - Gerekçe: 20 test kullanıcısının hepsi her gün sınıra kadar fotoğraf atsa bile 24 saatte en çok
    ~600 MB olur (20 × 50 × 600 KB). Disk rastamen'le ortak.
  - Doluluk %80'i geçince işçi günde bir kez uyarı e-postası gönderir (`OPS_EMAIL`) ve günlüğe
    yazar. E-posta kuralı bildirimdekiyle aynı (§9): içerik ve kişi yok.
  - Doluysa yeni fotoğraf `MEDIA_FULL` ile reddedilir; yazı çalışmaya devam eder.
  - Türkiye'ye taşınınca sınır env'den büyütülür.
- **Sunucu kurulumu** (PM eki 4): klasör gerekmez (fotoğraflar veritabanında). Yeni env'ler
  (`MEDIA_MAX_BYTES`, `OPS_EMAIL`) ortak sunucuda değişikliktir. `infra/staging/apply-pending.sh`
  adım 3b bunları compose.yml'e ve .env'e yazar; kuru çalıştırması denendi. Çalıştırmayı sahip
  kendi onayıyla yapar (DURUM, "Senden gerekenler"). O çalışana kadar sunucu kodun varsayılanıyla
  (2 GB, e-posta yerine günlük satırı) çalışır.

### 11. Bildirimler ve istemci seviyesi

**Mühürlü bildirim türleri (PROTOCOL §9 gövdesi):**

| Gövde                                    | Telefonda yazan                            |
| ---------------------------------------- | ------------------------------------------ |
| `{ kind: "chat", circleId?, photo, ts }` | "Ayşe: yeni mesaj" ya da "fotoğraf"        |
| `{ kind: "moment", circleId, ts }`       | "Ayşe bir hikaye paylaştı"                 |
| `{ kind: "shot", ts }`                   | "Ayşe fotoğrafının ekran görüntüsünü aldı" |

- İçerik hiçbir bildirimde yok. Kim olduğunu telefon, bildirim kutusunun imzalı gönderen cihazından
  bilir.
- Bildirimi gönderen telefon mühürler (bugünkü üye bildirimi). Sunucu yalnız uygulaması kapalı
  olana iletir.
- Aynı sohbetten gelenler tek bildirimde toplanır. Uygulamada: bildirimin kimliği sohbettir
  (`chat:<sohbet>`), yenisi eskisinin yerine geçer.
- Sessize alma ayarına bir bayrak eklenir: mesajlar. Uygulamada "Mesajları ve hikayeleri" adıyla
  kişinin bildirim penceresinde; mesaj, hikaye ve ekran görüntüsü haberini susturur. Eski kayıtta
  bayrak yoksa susturulmamış sayılır.
- "Herkesten sil" (`del`) bildirim göndermez.

**İstemci seviyesi 6:**

- `CLIENT_LEVEL` 5'ten 6'ya çıkar.
- Sunucu sohbet uç noktalarını seviye 6'dan eski uygulamaya `426` ile kapatır.
- `chat.*` olaylarını yalnız seviye 6 ve üstüne gönderir.
- Eski uygulama yeni bildirim türlerini tanımaz ve sessizce atar.
- `MIN_CLIENT_LEVEL` 5'te kalır. 6'ya çıkarmak, bütün telefonlar yeni APK'yı kurduktan sonra PM'in
  kararıdır.

### 12. Ekran görüntüsü haberi

- Android 14 ve sonrasında `expo-screen-capture` (kurulu) ekran görüntüsü alındığını söyler.
  Fotoğraf ya da hikaye ekranı açıkken alınırsa telefon gönderene `shot` öğesi ve bildirimi yollar.
- Uygulamada `shot` öğesi yalnız fotoğrafı gönderene, kişisel zarfla gider (çemberin bütün
  üyelerine değil); bildirim gövdesinde bu yüzden çember yoktur. Alan telefon, `shot`ı yalnız kendi
  fotoğrafı içinse uygular; başkasının fotoğrafı için geleni atar.
- Engellenmez: başka bir telefonla çekmek her zaman mümkün; engel sahte güven verir (PM).
- `DETECT_SCREEN_CAPTURE` izni zaten manifestte ve kalmalı. Kaldırmak uygulamayı açılışta
  çökertiyor (2026-10-22, `869a7af`); `release-config.test.ts` bunu korur.
- Daha eski Android'de haber yok. Fotoğraf ekranı bunu söylemez, söz vermez.

### 13. 15–17

- Aynı kurallar. Ebeveyn içeriği göremez (uçtan uca şifreli); ebeveyn görünümüne mesaj ya da
  hikaye bilgisi girmez.
- Bildir ve Engelle her sohbet ve fotoğraf ekranında bir dokunuş uzakta.

### 14. Play ve gizlilik politikası (PM günceller; kod oturumu dokunmaz)

PM'in güncelleyeceği yerler:

- **Gizlilik politikası:** şifreli mesaj ve fotoğraf, 24 saat. Üst veri (kim, kime, ne zaman, boyut
  sınıfı) 24 saat. Bildirilen içeriğin açık hâli 90 gün ya da yasal süre. Engelleme listesi hesap
  silinene kadar.
- **Play veri güvenliği:**
  - "Mesajlar" ve "Fotoğraflar": uçtan uca şifreli, sunucuda 24 saat.
  - Bildirilen içerik: kullanıcının isteğiyle Bargu'ya gider, güvenlik için.
- **Play "Uygulama içeriği":**
  - kullanıcı içeriği beyanı: bildirme, engelleme, topluluk kuralları;
  - çocuk güvenliği standartları beyanı: otenus.com'daki sayfa ve `support@otenus.com`.
- **İzinler:** kamera (zaten var, QR için). Yeni izin yok.
- **Avukata sorulacaklar:**
  - istismar bildiriminde kime ve ne kadar sürede bildirileceği;
  - saklama süreleri;
  - 15–17 için ek yükümlülük.

### 15. Dilimler

Her dilim kendi testleriyle, "başka kullanıcı erişemez" testleri dahil, ayrı commit'ler ve QA:

1. **M0, protokol (packages/crypto):**
   - sohbet zarfı, kişisel zarf, dosya şifreleme;
   - bildirim için öğe anahtarı açığa çıkarma ve doğrulama;
   - yeni etiketler, `protocol-v1` fixture'ına ek, %100 kapsam;
   - değişmezler: her bitin değişmesi reddedilir; zarflar birbirinin yerine geçemez; 24 saat ve
     tekrar kuralı.

   PROTOCOL.md güncellenir. Swift tarafı iOS dilimine kalır (bildirim eklentisi sohbeti açmaz).

2. **M1, sunucu:**
   - tablolar, uç noktalar, canlı olaylar;
   - süpürücü, engelleme, sınırlar, dosya erişimi, disk sınırı ve alarm;
   - bildirim türleri, seviye 6;
   - yedek betiğinin sohbet tablolarını dışarıda bırakması;
   - `apply-pending.sh`'e medya dizini ve env adımı (kuru çalıştırmalı; sahip çalıştırır).
3. **M2, mobil yazı:**
   - sohbet listesi (çemberler ve kişiler, okunmamış sayısı);
   - sohbet ekranı, gönderme ve alma, herkesten silme;
   - 24 saat temizliği, kişiyi unutma;
   - Bildir ve Engelle, bildirimler.

   Giriş: alt çubukta "Mesajlar", kişi kartında "Mesaj", çember ekranında "Sohbet".

4. **M3, fotoğraf ve hikaye:**
   - kamera, küçültme, şifreleme ve yükleme;
   - fotoğraf görüntüleyici;
   - gönderme ekranı: "Hikaye (bütün çemberlerim)", "Çember seç", "Bir kişi" (§1);
   - pinde hikaye halkası;
   - hikayeye yanıt, ekran görüntüsü haberi.
5. **M4:** QA turu, sahibin telefon denemesi, sayfalar ve beyanlar (PM).

## Sonuçlar ve riskler

- Sunucu içeriği göremez ama üst veriyi 24 saat görür: kim kime ne zaman yazdı, yazı kısa mı uzun mu,
  fotoğrafın boyutu.
- Kişisel zarf alıcının uzun ömürlü anahtarına bağlı (ileri gizlilik sınırlı). Bugünkü anahtar
  dağıtımıyla aynı sınır; MLS'e geçiş v2 fikri olarak kalır (BARGU_PLAN §8).
- Bildirme, kullanıcının bilerek açık içeriği vermesine dayanır. Kötüye kullanan biri bildirilmeden
  fark edilmez; bu, uçtan uca şifrelemenin bilinen bedeli.
- Ortak sunucuda dosya diski sınırlı. Türkiye'ye taşınınca sınır büyür (ADR 0034 §6).
- Ekran görüntüsü haberi yalnız Android 14+ ve yalnız bu uygulamanın ekranında çalışır.
- Kapsam büyük: M0–M3 dört dilim, her biri QA ister. Hedef kapalı testin ilk güncellemesi (PM).

## PM'in cevapları (2026-10-27)

1. Okundu bilgisi yok (24 saatlik sohbette baskı yaratır).
2. Staging diski 2 GB (§10).
3. `OPS_EMAIL` support@otenus.com; e-postada içerik, kişi adı ya da e-posta adresi yok (§9).
