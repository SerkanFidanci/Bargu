# 0006. İş kuyruğu ve bildirim altyapısı

- Durum: Kabul edildi
- Tarih: 2026-10-13

## Bağlam

Plan BullMQ (Redis) diyordu. Proje sahibi "bildirim servisini doğru düzgün kurgula; Kafka, RabbitMQ,
Redis, hangisi güncelse" dedi ve kararın en iyisi olduğundan emin olunmasını istedi. İhtiyaçlar:
giriş kodu e-postaları (Faz 2), push dağıtımı (Faz 7), davet süresi (Faz 4), event çemberi kapanışı
(Faz 8), hesap silme (Faz 9, KVKK yükümlülüğü: 7 gün sonra kalıcı silme).

## Seçenekler

| Seçenek                   | Artı                                                                       | Eksi                                                                                          |
| ------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Kafka                     | Saniyede milyonlarca olay                                                  | Ayrı küme, yüksek bellek, ayrı yama/güvenlik yükü; bizim hacmimizde gereksiz                  |
| RabbitMQ                  | Olgun mesaj kuyruğu                                                        | Ayrı servis; ihtiyacımız olanı veritabanı/Redis zaten veriyor                                 |
| BullMQ 6 (Redis)          | Çok hızlı; v6 artık node-redis ile çalışıyor                               | İş ile veritabanı değişikliği ayrı sistemlerde: tutarlılık için ayrıca outbox tablosu gerekir |
| **pg-boss 12 (Postgres)** | İş, veritabanı değişikliğiyle **aynı işlemde** eklenir; yedeklerle korunur | Redis'e göre daha düşük üst hız (bizim için fazlasıyla yeterli)                               |

## Karar

- **pg-boss 12**, Postgres'te ayrı `pgboss` şemasında. "Postgres'i kuyruk olarak kullanmak" bugünün
  yerleşik yaklaşımı (Rails 8'in varsayılanı Solid Queue, Elixir'de Oban, Go'da River); BullMQ'nun
  kendisi de v6'da Postgres desteği ekledi.
  - **Aynı işlemde ekleme** (`fromDrizzle`): "kayıt yazıldı ama iş kayboldu" veya "iş çalıştı ama kayıt
    geri alındı" durumları olamaz. Ayrı bir outbox tablosu ve aktarıcı kodu gerekmez.
  - **Dayanıklılık**: hesap silme gibi yasal yükümlülüğü olan işler veritabanı yedeğiyle korunur;
    Redis geçici veriler (konum, presence, hız sınırı) için kalır.
  - **Gecikme**: LISTEN/NOTIFY ile işçi iş eklendiği an uyanır; yoklama yalnızca yedek.
  - **Verim**: işçi işleri 20'lik gruplar halinde alır ve grup doluysa beklemeden sıradakine geçer;
    her iş ayrı sonuçlanır (biri başarısız olunca diğerleri etkilenmez). Tek tek alıp her işten sonra
    beklemek, yoğun anda kodların gecikmesine yol açıyordu (CI'da yakalandı).
  - Tekrar deneme (üstel bekleme), ölü mektup kuyruğu, saklama süreleri ve zamanlanmış işler hazır.
    Hiçbir zaman açılamayacak bir iş (örn. anahtar değişiminden önce şifrelenmiş) tekrar denenmeden
    doğrudan ölü mektup kuyruğuna gider.
- **Roller**: kuyruk tabloları migration adımında sahip rolle kurulur; API ve işçi yalnızca veri
  okuyup yazabilir. API yalnızca iş ekler; işçi (ayrı container, aynı imaj) işleri çalıştırır ve kuyruk
  bakımını yapar.
- **Hassas iş verisi şifreli**: e-posta işinde adres, sunucu anahtarıyla XChaCha20-Poly1305 kutusunda
  saklanır (`sealAtRest`, amaç etiketiyle); kuyrukta açık metin adres yok. Kod hiç saklanmaz, işçi
  meydan okuma kimliğinden türetir.
- **E-posta teslimi**: tüm mantık bizde (kuyruk, şablon, tekrar deneme, sınırlar); son adım standart
  SMTP ve tek ayar (`SMTP_URL`). Kendi sunucumuzdan doğrudan gönderim şu an mümkün değil: Hetzner 25
  numaralı portu kapatmış (Gmail ve Outlook'a bağlantı zaman aşımı) ve ters DNS adı genel Hetzner
  adı; yeni bir IP'den giden kodlar büyük ihtimalle spam'e düşer, kod gelmezse kullanıcı giriş
  yapamaz. Başta AB'de bir aktarıcı (Scaleway TEM öneriliyor), ileride temiz IP + port 25 olan bir
  sunucuda kendi posta sunucumuz (örn. Stalwart): koda dokunmadan, yalnızca ayarla. Staging,
  gerçek alan adı gelene kadar iç ağdaki Mailpit'i kullanır.
- **Geçici: Gmail üzerinden (staging, 2026-10-14)**: telefondan gerçek kodla girilebilsin diye
  staging bir Gmail hesabının uygulama şifresiyle gönderebilir. Proje sahibi bunu sunucuda kendisi
  açar (`bargu-set-mail`, `infra/staging/set-mail.sh`): şifre gizli yazılır, önce Gmail'e
  giriş ve bir deneme e-postası denenir, ancak başarılıysa geçilir. Gönderim 587 + STARTTLS
  (Hetzner 465 ve 25'i kapatıyor) ve kodda kural: adreste şifre varsa şifreleme zorunlu
  (`mustUpgradeToTls`). Yalnızca işçi dışarı çıkabilir (`egress` ağı). Outlook.com seçilmedi:
  kişisel hesaplarda uygulama şifresi kalktı, yalnızca OAuth (Microsoft uygulama kaydı) çalışıyor.
  Sınırlar ve bedel: günde ~500 alıcı; kodlar ve alıcı adresleri Google'dan geçer; gönderen olarak
  o Gmail adresi görünür (bu yüzden ayrı bir Gmail hesabı öneriliyor). Gerçek alan adı gelince
  aktarıcıya geçilir.
- **Üretim: Google Workspace (PM kararı, 2026-10-23).** Yukarıdaki "AB'de bir aktarıcı" planının
  yerine geçer.
  - Giriş kodları otenus.com'un Google Workspace hesabından gider. Gönderen `no-reply@otenus.com`.
    Gizlilik politikası (otenus.com/bargu/gizlilik) bunu yazıyor.
  - Yol, Google'ın önerdiği SMTP relay: `smtp-relay.gmail.com`, 587, TLS zorunlu. Yalnız
    otenus.com adresleri gönderebilir.
  - Kimlik doğrulama ikisi birden: sunucunun IP'si ve SMTP AUTH (bir Workspace kullanıcısı ve onun
    uygulama şifresi). Aynı IP'deki başka bir uygulama şifresiz gönderemez.
  - Sınır: gönderen kullanıcı başına 24 saatte 10.000 ileti ve 10.000 ayrı alıcı.
  - Yedek yol: uygulama şifresiyle `smtp.gmail.com:587`, günde 2.000 ileti.
  - Kod aynı kalır, değişen yalnız ayar (`SMTP_URL`, `MAIL_FROM`). `.test` hesapları yine Mailpit'e
    gider. `bargu-set-mail` için bir Workspace kipi gerekir: relay adresi, giriş yapan kullanıcı ve
    ayrı gönderen adresi. Üretim yığınıyla birlikte yapılır (ADR 0034 §3).
  - otenus.com'da SPF var. Workspace'te DKIM'in açık olması ve bir DMARC kaydı teslimi güçlendirir.
    `bargu.app` posta göndermez.
- **E-posta içeriği**: yalnızca düz metin; bağlantı, HTML, izleme pikseli yok. Kod konu satırında
  değil (kilit ekranı önizlemesinde görünmesin).
- **Push (Faz 7)**: aynı kuyrukla; WebSocket bağlıysa anında WS, değilse APNs / FCM v1 (aracısız),
  içerik cihaz başına sealed box (Faz 1).

## Sonuçlar

- Yeni altyapı servisi yok (Kafka/RabbitMQ yok); güvenlik yüzeyi küçük kaldı.
- Çok yüksek hacme (saniyede binlerce push) çıkılırsa push dağıtımı Redis tabanlı bir kuyruğa
  taşınabilir; iş tanımları tek modülde (`apps/api/src/jobs`).
- İşçi container'ında HTTP olmadığı için sağlık kontrolü yok; Faz 10'da kuyruk metrikleri ve
  alarmlar (kuyruk derinliği, ölü mektup sayısı) eklenecek.
