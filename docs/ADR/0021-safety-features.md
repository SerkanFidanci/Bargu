# 0021. Güvenlik özellikleri: hatırlatma, yeni izleyici, tümünü durdur, kilit, olaylar, uzaktan iptal

- Durum: Kabul edildi
- Tarih: 2026-10-15

## Bağlam

BARGU_PLAN Faz 9 dilim 3; tehdit modelindeki "kontrolcü partner" ve "çalınan telefon" satırları.
Proje sahibi dört soruda da öneriyi seçti (PM üzerinden, 2026-10-15). Telefon denemesinde
buluşmanın bir arkadaşla kolayca başlatılamadığını söyledi; kişi kartından başlatmayı seçti.

## Karar

- **Haftalık hatırlatma:** konumu ya da konum geçmişini gören biri varken 7 günde bir. İki
  biçimde gelir:
  - haritada bir kart, örneğin "Konumunu 5 kişi görüyor (Aile 3, Ekip 2); konum geçmişini 2 kişi
    görüyor", "Tamam" ve "Düzenle" düğmeleriyle;
  - telefonun kendi kurduğu yerel bildirim. Bildirim genel bir cümledir; kilit ekranında isim ve
    sayı görünmez.

  Sunucuya ya da bildirim servisine bir şey gitmez. Sayaç ilk açılışta başlar; "Tamam" ya da
  "Düzenle" yeni bir hafta başlatır. Kimse bir şey görmüyorsa bildirim kurulmaz, varsa geri alınır.
  Android'de ayrı bir kanalı var ("Gizlilik hatırlatmaları"): arkadaş haberleriyle birlikte
  susturulmasın diye.

- **Yeni izleyici:** paylaşılan bir gruba yeni biri girince "X artık Aile çemberinde konumunu
  görebilir" denir. Geçmiş de açıksa tek cümleyle "konumunu ve konum geçmişini" denir.
  - Söylenmeyen durumlar: arkadaşlık (kendi bildirimi var), ilk bakış (yeni katılınan çember) ve
    paylaşılmayan çember. Paylaşmaya başlamak kullanıcının kendi seçimidir ve çemberde kimin
    olduğunu görerek yapılır.
  - Bu kişi için genel "X katıldı" duyurusu ikinci kez gösterilmez.
  - Uygulama kapalıyken sunucunun "yeni biri katıldı" bildirimini telefon (Android) ya da iOS
    uzantısı bu bilgiye göre yazar. Uzantıya, canlı konumu gören çemberlerin kimlikleri de verilir
    (çember kimlikleri orada zaten vardı). Liste açılışta da yazılır (QA B3).
- **Tümünü durdur:** hayalet modunun "gizle" hâli. Konum herkesin haritasından hemen kalkar, konum
  gönderilmez, geçmiş yazılmaz (bekleyen parçalar atılır, ADR 0019). "Seni görenler" ekranında
  durur; haritadaki "kim görüyor" hapı bu ekranı açar. Ekran çember çember kimlerin gördüğünü ve
  hangi ayrıntıda gördüğünü gösterir. "Paylaşmaya devam et" tek dokunuştur. "Geçmişimi de sil"
  ayrıca onay ister: bütün çemberlerde geçmiş kapanır ve sunucudaki kopya silinir.
- **Uygulama kilidi:** varsayılan kapalı, "Ben → Güvenlik"ten açılır. Açıksa uygulama açılışta ve
  1 dakikadan uzun arka planda kaldıktan sonra Face ID, parmak izi ya da telefon şifresi ister.
  - Yalnızca "arka plan" sayılır; sistemin kendi Face ID penceresi uygulamayı kısa süre "pasif"
    yapar, o sayılmaz.
  - Kilit yalnızca ekranı korur, paylaşım arkada sürer. Bildirimleri gizlemez; içerikleri zaten
    mühürlüdür (ADR 0016).
  - Açmak da kapatmak da telefonun doğrulamasını ister: kilidi açık telefonu eline alan biri kilidi
    sessizce kapatamaz.
  - Ayar şifreli kasada tutulur. Kasa açılınca, ekranda hiçbir şey çizilmeden önce okunur.
  - Kilitliyken uygulamanın ekranları hiç çizilmez, yalnızca kilit ekranı vardır (QA 3a-B2). Böylece
    ekran okuyucu (TalkBack) altta bir şey okuyamaz ve iOS'ta tam ekran açılan bir pencere kilidin
    üstüne çıkamaz. Bedeli: kilidi açınca uygulama haritadan başlar.
  - Kilit ekranı telefonu açılınca ve uygulama arka plandan dönünce kendiliğinden sorar. "Vazgeç"ten
    sonra yalnızca düğme yeniden sorar; sistemin Face ID penceresinin kısa "pasif" hâli yeni bir soru
    açmaz.
  - Yeni bağımlılık: **expo-local-authentication 57.0.3**.
    - Expo'nun resmî paketidir, Expo SDK 57 ile aynı sürüm hattındadır ve bakımı Expo ekibindedir.
    - Telefonun yerel doğrulamasını kullanır (iOS LocalAuthentication, Android BiometricPrompt ve
      cihaz şifresi).
    - Ağa çıkmaz, bir sır saklamaz, yalnızca "evet / hayır" döndürür.
    - `npx expo install` ile eklendi. iOS'ta Face ID izin metni tr/en.
- **Güvenlik olayları:** `GET /v1/me/security-events` hesabın kendi olaylarını döndürür. Kapsam:
  - Olaylar: girişler, yeni telefonun eskisinin yerine geçmesi, şüpheli oturum kullanımı, geçiş
    anahtarı ve çıkış.
  - Son 90 gün, en çok 100 olay.
  - Telefonun türü ve bu telefon olup olmadığı gösterilir. IP ya da yer yok; sunucu tutmuyor.
  - Telefon tanımadığı yeni olay türlerini atlar; liste bozulmaz.
  - 90 günden eski olaylar işçi tarafından silinir (5 dakikada bir; QA dilim 4 K5).
- **Kişi kartından buluşma ("Buluş"):** tek dokunuşla o arkadaşla 3 saatlik bir etkinlik kurulur
  ve arkadaşa davet gider. Etkinliği kuran yöneticidir (ADR 0020), saati ve yeri hemen seçer. Bitince
  her şey silinir (ADR 0017). Uzun basınca açılan menü 5 öğe için ayarlı, oraya eklenmedi.
  Onaydan sonra kart kapanır ve bir kurulum bitmeden ikincisi başlamaz. Davet gitmezse etkinlik
  hemen bitirilir ve "davet gitmedi" denir: arkadaşsız bir buluşma kalmaz (QA 3a-B1).
- **"Paylaşmaya devam et":** "Tümünü durdur"dan önceki hayalet hâline döner. Öncesinde "dondur"
  açıksa yine "dondur" olur (QA 3a-B4).
- **Uzaktan cihaz iptali:** API'nin geçici alan adında `/hesap` web sayfası. Akış:
  - E-posta yazılır, e-postayla gelen 8 haneli kod girilir, "Telefonumu hesaptan çıkar"
    denir. Telefonun "Ben → Güvenlik" ekranı bu adresi gösterir.
  - Kod girişteki 4 haneli koddan ayrıdır: `bargu/v1/web-code` etiketiyle türetilir
    (PROTOCOL.md), yalnızca bu sayfada geçer ve sayfanın sekme için ürettiği rastgele değere
    (binding) bağlıdır.
  - Kendi sınırları vardır. Bütçeler adres ve ağ (IPv4 adresi ya da IPv6 /48, takma adla) başına
    tutulur; yalnızca adresi bilen biri, sahibin kendi ağından girmesini engelleyemez (QA 3b N1):
    - kod istekleri: adres+ağ başına günde 3; adres başına (bütün ağlar) günde 50;
    - kod başına 3 deneme; yanlış kod adres+ağ başına günde 10, adres başına (bütün ağlar) günde 150.
      Bu tavanla tahmin şansı günde 1,5·10⁻⁶;
    - ağ başına saatte 10 kod isteği, 30 doğrulama, 10 iptal ve 10 silme.
    - E-posta kuyruğa beklenmeden yazılır; hesabı olan ve olmayan adres aynı sürede cevap alır
      (QA 3b N3).

    **Çok ağlı saldırgan (QA dilim 4 K2):** Adresi bilen biri birçok ağdan, adresin bütün ağlar için
    olan günlük tavanını (50 kod isteği ya da 150 yanlış kod) bitirirse sahip de o gün kod alamazdı.
    Karar:
    - Ağ başına günlük kod isteği 10'dan 3'e indi. Sahibe bir günde bir ağdan 3 kod yeter; tavanı
      bitirmek artık en az 17 ağ ister (önce 5).
    - Bu sayfada IPv6 ağı /64'e değil /48'e göre sayılır (QA dilim 4 K2a). Bir /48'i olan, 65536 ayrı
      /64'ten 17 "ağ" çıkaramaz. Bedeli: aynı /48'i paylaşan (aynı operatördeki) biri, sahibin o
      ağdaki günlük 3 kodunu harcayabilir; sahip başka bir ağdan (Wi-Fi, mobil) ya da hatırlanan
      tarayıcıyla devam eder. Girişin ve diğer uçların sınırları /64'te kalır.
    - **Hatırlanan tarayıcı:** Kodla bir kez giren tarayıcı rastgele bir değer saklar (sayfanın
      kendi deposunda, hesap başına en yeni 5). Her değer kendi 180 gününü sayar; hesaba yeniden
      girmek eski değerlerin süresini uzatmaz (QA 4 K2c). Bu değeri gösteren tarayıcı adresin bütün
      ağlar tavanlarına takılmaz; ağ başına sınırlar yine geçerlidir. Değer tek başına hiçbir şey
      açmaz: kod yine e-postaya gider ve sayfaya bağlıdır. Sunucu yalnızca özetini tutar; hesapla
      silinir.
    - Tahmin güvenliği değişmez: hatırlanmayan her tarayıcı için adres başına günde en çok 150
      yanlış kod; hatırlanan değeri ancak daha önce doğru kodu giren bilir.
    - Telefonu olmayan sahip için başka yol da var: Bargu'yu başka bir telefona kurup e-postasıyla
      giriş yapınca eski telefon hemen çıkar (ADR 0005). Bu yol hesap sayfasının sınırlarını
      kullanmaz.

    Seçilmeyenler:
    - Sahibin daha önce girdiği ağları tutmak: IP takma adı da olsa sunucuda kişinin hangi ağlarda
      olduğunun bir kaydı olurdu (kaba bir yer bilgisi).
    - Tavanı yükseltmek: e-posta bombalamasını büyütür.
    - Geri çekilmeli (backoff) sınır: saldırgan her açılan hakkı sahipten önce kapabilir.

    Girişin hakları tüketilmez; hesap sayfasında yanlış kod denemek girişi kilitlemez. Olmayan bir
    hesaba e-posta gitmez, ama cevaplar (kod isteme ve kod denetleme) hesap olsun olmasın aynıdır.

  - Doğrulanan kod 10 dakikalık, tek işlemlik bir oturum verir; sayfa bu sürede hesapta hangi tür
    telefon olduğunu ve ne zamandan beri olduğunu gösterir.
  - Sayfa sunucunun kendisinden gelir; betik ve stil de oradan, dışarıdan hiçbir şey yüklenmez.
    Sıkı içerik politikası (CSP) vardır, başka sitede çerçeve içinde açılamaz, önbelleğe alınmaz.
    Başka sitelerden gelen tarayıcı istekleri zaten reddedilir (CSRF koruması).
  - 10^8 kod ve günde birkaç yanlış denemeyle tahmin şansı fiilen yoktur. ADR 0012'nin 4 haneli
    kod riski bu sayfaya taşınmaz. Bu, dilim 4'te aynı sayfaya eklenecek hesap silme için de
    gereklidir.
  - İptal edince eski telefonun oturumu, yenileme anahtarları ve bildirim kaydı hemen kapanır,
    çemberler yeni anahtara geçer. Telefon bir sonraki bağlanışında kendini kapatır ve kasasını
    siler. Olay listesine "Telefon web sayfasından çıkarıldı" yazılır.

## Sonuçlar

- Sunucu hiçbir yeni şey öğrenmez: hatırlatma, yeni izleyici, kilit ve "tümünü durdur" telefonda
  çalışır. "Tümünü durdur" sunucuya yalnızca konumun geri çekildiğini söyler (zaten kabul edilen
  sızıntı: "Konumu geri çekme").
- Kilit, telefon kilidi açıkken elinde tutan birine karşı uygulamayı korur. Telefonun kendi
  kilidinin yerine geçmez.
- Yeni izleyici uyarısı yalnızca bu telefonun bildiği üyelere göre çalışır. Bir üye, telefon
  çevrimdışıyken girip çıkarsa söylenmez; o sürede kimse yeni konum almaz.

## Ek (2026-10-16, Faz 9 dilim 6b)

- **Hesap sayfasında "bu tarayıcıyı tanıt" bağlantısı (QA 4 K2b):** Hatırlanan tarayıcı yalnızca
  daha önce kodla girmiş birine yarıyordu. Asıl korunması gereken kişi (telefonu çalınmış, sayfayı
  ilk kez kullanan) adresin bütün ağlar tavanı dolunca (17 ağ, IPv6'da kolay) yine kilitleniyordu.
  - Adresin kod isteme tavanı ya da yanlış kod tavanı doluyken tanınmayan bir tarayıcıdan kod
    istenirse, hesap varsa sahibine **günde en çok bir kez** bir e-posta gider. İçinde
    `/hesap#unlock=<kimlik>.<sır>` bağlantısı vardır.
  - Sır, kodlar gibi bağlantının kimliğinden sunucu anahtarıyla türetilir (`bargu/v1/web-unlock`
    etiketi, `packages/crypto`); sunucu yalnızca kimliği ve hangi hesaba ait olduğunu 24 saat tutar.
    Kuyrukta da sır değil kimlik durur.
  - Sır `#` işaretinden sonradır: tarayıcı onu sunucuya göndermez, günlüklere düşmez. Sayfa onu
    okuyup adres çubuğundan hemen siler ve `POST /v1/web/unlock` ile gönderir. Bağlantı bir kez
    çalışır; açıldığı tarayıcı, kodla girmiş bir tarayıcı gibi hatırlanır (en yeni 5, her biri 180
    gün).
  - Bağlantı tek başına hiçbir şey açmaz: kod yine e-postaya gider, sayfaya bağlıdır ve ağ başına
    sınırlar sürer. Bağlantıyı kullanabilen, e-postayı zaten okuyabilen kişidir; o kişi kodu da
    okuyabilir.
  - Tavanı dolduran saldırgan bu e-postayı adres başına günde bir kez tetikleyebilir; fazlası gitmez.
    Cevap hesap olsun olmasın aynıdır (`429`); sayfa "adres seninse e-postana bir bağlantı gelmiş
    olabilir" der.
  - Uç noktanın kendi IP sınırı vardır (saatte 10). Bekleyen bağlantı hesapla silinir.
  - E-posta kuyruğa yazılamazsa o günün hakkı harcanmış sayılmaz; sonraki istek yeniden dener (QA 6b
    K2b-1).
  - Bağlantının adresi `WEB_ORIGIN` ayarından, yoksa passkey'lerin ilk web kökeninden gelir
    (staging'de API'nin kendisi). İstekteki `Host` başlığı kullanılmaz: sahte bir başlık bağlantıyı
    başka siteye yönlendirmesin.
  - Seçilmeyenler: tavan dolunca yeni ağlardan gelen istekleri gecikmeli kabul etmek (saldırgan aynı
    gecikmeyi bekler); tavanı yükseltmek (e-posta bombalaması büyür).
- **Yeni izleyici bildirimleri:**
  - Aynı anda birden çok kişi gelince (ör. 50 kişilik etkinlik) çember ve tür başına tek bildirim
    gider: "Ayşe ve 12 kişi daha artık…" (QA Faz 8 G9).
  - Hayalet modu ya da duraklatılmış paylaşımda bir çember konumu ve geçmişi "görmüyor" sayılır:
    iOS uzantısının listesi ve "katıldı" duyurusu buna göredir (QA 3a-B5). Hayaletteyken katılan
    kişi önce "katıldı" diye duyurulur; hayalet kalkınca "artık konumunu görebilir" bildirimi bir kez
    gider (önceden ikisi de gitmiyordu).
- **Kilitli uygulamada bildirim hedefi (QA 3b, bilgi):** Kilit açılınca uygulama haritadan başlar.
  Kilitliyken dokunulan bir bildirimin ya da davet bağlantısının hedefi kaybolabilir; kişi
  bildirimi ya da bağlantıyı yeniden açar. Faz 10 iş listesinde.
- **Hesap sayfasının dosyaları (QA 3b N4, bilgi):** `app.js` ve `app.css` sayfanın sıkı CSP'si
  yerine genel güvenlik başlıklarıyla gelir; belge olmadıkları için sorun değildir.
