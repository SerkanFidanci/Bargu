# 0009. Çemberler, davetler, anahtar dağıtımı ve canlı olaylar

- Durum: Kabul edildi
- Tarih: 2026-10-14

## Bağlam

Faz 4: çemberler (1:1 arkadaşlık = `pair` çember), davet (kullanıcı adı, QR, link), kabul/ret,
ayrılma, çıkarma, sender key dağıtımı ve epoch yönetimi, güvenlik numarası ve anahtar değişim
uyarısı. DoD: çıkarılan üye yeni epoch'u çözemez, davet linki tekrar kullanılamaz, yetkisiz kullanıcı
çember verisine erişemez. CLAUDE.md: yenileme/yoklama yok, her durum değişikliği WS olayı.

## Karar

### Canlı olay kanalı Faz 4'e alındı

Plan WebSocket'i Faz 5'e koyuyordu, ama Faz 4'ün kendisi durum değişikliği üretiyor (davet geldi,
kabul edildi, biri çıkarıldı, yeni epoch). Kanal olmadan ekranlar ancak uygulama yeniden açılınca
güncellenirdi; bu CLAUDE.md'ye aykırı. Bu yüzden olay altyapısı şimdi kuruldu, Faz 5 konum aktarımını
üzerine ekler:

- **Socket.io 4.8**, yalnızca WebSocket taşıması (sticky session gerekmez), yol `/v1/events`.
- **El sıkışma = imzalı istek**: erişim token'ı + cihaz ve oturumun hâlâ geçerli olması + cihaz
  anahtarıyla `GET /v1/events` imzası, tek kullanımlık nonce ile (HTTP ile aynı kod).
- **Kullanıcı başına olay akışı** (Redis Stream `ev:{userId}`, 24 saat / 500 olay). Telefon son olay
  kimliğini saklar, bağlanınca `resume` ile kaçırdıklarını sırasıyla alır; boşluk olabilecekse
  `snapshot: true` döner ve telefon durumunu bir kez yeniden yükler.
- **Olaylar küçük**: `circle.changed {circleId, epoch}`, `circle.gone {circleId}`,
  `keys.available {circleId, epoch}`. Kişisel veri, isim veya anahtar taşımaz; telefon gerekirse o
  çemberi bir kez çeker (olaya bağlı, yoklama değil).
- Çıkış yapan ya da yerine yenisi gelen cihazın canlı bağlantısı sunucu tarafından kesilir.
- Redis adaptörü (birden çok sunucu) ve msgpack Faz 10 ölçeklemesinde; şimdilik tek sunucu.

### Veri modeli ve yetki

- Tablolar: `circles` (tür, ad, epoch), `circle_members` (rol, durum), `invites` (yalnızca token
  özeti), `key_envelopes` (imzalı dağıtımlar). Hepsinde zorlanmış RLS.
- Kullanıcılar arası her adım dar `SECURITY DEFINER` fonksiyonlardan geçer: üye kartları (profil +
  aktif cihazın açık anahtar paketi, e-posta özeti asla), davet kullanma, kullanıcı adıyla davet ve
  arkadaşlık isteği, davet önizlemesi, eski dağıtımları temizleme.
- **Çembere kendini eklemenin tek yolu** geçerli bir davet (fonksiyon içinde, tek atomik ifade).
  Doğrudan ekleme yalnızca kurucunun boş çembere kendini sahip olarak eklemesi.
- **Durum geçişleri tetikleyiciyle zorunlu**: davet → aktif/ret (yalnızca kendin), aktif → ayrıldı
  (kendin), → çıkarıldı (yalnızca sahip). Çıkarılan üye kendi satırını değiştirip geri dönemez.
- Çember başına en fazla 50 kişi (davetliler dahil), veritabanında zorunlu.
- Grup sahibi ayrılırken sahiplik en eski aktif üyeye geçer.
- Arkadaşlık: iki kişi arasında tek `pair` çember; iki taraf da aktif olmadıkça görünmez.

### Davetler

- Token 256 bit, yalnızca link/QR'da; veritabanında SHA-256 özeti. Link: `bargu://i/<token>`
  (gerçek alan adı gelince universal link).
- 24 saat geçerli, tek kullanımlık; iki kişi aynı anda denese de yalnızca biri girer (testle kanıtlı).
- Önizleme ve kabul token'ı gövdede taşır (URL'ler loglara düşer).
- Arkadaş QR'ı ("beni ekle") kabul edilince iki taraf da aynı anda aktif olur (QR'ı göstermek rıza).

### Anahtar dağıtımı ve epoch

- Her üyelik değişikliğinde (katılma, ayrılma, çıkarma) ve bir üye yeni cihazla girdiğinde çember
  yeni epoch'a geçer; 24 saat dolunca herhangi bir aktif üye yeni epoch isteyebilir.
- Telefon her epoch için kendi sender key'ini üretir ve diğer aktif üyelerin aktif cihazlarına sarar.
  Sunucu her dağıtımın gönderen cihaz tarafından imzalandığını, güncel epoch için olduğunu ve
  alıcının aktif üye olduğunu doğrular; içeriği okuyamaz. Çıkarılan üyeye dağıtım kabul edilmez.
- Sunucu güncel ve önceki iki epoch'un dağıtımlarını tutar (protokolün epoch tabanı), gerisini siler.

### Güvenlik numarası

- Hesap aynı (5200 tur SHA-256), ama artık kısa dilimlerde, her dilim arasında bir kare beklenerek
  (`safetyNumberAsync`): ekran donmaz. Yerel modüle taşımak gerekmedi.

### Güvenlik incelemesinden sonra (yayından önce)

Bağımsız bir inceleme sunucu tarafında bir yüksek, iki orta ve altı düşük bulgu çıkardı; hepsi
yayından önce kapatıldı ve her biri testle korunuyor:

- **Arkadaşlık iki taraf için biter.** Biri ayrılır ya da isteği reddederse diğer tarafın satırı da
  kapanır. Yeniden istek her zaman karşı tarafın yeni onayını ister (önceki "evet" taşınmaz);
  karşılıklı istek ise kabul sayılır. Arkadaşlık bittikten önce üretilmiş arkadaş QR'ı/linki geçersiz.
- **Veritabanı seviyesinde sahte çember yok.** `pair` çember yalnızca istek veya QR fonksiyonuyla
  doğar; yeni çember epoch 1'den başlar; epoch yalnızca `app.start_epoch` ile ve birer birer artar
  (aktif üye şartı). Yardımcı fonksiyonlar, üyesi olmadığın çember hakkında bilgi vermez.
- **Davetli, kabul etmeden** yalnızca kendisini ve daveti göndereni görür (diğer üyeler gizli).
- **Roller:** her aktif üye davet edebilir; çıkarma yalnızca sahipte ve sahip çıkarılamaz. Geri
  dönen eski sahip üye olarak döner. Sahip ayrılınca en eski aktif üye sahip olur; aktif kimse
  kalmazsa açık davetler geri çekilir.
- **50 kişi sınırı** eşzamanlı katılımlarda da aşılmaz (çember başına işlem kilidi).
- **Yeni epoch:** yeni cihazla giriş, çıkış ve çalınma şüphesiyle iptal edilen oturumda. Aynı
  telefonun yeniden girişinde değil (gereksiz anahtar trafiği yok).
- **Canlı bağlantı** erişim anahtarı kadar yaşar (10 dk); telefon kendiliğinden yeni anahtarla
  bağlanır ve kaçırdığını alır. Telefon başına tek bağlantı; bağlantı başına sınırlı `resume`;
  çalınma şüphesinde (aynı yenileme anahtarı iki kez) bağlantı hemen kapanır.
- `resume` cevabı artık bir **imleç** (`cursor`) taşır: tam yeniden yüklemeden sonra telefon en
  son olaydan devam eder, her bağlantıda yeniden yükleme yapmaz.

### Telefonda

- Anahtarlar, bilinen kimlik anahtarları ve son olay kimliği **şifreli MMKV kasasında** (AES-256,
  anahtarı Keychain/Keystore'da, yalnızca bu cihaz). MMKV'nin şifrelemesi bütünlük doğrulaması
  yapmaz; kasayı değiştirebilen biri zaten telefonun kilidini açmış biridir (tehdit modeli dışında).
  Çıkışta kasa ve anahtarı silinir.
- Kimlik anahtarları ilk görüşte güvenilir sayılır (TOFU). Değişirse o kişiye anahtar gönderilmez ve
  ondan anahtar kabul edilmez; kullanıcı uyarıyı onaylayana ya da güvenlik numarasını QR ile
  doğrulayana kadar.

## Sonuçlar

- Yeni bağımlılıklar: `socket.io` 4.8.4, `@nestjs/websockets` ve `@nestjs/platform-socket.io` 12.1.3
  (API); `socket.io-client` (testler ve uygulama).
- Çember adı sunucuda düz metin (davet edilen kişi anahtar almadan önce görmeli); kabul edilen
  metadata sızıntısı olarak THREAT_MODEL'e yazıldı.
- Çok sunuculu kurulumda olay yayını ve bağlantı kesme için Redis adaptörü gerekecek (Faz 10).

## Ek (2026-10-15, Faz 9, QA B1, B2)

- Telefon, cevabı 15 saniyede gelmeyen bir isteği yalnızca iki kez göndermek güvenliyse yeniden
  gönderir: okumalar, davet ve kod kabulü, geçmiş silme. Çember oluşturma gibi istekler bir kez
  gider, çünkü ilki ulaşmış olabilir (B1: iki çember oluşuyordu).
- Kabul tekrarlanabilir (migration 0016): aynı kişi, hâlâ içerideyken aynı kodla ya da aynı davetle
  yeniden kabul ederse aynı çember döner. Yeni epoch başlamaz, kimseye bildirim gitmez (B2). Ayrılıp
  aynı kodla dönmek yine olmaz (ADR 0020).
- Oturum yenileme isteği de bir kez gider (QA dilim 2 N5, bilgi): zayıf ağda bir yenileme zaman
  aşımına uğrayabilir, ama oturum düşmez; oturumu yalnızca sunucunun kesin reddi bitirir ve bir
  sonraki istek yeniden yeniler.

## Ek (2026-10-16, Faz 9 dilim 6b, QA dilim 1 B4, B5)

- Bildirimden açılan bir çember listede yoksa telefon onu sunucuya sorar. "Çember bulunamadı" ancak
  sunucu öyle derse çıkar. Cevap gelmezse (çevrimdışı) ekran "Bağlantı yok" der ve bağlantı gelince
  kendiliğinden yeniden sorar (B4).
- Profil fotoğrafı gibi büyük yüklemeler 15 saniye değil 60 saniye bekler: zayıf ağda baytların
  gitmesi zaman alır, bu ölü bir bağlantı değildir (B5). Yükleme yine yalnızca bir kez gider.

## Ek (2026-10-16, proje sahibinin telefon denemesi: anahtar değişikliği)

- Bir kişinin yeni anahtarı kabul edilince ya da güvenlik numarasıyla doğrulanınca, onunla paylaşılan
  **bütün** çemberler sunucudan yeniden alınır ve anahtarlar dağıtılır. Önceden yalnızca işlemin
  yapıldığı çember yenileniyordu. Güven kişiye bağlı olduğu için öbür çemberler "Anahtar değişti"
  diye kalıyor ve o kişiye anahtar verilmiyordu. Staging'de görüldü: şirket telefonu anahtarını
  aile çemberinde Seko'nun yeni cihazına göndermiş, ikili ve arkadaş çemberlerinde göndermemişti.
- Güvenlik numarası ekranı açılınca o çemberi sunucudan yeniden alır: numara telefonda kalmış eski
  bir anahtarla hesaplanmaz. Taranan kod tutmazsa anahtarlar bir kez daha alınır ve kod yeniden
  denenir. Yine tutmazsa ekran nedenini söyler:
  - kod bir güvenlik kodu değil;
  - sunucunun o kişi için verdiği anahtar onun telefonundakinden farklı (aranızda biri olabilir);
  - onun telefonu senin anahtarını farklı görüyor (henüz güncellenmemiş olabilir);
  - kod başka iki kişi arasında;
  - sunucuya ulaşılamadı.

  Kodun iki yarısı iki kişinin parmak izidir; hangisinin tuttuğuna bakılır
  (`checkSafetyNumberQr`, `packages/crypto`). Yarıların sırası önemli değildir. Sunucuya
  ulaşılamazsa ya da kişinin o an cihazı yoksa ekran "Kontrol edilemedi" der ve doğrulayana kadar
  konum paylaşmamayı önerir (QA 18). Bir saldırgan ağı keserek "aranızda biri olabilir" uyarısını
  bu daha yumuşak metne çevirebilir; doğrulama yine de olmaz.

- İlk kez görülen bir üyenin anahtarı ilk görüşte güvenilir sayılır (TOFU, yukarıda) ve anahtar
  ona kendiliğinden gider; değişen bir anahtar ise kabul edilene ya da doğrulanana kadar bekler.

## Ek (2026-10-22, zengin davet kartı: davet sayfası ve Android App Links)

`bargu://i/<token>` bir mesajlaşma uygulamasında önizleme vermez, uygulaması olmayan kişi bir şey
görmez. Bu ekle davet bağlantıları HTTPS olarak da açılır: `https://<davet sunucusu>/i/<token>`
(arkadaş, çember, etkinlik) ve `/g/<token>` (ebeveyn isteği). Token'ın kendisi, 24 saat ve tek
kullanım kuralları yukarıdaki gibi kalır.

### Davet sayfası

- API'de iki herkese açık adres: `GET /i/:token` ve `GET /g/:token` (giriş yok, `/hesap` gibi bir web
  yolu). Kod: `apps/api/src/invite-page/`.
- Open Graph ve Twitter etiketleri: başlık "Bargu'ya davet", genel bir açıklama ve **tek bir genel
  görsel** (`GET /invite/card.png`, 1200×630, uygulama simgesindeki konum işareti; çizen betik
  `scripts/build-invite-card.mjs`, yeni bağımlılık yok). Dil tarayıcının `Accept-Language` sırasına
  göre Türkçe (varsayılan) ya da İngilizce.
- Gövde: "Uygulamada aç" bağlantısı ve "Bargu yakında Google Play'de". **APK bağlantısı yok**: davet
  bağlantıları elden ele gider, bir test APK'sı sayfadan dağıtılmaz.
- "Uygulamada aç" bağlantısı sayfanın kendi adresine gider (boş `href`). Sayfa token'ı yazmaz,
  yansıtmaz; aşağıdaki "aynı bayt" kuralı bunu gerektirir.

### Kişisel veri yok

Sayfada ve görselde ad, fotoğraf, çember adı (kişisel olabilir), üye sayısı, avatar ve davet eden
yoktur; hiçbiri sayfaya hiç ulaşmaz, çünkü sayfa veritabanına bakmaz. Gerçek bir davet için (adı,
fotoğrafı ve çember adı olan hesap) HTML, başlıklar ve görsel testte bu değerlerin hiçbirini
taşımadığı doğrulanır.

### Token'lar ayırt edilemez

Geçerli, hiç var olmamış, süresi dolmuş, kullanılmış ve geri çekilmiş token için durum kodu,
başlıklar ve gövde **bayt bayt aynıdır**. Sunucu token'a bakmaz: sayfa yalnızca sunucu adından, bir
kez, başlangıçta üretilir ve veritabanına tek sorgu gitmez (testte havuza sorgu ya da bağlantı
gelmediği gösterilir). Bu yüzden süre de aynıdır; hız sınırı için Redis çağrısı her token'da aynen
vardır. Önizleme isteği (mesajlaşma uygulamasının sunucusu) tek kullanımlık bir daveti tüketmez.

Sayfa yalnızca "token biçiminde (43 karakter, base64url) bir dize istendi" bilgisini verir; biçim
zaten herkese açıktır. Başka biçim düz 404'tür (API'nin JSON hatası). Hata yanıtları (404, 429)
sayfa başlıklarını taşımaz, sayfa gibi önbelleğe alınamaz: sayfanın başlıkları yalnızca başarılı
yanıta eklenir.

### Başlıklar ve hız sınırı

- `noindex` (`<meta name="robots">` ve `X-Robots-Tag: noindex, nofollow`); önizleme sunucuları
  etiketleri yine okur.
- Katı CSP: `default-src 'none'`; tek izin sayfanın kendi satır içi stil sayfası, **özetiyle**
  (`style-src 'sha256-…'`). Betik, yazı tipi, resim, çerçeve, form ve `<base>` yok; üçüncü taraf yok.
- `Referrer-Policy: no-referrer` (adres bir sır taşır), `Vary: Accept-Language`, kısa önbellek
  (`public, max-age=300`; görsel bir gün).
- Ağ başına (IPv4 ya da IPv6 /64, anahtarlı takma ad) saatte 300 istek; aşılırsa 429, token ne
  olursa olsun aynı. Cömert, çünkü mesajlaşma uygulamalarının önizleme sunucuları çok kişinin
  bağlantısını birkaç adresten çeker; sıkıştığında bakılacak ilk ayar budur. Görsel sınıra girmez
  (sabit baytlar).

### Android App Links

- `app.config.ts`: davet sunucusu verilmişse `https://<sunucu>/i/*` ve `/g/*` için `autoVerify`
  niyet filtresi eklenir. Sunucu yapılandırmadan gelir (`EXPO_PUBLIC_INVITE_HOST`); biçimi yanlışsa
  derleme durur.
- API `/.well-known/assetlinks.json` sunar: paket adı (`ANDROID_PACKAGE`) ve uygulamanın imza
  sertifikasının SHA-256 parmak izi ya da izleri (`ANDROID_CERT_SHA256`, virgülle). Parmak izi
  **açık bilgidir** (her APK sertifikasını taşır). Ortam başına ayarlanır; Play'in imza anahtarı
  Faz 10'da eklenir.
- Preview ve yerel test build'lerinin imza parmak izi (`apksigner verify --print-certs`, EAS ve
  `scripts/build-android-local.sh` aynı anahtarla imzalar):
  `BC:B3:1B:94:9A:2D:4F:86:2E:BD:41:5C:6E:C4:28:C5:16:3D:A7:76:F1:4B:49:E1:40:A3:CE:AD:57:FB:84:42`.
- iOS'ta `apple-app-site-association` zaten `/i/*` diyordu; `/g/*` eklendi (iOS derlenemiyor, sonra
  denenecek).
- Android doğrulaması bitene kadar (ya da kullanıcı "desteklenen bağlantıları aç" ayarını kapatmışsa)
  bağlantı tarayıcıda, bu sayfada açılır. Bilinen sınır: Chrome, bir siteden aynı siteye giden
  bağlantıyı uygulamaya devretmeyebilir; sayfadaki "Uygulamada aç" bağlantısı bu durumda bir şey
  yapmayabilir. Asıl yol, bağlantıya mesajlaşma uygulamasından dokunmaktır. Gerekirse sayfaya,
  adresi yalnızca adres çubuğundan okuyan ve özetiyle izinli küçük bir betik eklenebilir (HTML
  baytları yine aynı kalır).

### Yapılandırılabilir sunucu

- Sunucu: `INVITE_HOST` (yalın bir DNS adı; şema, port, yol, büyük harf yok). Boşsa staging API'nin
  kendi sunucusu. `APP_ENV=production`'da **zorunlu**: production'ın bağlantıları ve görseli
  staging'e bakmasın. Görselin mutlak adresi bu değerden kurulur, `Host` başlığından değil (önbellek
  zehirlenmesi olmasın).
- Uygulama: `EXPO_PUBLIC_INVITE_HOST`, `eas.json`'da development ve preview için staging sunucusu,
  production'da yok. İkisi aynı sunucuya ayarlı olmalıdır; niyet filtresi manifestte olduğu için
  değişikliğin yeni bir build'e ihtiyacı vardır.
- Kalıcı alan adı (K12) gelince bu iki değer değişir (passkey ayarları `WEBAUTHN_*` ayrıca); sayfa,
  `assetlinks.json` ve süzgeç kodu aynı kalır.

### Uygulamadaki süzgeç (`+native-intent`)

`features/links/incoming-link.ts` dışarıdan gelen her bağlantıyı yönlendiriciden önce süzer. https
bağlantısı **yalnızca** `https://<bu build'in davet sunucusu>/i/<token>` ya da `/g/<token>` ise
geçer ve `bargu://` ile aynı ekranlara gider (token yine 43 karakterlik biçimle doğrulanır); geri
kalan her şey ana ekrana düşer:

- sunucu adı bütün olarak karşılaştırılır: başka sunucu, benzer sunucu (önek, sonek, alt alan adı,
  üst alan adı, sondaki nokta), kullanıcı bilgisi (`@`; iki yanı da), port (443 dahil), IP, http;
- `%` kodlama, sorgu, parça, ters eğik çizgi, boşluk ve sondaki eğik çizgi (sayfanın kendisi orada
  404 verir), fazladan, eksik ya da `..` yol parçaları;
- Unicode benzerleri (Kiril harfi, tam genişlikte nokta ve eğik çizgi, görünmez karakter) ve büyük
  küçük harf çevrimi: yalnızca A–Z çevrilir (Kelvin işareti ASCII k'ya dönmesin).

Davet sunucusu olmayan build'de (production, şimdilik) hiçbir https bağlantısı geçmez.

### Bu adımın dışında kalan

- Paylaşılan bağlantı ve QR hâlâ `bargu://i/<token>`: `Invite.link` ve `guardianLink` değişmedi.
  Kartın bir mesajlaşma uygulamasında görünmesi için paylaşım metni https bağlantısını taşımalı;
  bu QR'ın içeriğini, uygulamadaki tarayıcıyı ve eski uygulamaları etkiler, ayrı bir karardır.
- `ANDROID_CERT_SHA256` hâlâ Play Integrity denetiminin de sertifika listesidir; preview
  sertifikasını eklemek staging'de (`DEVICE_ATTESTATION=optional`) bir şey bozmaz.
