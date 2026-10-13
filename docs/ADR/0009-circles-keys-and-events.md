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

## Sonuçlar

- Yeni bağımlılıklar: `socket.io` 4.8.4, `@nestjs/websockets` ve `@nestjs/platform-socket.io` 12.1.3
  (API); `socket.io-client` (testler ve uygulama).
- Çember adı sunucuda düz metin (davet edilen kişi anahtar almadan önce görmeli); kabul edilen
  metadata sızıntısı olarak THREAT_MODEL'e yazıldı.
- Çok sunuculu kurulumda olay yayını ve bağlantı kesme için Redis adaptörü gerekecek (Faz 10).
