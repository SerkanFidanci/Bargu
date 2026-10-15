# 0022. Hesap silme, veri dışa aktarma, KVKK aydınlatma ve rıza, yayın sayfaları

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

BARGU_PLAN Faz 9 dilim 4. Bu dilimde istenenler:

- Google Play: hesap açtıran uygulama, uygulama içinde ve web'den hesap silme yolu sunmak zorunda
  (KONTROL-LISTESI K7). Gizlilik politikası ve silme sayfası herkese açık bir adreste olmalı (K13).
  Konum izninden önce belirgin bir açıklama gösterilmeli (K10). Android 13+ bildirim izni bağlamda
  istenmeli (K11).
- KVKK araştırması (`docs/arastirma/yas-siniri-ve-kvkk.md`):
  - Ana akışın hukuki dayanağı "sözleşmenin ifası"dır. İsteğe bağlı işlemler için ayrı açık rıza
    gerekir.
  - Aydınlatma metni işlemeden önce verilir ve "okudum, anladım" ile geçilir.
  - Rıza metni ile aydınlatma metni ayrıdır; birleşik "okudum, kabul ediyorum" kutusu olmaz
    (Kurul ilke kararı 2026/347).
  - KVKK md. 11 ilgili kişi hakları (bilgi isteme, silme) için veri dışa aktarma da istendi.

Proje sahibinin kararları (PM üzerinden, 2026-10-15): silmede geri alma yok; sahip olunan
çemberler "ayrılma" kuralıyla devredilir; açık rıza yalnızca konum geçmişi için; profil fotoğrafı
sözleşme kapsamında.

## Karar

### Hesap silme

- **Yollar:** uygulamada "Ben → Gizlilik ve hesap → Hesabımı sil" (`POST /v1/me/delete`). Uygulamaya
  erişemeyen için `/hesap` web sayfası; aynı e-posta kodu ve oturumla, "Telefonumu çıkar"ın
  yanında "Hesabımı sil" (`POST /v1/web/delete-account`). İkisi de son bir onay ister ve geri
  alınamaz.
- **Anında devre dışı (istek içinde, tek seferde):**
  - Hesap silinmek üzere işaretlenir (`users.deleted_at`). Aynı e-postayla giriş "Bu hesap
    kullanılamıyor" alır. Kullanıcı adı başkasına verilmez; kalıcı silmeyle serbest kalır.
  - Bütün cihazlar, oturumlar ve bildirim kayıtları kapanır; telefon bir sonraki isteğinde kendini
    siler.
  - Kişi bütün çemberlerinden çıkar, davetlerini reddeder. Kurallar ayrılmanın aynısıdır:
    - Grupta ve etkinlikte, başka yönetici yoksa en eski üye yönetici olur. Çemberde kimse
      kalmazsa açık davetler geri çekilir ve çember sonra silinir.
    - Arkadaşlıklar iki taraf için biter.
    - Kalanların çemberi yeni anahtar dönemine geçer, haritalarından kişinin noktası hemen kalkar.

    Gerekçe: bir üyenin silmesi bir ailenin ya da etkinliğin çemberini yok etmemeli. Ayrılan biri
    için zaten bu kurallar var ve test edildi.
- **Kalıcı silme (işçi, birkaç dakika içinde, en geç 7 gün):**
  - Kullanıcının satırı silinir; ona bağlı her şey veritabanı tarafından birlikte silinir:
    cihazlar, oturumlar, geçiş anahtarları, güvenlik olayları, üyelikler, anahtar zarfları,
    davetleri, şifreli profil fotoğrafı, oyları ve belgeleri, konum geçmişi parçaları.
  - Sonra Redis'te kullanıcı kimliğini taşıyan anahtarlar (hız sınırları, olay akışı) ve kuyruktaki
    bekleyen bildirimleri silinir.
  - Silme isteği `app.account_deletions` tablosunda dayanıklı tutulur; işçi yarıda kalsa bir
    sonraki tur tamamlar. Etkinlik temizliğindeki (ADR 0017) yöntemin aynısıdır.
  - Neden hemen değil de işçide: istek hızlı ve tekrarlanabilir kalsın, dış izlerin (Redis, kuyruk)
    temizliği yeniden denenebilsin.
- **Kalanlar:**
  - Çembere eklenmiş yerler (ev, okul) çemberindir ve şifrelidir. Sunucu onları kimin eklediğini
    bilmez, bu yüzden çemberde kalır. Kullanıcı silmeden önce kendisi silebilir; bu durum uygulamada
    ve politikada yazılı.
  - Sunucu kayıtlarında (log) kişisel veri yok.
  - Staging'de yedek yok. Üretim yedekleri (WAL-G, Faz 10) en geç 30 günde döner; politika bunu
    söyler.

### Veri dışa aktarma

- **Yol:** "Ben → Gizlilik ve hesap → Verilerimi indir". Tek bir JSON dosyası
  (`bargu-verilerim-YYYY-AA-GG.json`, `format: "bargu-export"`, `version: 1`) kullanıcının
  seçtiği klasöre kaydedilir (Android klasör seçici, iOS belge seçici). Başka bir uygulama araya
  girmez.
- **Sunucudan** (`GET /v1/me/export`, saatte 5): hesap (kullanıcı adı, görünen ad, avatar, açılış
  tarihi), cihazlar (tür, tarihler, kapanma nedeni), üyelikler (çember, tür, ad, rol, durum,
  katılma tarihi), güvenlik olayları, geçiş anahtarı sayısı, bildirim kaydı olup olmadığı,
  aydınlatma ve rıza kayıtları. Şifreli kopyalar ham olarak verilmez; işe yaramazlar.
- **Telefondan, çözülerek:**
  - kendi konum geçmişi (son 14 gün, telefonda tutulan iz);
  - çemberlerindeki yerler;
  - etkinlik belgeleri;
  - paylaşım seçimleri, susturmalar ve durum mesajı.
- **Konu dışı:** başkalarının konumu ve geçmişi kişinin kendi verisi değildir, dosyaya girmez.
- **Yeni bağımlılık:** **expo-file-system 57.0.7** (Expo'nun resmî paketi, SDK 57 hattında,
  bakımı Expo ekibinde; `npx expo install` ile, tedarik zinciri kontrolünden geçti). Ağa
  çıkmaz; yalnızca kullanıcının seçtiği klasöre dosya yazar.
- **Eklenmeyen:** expo-sharing. Kurulumda deponun tedarik zinciri politikası `expo-sharing@57.0.23`
  için "yüksek riskli güven düşüşü (olası paket ele geçirme)" uyarısı verdi; atlatılmadı. Paylaşım
  ekranı yerine klasör seçici kullanılır. Expo yeni bir sürümü kanıtlı yayımlarsa yeniden bakılır.

### KVKK: aydınlatma ve açık rıza

- **Aydınlatma (sözleşmenin ifası):** giriş ekranından önce kısa bir "Gizlilik ve aydınlatma"
  ekranı gösterilir. Ekranda verinin ne olduğu, neden işlendiği, sunucunun konumu göremediği ve
  haklar yazar; tam metin `/gizlilik`'tedir. Tek düğme "Okudum, anladım"dır, "kabul ediyorum"
  değil. Giriş yapınca bu kayıt sürümüyle sunucuya yazılır. Mevcut kullanıcılara güncellemeden sonra
  bir kez gösterilir. Metin değişip sürüm artarsa yeniden gösterilir.
- **Açık rıza (yalnızca konum geçmişi):**
  - Bir çemberde geçmiş ilk kez açılırken ayrı bir rıza ekranı çıkar: amaç, kimlerin göreceği,
    süre (14 gün) ve geri çekme yolu. Düğmeler "Açık rıza veriyorum" ve "Vazgeç"; önceden işaretli
    kutu yoktur. Rıza metni aydınlatmadan ayrıdır.
  - Rıza sürüm ve zamanıyla sunucuda tutulur (`app.consents`).
  - Sunucu, geçerli rızası olmayan kullanıcının geçmiş parçasını kabul etmez (403
    `CONSENT_REQUIRED`). Rıza yalnızca telefonun sözüne dayanmaz.
  - "Rızamı geri çek": bütün çemberlerde geçmiş kapanır, sunucudaki kopya silinir, rıza kaydına
    geri çekme zamanı yazılır.
  - Geçmişi açık olan mevcut kullanıcılara güncellemeden sonra bir kez sorulur; vermezlerse geçmiş
    kapanır ve silinir.
- **Rıza gerekmeyenler:** canlı konum paylaşımı (ana hizmet), profil fotoğrafı (kullanıcının kendi
  yüklediği içerik), bildirimler (sistem izni). Analitik, reklam ya da üçüncü tarafa veri yok; o
  yüzden başka rıza kutusu da yok.

### İzinler (K10, K11)

- **Konum:** Sistem izin penceresi artık kendiliğinden açılmaz. Önce haritada belirgin bir
  açıklama gösterilir: konumun çemberlerle paylaşıldığı, paylaşım açıkken uygulama kapalı ya da
  ekran kilitliyken de sürdüğü, bu sırada "Konumun paylaşılıyor" bildiriminin durduğu, şifrelendiği,
  nasıl durdurulacağı ve reklam için kullanılmadığı. Düğmeler "Devam et" ve "Şimdi değil". Sistem
  penceresi yalnızca "Devam et"ten sonra açılır.
- **Bildirim:** girişten hemen sonra sorulmaz. Kişinin konumunu paylaştığı en az bir arkadaşı ya da
  çemberi olunca haritada bir kart sorar ("Arkadaşın vardığında ve seni dürttüğünde haber al").
  "Şimdi değil" kartı 7 gün gizler. Reddedilirse uygulama bildirimsiz çalışır; ayarlardan açma
  yolu "Ben" ekranında durur.

### Yayın sayfaları (K13)

- API geçici alan adında iki sayfa sunar:
  - `/gizlilik`: gizlilik politikası ve KVKK aydınlatma metni, Türkçe ve İngilizce.
  - `/hesap`: telefonu çıkarma ve hesap silme.
- Sayfalar dışarıdan hiçbir şey yüklemez, sıkı içerik politikası (CSP) vardır.
- Kalıcı alan adı proje sahibinin kararıdır. Değişince uygulamadaki API adresi ve Play kaydı
  birlikte güncellenir.
- Politikadaki veri sorumlusu bilgileri (ad, adres ya da il, iletişim) proje sahibinden gelir.
  Gelene kadar sayfada "[…]" yer tutucuları kalır; Play başvurusundan önce dolmalıdır.

## Sonuçlar

- Sunucu yeni olarak aydınlatmanın okunduğunu ve geçmiş rızasını (sürüm, zaman, geri çekme)
  tutar. Bunlar ispat yükü için gereklidir ve hesapla birlikte silinir.
- Silinen hesabın e-posta özeti kalıcı silmeye kadar tutulur (en geç 7 gün); bu sürede aynı
  adresle hesap açılamaz.
- Yerler silinen kişinin değil çemberin verisi sayılır ve kalır.
- Eski uygulama sürümleri rıza kaydı olmadan geçmiş gönderemez (403). Yeni sürüm rızayı sorar.
- Migration'lar:
  - 0018: hesap silme kayıtları, rıza tablosu ve silme ile temizlik fonksiyonları. Kalıcı silme,
    kişinin arkadaşlık çemberlerini de siler; arkadaşlığın anahtarı iki kişinin kimliğini taşır.
- Kalıcı silmede, kişinin cihazına bağlı kısa süreli hız sınırı sayaçları (cihaz kimliğiyle) kendi
  sürelerinde (en çok bir gün) kendiliğinden silinir; kullanıcı kimliği taşıyan bütün anahtarlar
  hemen silinir.
