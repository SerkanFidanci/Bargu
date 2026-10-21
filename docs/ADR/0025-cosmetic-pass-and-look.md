# 0025. Süs geçiş belgesi ve görünüm mesajı

- Durum: Kabul edildi (PM, 2026-10-16)
- Tarih: 2026-10-16
- İlgili: [ADR 0024 §7](0024-entitlements-and-test-billing.md) (süs hakları),
  [ADR 0014](0014-encrypted-profile-photos.md) (şifreli profil), [PROTOCOL](../PROTOCOL.md)

## Bağlam

Süs paketleri (Faz 9B dilim 3) yalnızca görünüştür, ama satın alınır. Arkadaşın telefonu bir süsü
göstermeden önce gerçekten alındığını doğrulamalıdır; değiştirilmiş bir uygulama bedava süs
gösterememelidir. Bunun yanında Bargu'nun kuralı geçerli: sunucu kişinin ne seçtiğini bilmemeli,
yalnızca hangi paketi aldığını bilir (hakkı o verir).

Bu, Bargu'da yeni bir imza mekanizmasıdır: şimdiye kadar yalnızca cihazlar imzalıyordu; bu kez
sunucu, telefonların doğrulayacağı bir belge imzalar. Bu yüzden ayrı bir ADR.

## Karar

### 1. Geçiş belgesi (cosmetic pass)

- Sunucu, hesabın aldığı süs paketlerini Ed25519 ile imzalı kısa bir belge olarak verir.
- Belgede yalnızca şunlar vardır: sürüm (`v: 1`), anahtar kimliği (`kid`), hesap kimliği,
  paket kimlikleri, veriliş ve bitiş zamanı, imza. Fiyat, satın alma tarihi, e-posta, kaynak
  (`test`, `play`) yoktur.
- İmzalanan baytlar sabit bir düzendedir (JSON değil), etiket `bargu/v1/cosmetic-pass`:
  `0x01 ‖ len(kid) ‖ kid ‖ userId(16) ‖ issuedAt(8, BE, ms) ‖ expiresAt(8, BE, ms) ‖ adet(1) ‖
her paket için len ‖ paket` (paketler sıralı ve tekil, en çok 6; kimlikler en çok 16 karakter).
  Sınır, görünüm mesajının en büyük hâlinin 512 bayta sığması içindir (test eder). Paket sayısı
  artınca telefon yalnızca kullandığı paketler için belge ister.
- Belge 30 gün geçerlidir. Telefon, `plan.changed` olayında ve uygulama açılırken süresinin
  yarısından azı kaldıysa yenisini ister.
- İmza ve doğrulama `packages/crypto`'dadır (`issueCosmeticPass`, `verifyCosmeticPass`).
- Uç: `GET /v1/me/cosmetics/pass`. Yalnızca çağıranın kendi belgesi; başka hesabın belgesi
  istenemez (hesap kimliği parametre değildir). Paketi yoksa `{ pass: null }`.
- Test kaynaklı süs paketleri belgeye yalnızca test satın almanın açık olduğu yerde girer (ADR 0024
  §6, P1b ile aynı kural).

### 2. Anahtarlar

- Sunucu sırrı `ENTITLEMENT_SIGNING_KEY` (32 bayt), kimliği `ENTITLEMENT_SIGNING_KID`. Yoksa
  belge ucu yoktur (404) ve süs gösterilmez.
- Staging ile üretimin anahtarı ayrıdır. Uygulama, derleme profiline göre güvendiği açık
  anahtarların listesini taşır (`EXPO_PUBLIC_COSMETIC_KEYS`, `kid:anahtar` virgülle):
  - preview derlemesi staging anahtarına güvenir;
  - üretim derlemesi yalnızca üretim anahtarına güvenir (üretim anahtarı ileride ayrı üretilir).
    Bu yüzden staging'de test satın almayla alınmış bir süs üretimde hiç görünmez (P1b'nin süs
    karşılığı).
- Birden çok anahtar tanınır: anahtar değiştirilirken eski ve yeni `kid` bir süre birlikte
  güvenilir, sonra eskisi listeden çıkar.
- Sır yalnızca sunucudaki Bargu ortam dosyasında durur; ekrana, loga ya da repoya yazılmaz.

### 3. Görünüm mesajı (`look`)

- Yeni şifreli mesaj türü `look`: seçilen ada deseni, seçilen çıkartma kenarı ve geçiş belgesi.
  Konum ve profil gibi gönderen anahtarıyla her çember için ayrı şifrelenir. Sunucu hangi deseni
  seçtiğini görmez.
- Profilin içine konmadı: en büyük profil mesajı (fotoğraf ve iki anahtar iadesi) 512 baytlık
  dolguyu zaten neredeyse dolduruyor. Ayrı tür, eski uygulamalarda da güvenlidir: tanımadıkları türü
  `MALFORMED` sayıp yok sayarlar (b85ac9d'deki test).
- Her mesaj gibi tam 512 bayta dolgulanır: boyu kaç paket alındığını göstermez.
- Profilin gittiği her durumda gider: yeni üye, yeni epoch, yeni cihaz, güven onayından (TOFU)
  sonra. Aktarıcı her üyenin son görünüm mesajını profil gibi 30 gün tutar (`look:{circleId}`,
  `POST/GET /v1/looks`, canlı bağlantıda `look`).
- Gören telefon şunlara bakar:
  - imza güvendiği bir anahtarla doğru mu, anahtar kimliği biliniyor mu;
  - belge süresi geçmemiş mi;
  - belge, mesajı gönderen hesabın mı;
  - seçilen desen ve kenar belgedeki bir pakete mi ait.
    Biri tutmazsa ya da mesaj hiç gelmezse varsayılan görünüm çıkar; hata gösterilmez.

### 4. Paketler

- "Ada desenleri" (`islands`, ₺29,99): çizgili, puantiyeli, renk geçişli, parıltılı.
- "Çıkartma kenarları" (`edges`, ₺29,99): holografik, altın, neon, kesik çizgi.
- Sezon paketleri, kostümler, efektler ve Bargu+'nın aylık hediye süsü sonraki dilimde.

### 5. Ekran ve çizim

- "Ben > Görünüm": kendi çıkartmanın üstünde önizleme, paket satın alma (test), seçim.
- Hareketli stiller (parıltılı, holografik, neon) Reanimated worklet'leriyle ve hareket
  tokenlarıyla çizilir. Sade modda, sistemin "Hareketi azalt" ayarında ve pil tasarrufunda durur.
- Haritada aynı anda yalnızca birkaç işaretçi hareketlidir (token ile sınırlı); pil davranışı
  geriye gitmez.
- Ad ve yaş yazısı her desende, açık ve koyu temada okunur kalır.

### 6. 15–17

- Süs satın alma da ebeveyn onayıyla (ADR 0024 §5, ürün `cosmetic:<paket>`). Süs istekleri Bargu+
  isteğinden ayrı tutulur; biri ötekini silmez. Ebeveyn ikisini de görür. **Yapıldı: dilim 3c
  (2026-10-21), aşağıdaki son ek.**

## Sonuçlar

- Sunucu hangi paketlerin alındığını bilir (hakkı verdiği için zaten biliyordu); hangi desenin
  seçildiğini bilmez.
- **Kabul edilen risk (PM):** İadeden sonra değiştirilmiş bir uygulama, elindeki en çok 30 günlük
  eski belgeyle süsü göstermeye devam edebilir. Belge süresi bunu sınırlar.
- Anahtarın sızması, sızan anahtarla bedava süs gösterilebilmesi demektir; işlev ya da güvenlik
  açısından bir şey açmaz (süs yalnızca görünüştür). Anahtar değiştirilir, eski `kid` uygulamadan
  çıkar.
- Eski uygulamalar `look` mesajını yok sayar; süsleri görmezler, bozulmazlar.

## Ek (2026-10-21, Faz 9B dilim 3b: süsler haritadaki pinde)

- Durum: Kabul edildi (PM, 2026-10-21; `island`/`edge` → `ring`/`frame` adları da).
- İlgili: [ADR 0008](0008-design-system-and-map.md) (pin ve kendi pinin),
  [ADR 0027](0027-calm-mode-and-motion-budget.md) (sade mod).

**Neden:** Kişiler artık çıkartma ve ada olarak değil, pin olarak çiziliyor (mor halka, kuyruk, konum
noktası). Süsler pinin üstüne taşındı. Geçiş belgesi, görünüm mesajının mantığı, anahtarlar, sunucunun
bilgisi ve 15–17 kuralı değişmedi; yalnızca adlar, çizim ve hareket sınırı değişti.

### Paketler (§4'ün yerine)

- **"Halka desenleri"** (`rings`, ₺29,99): pinin halkasının üstüne çizgili, puantiyeli, renk geçişli,
  parıltılı.
- **"Pin çerçeveleri"** (`frames`, ₺29,99): pinin çevresine holografik, altın, neon, kesik çizgi.
- Ürünler `cosmetic:rings` ve `cosmetic:frames`. Hiçbir paket satılmadığı için göç yok; veritabanı her
  `cosmetic:<paket>` ürününü kabul eder. Belgedeki paket kimlikleri de bunlardır (sıralı: `frames`,
  `rings`).
- Görünüm mesajının alanları `island`/`edge` iken `ring`/`frame` oldu (hiçbir sürüm göndermedi).
  Mesajın şekli, 512 baytlık dolgusu ve en büyük hâlinin testi aynı.

### Nerede çizilir

- Halka deseni pinin kendi halkasının üstüne, çerçeve halkanın dışına (2 px boşluk, 3 px kalınlık)
  çizilir; ikisi de SVG'dir ve dokunmayı, ekran okuyucuyu ve düzeni etkilemez. Ölçüler `cosmeticFx`
  tokenlarındadır.
- Kendi pinin, arkadaşların pinleri ve "Görünüm ve harita"daki önizleme aynı bileşeni kullanır.
- **Ortak pinde** (iki ya da daha çok kişi bir arada, `ClusterBubble`) süs çizilmez: ortak halka
  kimsenin değildir. Ayrılınca herkesin süsü yine görünür. PM onayı: iki kişinin stilini karıştırmak
  karışık durur.
- Eski bir konumda pin gri olur; süs de soluk ve durağan çizilir.
- **Ad ve yaş yazısı** pinin altındaki kendi zeminli hapta durur; süs yalnızca halka ve çerçeveyle
  sınırlıdır ve yazının üstüne gelmez. Her süs için açık ve koyu temada testle denenir.

### Hareket

- Hareketli stiller: **parıltılı** (halka), **holografik** ve **neon** (çerçeve). Reanimated
  worklet'leriyle ve `cosmeticFx` hareket tokenlarıyla çizilir; JS thread'de animasyon yok.
  Worklet'in çağırdığı her işlev `'worklet'` taşır (`worklet-calls.test.ts` kaynağı okuyarak
  denetler).
- Yalnızca sade mod "tam"da hareket eder. "Az" ve "kapalı"da, sistemin "Hareketi azalt" ayarında,
  pil tasarrufunda ve %20'nin altında (şarj olmuyorsa) durur (`useEffects`, ADR 0027 §2). Harita
  görünmüyorsa da çalışmaz. Durağan stiller (çizgili, puantiyeli, renk geçişli, altın, kesik çizgi)
  hiç kare istemez.
- **Aynı anda en çok 3 pin** süsünü oynatır (`cosmeticFx.maxAnimated`); fazlası durağan çizilir.
  Önce kullanıcının kendi pini, sonra ilk isteyenler.
- Ölçüm: `look-frames.test.tsx` ADR 0027'nin kare sayımını süsler için yapar ("tam"da hareketliler
  kare ister; durağanlar ve sade moddakiler 0).

### Ekran, satın alma, yenileme

- "Ben > Görünüm ve harita > Pin süsleri": kendi pininde önizleme, iki paket, her paketten bir stil.
  Alınmamış paketin stili önizlemede denenir; kaydedilmez ve gönderilmez. Satın alınca denenen stil
  seçilir ve çemberlere gider.
- Satın alma, test satın almanın açık olduğu yerde test satın almadır ("TEST — gerçek ödeme yok");
  başka yerde "yakında". 15–17'de düğme "Ebeveynime sor" olur ve yine
  `POST /v1/billing/test/purchase` çağrılır.
- **Bilinen eksik (dilim 3c ile kapandı, aşağıdaki son ek):** sunucu 15–17'nin paket isteğini henüz
  açmıyordu, `403 GUARDIAN_APPROVAL` dönüyordu (ADR 0024: "dilim 3'e kadar reddedilir, istek
  açılmaz"). Uygulama bunu hata saymıyor, "bu paket için ebeveyn onayı gerekiyor" diyordu. Ebeveyn
  tarafı (`guardian_requests`'e `cosmetic:` ürünü, ebeveyn görünümü, onayda satın alma) ayrı bir
  sunucu işiydi: dilim 3c (PM, 2026-10-21; kasma ve C2'den sonra). Abonelik isteği ile süs isteği
  birbirini silmez, ebeveyn ikisini de görür; paket başına tek bekleyen istek; seviye kuralı satın
  alma isteğindeki gibi.
- **Üretim:** üretim derlemesi hiçbir süs anahtarına güvenmez (yalnızca önizleme `stg-1`'e); üretim
  anahtarı ve `kid` Faz 10'da üretilip üretim yapılandırmasına girer (PM, 2026-10-21). O zamana kadar
  üretimde süs görünmez (§2).
- Belge şu durumlarda yenilenir (§1'deki "yarısından azı kaldıysa" koşuluna ek): uygulama
  açılırken, `plan.changed`'de, bağlantı geri gelince, plan belgenin adlandırmadığı bir paket
  gösterince ve satın almadan hemen sonra. Paket satın almak `plan.changed` yollamadığı için son
  ikisi gerekir. Hepsi olaydır; yoklama yok.
- Görünüm, profilin gittiği her durumda gider (§3): çemberin epoch'u, üyeleri ya da okuyabilen
  (güvenilen) telefonları değiştiğinde; yani yeni üye, yeni epoch, yeni cihaz, güven onayından
  (TOFU) sonra. Telefon her çember için en son ne gönderdiğini epoch, seçim, belge ve okuyan
  telefonların parmak izinden bir işaretle tutar.

### Sonuçlar

- Gören telefon hâlâ yalnızca imzası güvendiği anahtarla doğru, süresi geçmemiş, gönderenin kendi
  hesabına ait ve seçilen stili belgedeki bir pakete ait olan görünümü gösterir; yoksa varsayılan
  görünüm çıkar, hata gösterilmez.
- Staging'e yeni şemalar dağıtılana kadar eski sunucu `cosmetic:rings` satın almasını reddeder; bu
  yüzden dağıtım, uygulamanın denenmesinden önce yapılmalıdır.

## Ek (2026-10-21, Faz 9B dilim 3c: 15–17 süs paketi için ebeveynine sorar)

- Durum: Uygulandı (migration 0037; 7 günlük düşmenin olayları ve evet gelince stilin kendiliğinden
  seçilmesi aynı gün PM cevabıyla eklendi, migration 0038). PM kararları 2026-10-21.
- İlgili: [ADR 0024 §5 ve §10](0024-entitlements-and-test-billing.md), [ADR 0023](0023-age-15-plus.md).

**Neden:** §6 süs satın almanın ebeveyn onayıyla olacağını yazıyordu ama sunucu isteği saklamıyordu;
çocuğun düğmesi yalnızca "ebeveyn onayı gerekiyor" diyordu. Artık Bargu+ satın alma isteği gibi çalışır.

### İstek

- `guardian_requests`'e yeni tür `cosmetic`, ürünü `cosmetic:<paket>` (şimdi `cosmetic:rings`,
  `cosmetic:frames`; API yalnızca `COSMETIC_PRODUCTS`'ı kabul eder, veritabanı `entitlements` gibi
  `cosmetic:` ve en çok 16 karakterlik bir kimliği kabul eder, yeni paket için migration gerekmez).
- **Ayrı tür:** abonelik isteği (`purchase`) ile süs isteği birbirini ne siler ne değiştirir. Öbür
  planı istemek yalnızca abonelik isteğini değiştirir; paket isteği olduğu gibi kalır. Ebeveyn ikisini
  de görür.
- **Paket başına tek bekleyen istek** (veritabanında benzersiz dizin). Aynı paketi yeniden istemek
  ikinci istek açmaz ve ebeveyne yeniden haber vermez; öbür paket başka bir istektir. Çocuk başına
  toplam 20 istek sınırı (migration 0027) geçerlidir. İki dokunuş aynı anda gelirse tek istek olur
  (çocuk başına kilit, migration 0033'teki gibi).
- Çocuğun zaten sahip olduğu paket sorulmaz: sunucu planı `200` ile döner, kimseye haber vermez.
- Bağlı ebeveyn yoksa istek saklanmaz: `403 GUARDIAN_LINK_REQUIRED`. Saklanınca çocuk `403
GUARDIAN_APPROVAL` alır (uygulama bunu hata değil "soruldu" sayar). Test satın alma kapalıysa uç
  yoktur (404), istek de açılmaz. "Yeni kişiler için onay" ayarından bağımsız, her zaman sorulur.
- İstekler diğerleri gibi 7 günde düşer; ebeveyn bağı bitince de gider.

### Ebeveynin cevabı

- **Evet:** paket çocuk adına alınır (testte kaynak `test`, Bargu+ onayıyla aynı yol; yalnızca bu
  sunucunun sattığı bir paket). Çocuğun planı (`cosmetics`) ve geçiş belgesi `plan.changed` olayıyla
  yeniden okunur; belge paketi söyler. Çocuk `guardianApproved` haberini alır.
- **Hayır:** istek düşer, çocuğun "bekliyor" durumu `plan.changed` ile temizlenir, `guardianDeclined`
  haberi gider; çocuk yeniden isteyebilir.
- Yetki: yalnızca çocuğun etkin ebeveyni görür ve cevaplar. Başka bir ebeveyn, bir yabancı ya da
  çocuğun kendisi görünümü okuyamaz, isteği cevaplayamaz (404, testli).

### Telde ve cevapta

- **Plan cevabı:** `pendingCosmetics` (bekleyen paketler, `rings` gibi) `pendingPurchase`'ten ayrıdır.
  Ekran onu `plan.changed` olayıyla günceller (yoklama yok). Olay şu durumlarda gider: yeni istek,
  ebeveynin cevabı, 7 günlük düşme (işçi), son ebeveyn bağının bitmesi.
- **7 günlük düşme iki tarafa da olaydır (migration 0038, CLAUDE.md: her durum değişikliği bir
  olay):** `app.expire_guardian_tools()` düşen her isteğin türünü ve çocuğun etkin ebeveynlerini de
  döner. İşçi çocuğa ve ebeveynlere `guardians.changed` yollar (açık ebeveyn görünümü isteği artık
  göstermez); çocuğa ayrıca `plan.changed` yollar, ama yalnızca düşen istek bir Bargu+ ya da süs
  isteğiyse (başka türün planla ilgisi yoktur). Aynı boşluk Bargu+ satın alma isteğinde de vardı ve
  kapandı. İşçi bir ebeveyn bağını bitirirse (isteklerle birlikte gider) çocuğa `plan.changed` gider.
- **Ebeveyn görünümü:** istek `{ kind: 'cosmetic', pack: 'rings' }` olarak gelir (`product` yalnızca
  abonelik içindir). Tanınmayan bir paket kimliği de okunur; uygulama onu genel cümleyle yazar
  ("Yeni bir süs paketi almak istiyor"), fiyatsız.
- **Bildirim:** ebeveyne bir kez `guardianCosmetic` ("Çocuğun bir süs paketi almak istiyor; onayını
  bekliyor"); saatlik üst sınır diğer ebeveyn haberleriyle ortaktır. Eski Android sessizce atar, eski
  iOS uzantısı genel metni gösterir (ADR 0024 §10).
- **Çocuğun ekranı:** "Pin süsleri"nde paketin düğmesi "Ebeveynime sor" iken soruldu mu "Onay bekliyor"
  rozeti ve "Ebeveyninin onayı bekleniyor" yazısı çıkar, düğme gider. Hayır gelince düğme geri gelir.
- **Evet gelince (PM, 2026-10-21):** paket "Sende" olur, küçük bir bildirim çıkar ("Ebeveynin
  onayladı: Pin çerçeveleri") ve çocuğun beklerken denediği stil kendiliğinden seçilir ve çemberlere
  gider (onun seçimiydi). Bu bir ekranın işi değildir: telefon planı önbelleğinde "bekleyen paket artık
  sahip olunan paket" geçişini görür (`look-approval.ts`, `plan.changed` ile yenilenen plan; durum
  güncellemesi bir etki (effect) içinde değil, olay yolundadır). Denenen stil bu yüzden ekrandan
  ayrı bir depoda durur (`look-trying.ts`); ekran kapansa da evet gelince orada bulunur. Aynı
  telefonda paket bekleyen değilse (yetişkinin satın alması) bu yol çalışmaz, satın alma kendi
  akışıyla seçer. Hayır gelince denenen stil denemede kalır; çocuk yeniden isteyebilir.

### Uyumluluk: istemci seviyesi 4

- `CLIENT_LEVEL` 3'ten 4'e çıktı (`CLIENT_LEVEL_FOR.cosmeticRequests`). Sunucu süs isteğini seviye
  4'ten eski uygulamaya ebeveyn görünümünde ve ayar cevabında göndermez. Seviye 2 ve 3 uygulamalar
  tanımadıkları türü zaten atlar (dilim 2c'den beri esnek liste); yani eski bir ebeveyn uygulaması
  bozulmaz ve göremez. Süs isteği ancak ebeveyn uygulamayı güncelleyince görünür; istek 7 gün bekler.
- `MIN_CLIENT_LEVEL` değişmedi; yükseltme kararı PM'indir (ADR 0024 §10).
